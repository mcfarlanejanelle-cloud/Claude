/*
 * Lumen audio: rendering jobs to buffers, the mix/effects chain
 * (air EQ, warmth, compression, plate-ish reverb, ping-pong delay),
 * playback, WAV export and quick key previews.
 */
(function (root) {
  'use strict';
  const L = root.Lumen;

  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const nextFrame = () => new Promise((r) => setTimeout(r, 0));

  // Render every voice job into mono Float32Arrays
  async function renderJobs(arr, sampleRate, onProgress) {
    const out = [];
    for (let i = 0; i < arr.jobs.length; i++) {
      const j = arr.jobs[i];
      if (onProgress) onProgress(i, arr.jobs.length, j.name);
      await nextFrame();
      const buf = L.engine.renderVoice(j.notes, Object.assign({ sampleRate }, j.opts));
      L.engine.normalize(buf, 0.6);
      out.push(buf);
    }
    return out;
  }

  // ---------------------------------------------------------- reverb IR
  const irCache = new Map();
  function makeIR(c, seconds, darkness) {
    const k = c.sampleRate + ':' + seconds + ':' + darkness;
    if (irCache.has(k)) return irCache.get(k);
    const sr = c.sampleRate, len = Math.floor(sr * seconds), pre = Math.floor(sr * 0.018);
    const ir = c.createBuffer(2, len + pre, sr);
    const rnd = L.engine.rng(424242);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.pow(1 - i / len, 2.2) * Math.exp(-t * 1.6);
        // the tail gets darker as it decays
        const a = Math.max(0.03, 0.9 * Math.exp(-t * darkness));
        lp += ((rnd() * 2 - 1) - lp) * a;
        d[i + pre] = lp * env * (i < sr * 0.004 ? i / (sr * 0.004) : 1);
      }
    }
    irCache.set(k, ir);
    return ir;
  }

  // ---------------------------------------------------------- fx chain
  function buildChain(c, fx, dest) {
    const input = c.createGain();
    const low = c.createBiquadFilter(); low.type = 'highpass'; low.frequency.value = 110; low.Q.value = 0.6;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 380; body.gain.value = -2; body.Q.value = 0.9;
    const air = c.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = fx.air;
    const presence = c.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3200; presence.gain.value = 1.5; presence.Q.value = 0.8;
    const warm = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
    warm.curve = curve;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.008; comp.release.value = 0.18; comp.knee.value = 8;

    input.connect(low); low.connect(body); body.connect(presence); presence.connect(warm); warm.connect(comp); comp.connect(air);

    const master = c.createGain(); master.gain.value = 0.9;
    const dry = c.createGain(); dry.gain.value = 1;
    air.connect(dry); dry.connect(master);

    // reverb send
    const rvSend = c.createGain(); rvSend.gain.value = fx.reverb;
    const rv = c.createConvolver(); rv.buffer = makeIR(c, 3.2, 2.2);
    const rvHp = c.createBiquadFilter(); rvHp.type = 'highpass'; rvHp.frequency.value = 280;
    air.connect(rvSend); rvSend.connect(rvHp); rvHp.connect(rv); rv.connect(master);

    // ping-pong delay (dotted eighth)
    const spb = 60 / (fx.bpm || 84);
    const dlSend = c.createGain(); dlSend.gain.value = fx.delay;
    const dL = c.createDelay(4), dR = c.createDelay(4);
    dL.delayTime.value = spb * 0.75; dR.delayTime.value = spb * 0.75;
    const fb = c.createGain(); fb.gain.value = 0.38;
    const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3800;
    const merger = c.createChannelMerger(2);
    air.connect(dlSend); dlSend.connect(tone); tone.connect(dL);
    dL.connect(dR); dR.connect(fb); fb.connect(dL);
    dL.connect(merger, 0, 0); dR.connect(merger, 0, 1);
    const dlRv = c.createGain(); dlRv.gain.value = 0.4;
    merger.connect(master); merger.connect(dlRv); dlRv.connect(rvHp);

    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.1; limiter.knee.value = 0;
    master.connect(limiter); limiter.connect(dest);
    return { input, nodes: [input, low, body, presence, warm, comp, air, master, dry, rvSend, rv, rvHp, dlSend, dL, dR, fb, tone, merger, dlRv, limiter] };
  }

  function connectVoices(c, buffers, jobs, chainInput, when, offset) {
    const sources = [];
    buffers.forEach((b, i) => {
      const ab = c.createBuffer(1, b.length, c.sampleRate);
      ab.copyToChannel(b, 0);
      const src = c.createBufferSource(); src.buffer = ab;
      const g = c.createGain(); g.gain.value = jobs[i].gain * 0.8;
      let node = g;
      src.connect(g);
      if (c.createStereoPanner) {
        const p = c.createStereoPanner(); p.pan.value = jobs[i].pan; g.connect(p); node = p;
      }
      node.connect(chainInput);
      src.start(when, offset || 0);
      sources.push(src);
    });
    return sources;
  }

  // ---------------------------------------------------------- playback
  let current = null;
  function play(buffers, jobs, fx, offset) {
    stop();
    const c = getCtx();
    const out = c.createGain();
    out.connect(c.destination);
    const chain = buildChain(c, fx, out);
    const when = c.currentTime + 0.06;
    const sources = connectVoices(c, buffers, jobs, chain.input, when, offset || 0);
    current = { sources, out, when, offset: offset || 0, chain };
    return current;
  }
  function stop() {
    if (!current) return;
    const c = getCtx();
    const cur = current;
    current = null;
    cur.out.gain.setTargetAtTime(0, c.currentTime, 0.03);
    setTimeout(() => {
      cur.sources.forEach((s) => { try { s.stop(); } catch (e) { /* already stopped */ } });
      cur.out.disconnect();
    }, 250);
  }
  function position() {
    if (!current) return null;
    return Math.max(0, getCtx().currentTime - current.when) + current.offset;
  }

  // ---------------------------------------------------------- export
  async function renderMix(buffers, jobs, fx, sampleRate) {
    let len = 0;
    for (const b of buffers) len = Math.max(len, b.length);
    len += Math.floor(sampleRate * 3.5); // reverb & delay tails
    const oc = new OfflineAudioContext(2, len, sampleRate);
    const chain = buildChain(oc, fx, oc.destination);
    connectVoices(oc, buffers, jobs, chain.input, 0, 0);
    return oc.startRendering();
  }

  function encodeWav(audioBuffer) {
    const ch = audioBuffer.numberOfChannels, sr = audioBuffer.sampleRate;
    const data = [];
    for (let c = 0; c < ch; c++) data.push(audioBuffer.getChannelData(c));
    // trim trailing silence
    let end = audioBuffer.length;
    while (end > sr && data.every((d) => Math.abs(d[end - 1]) < 1e-4)) end--;
    const bytes = 44 + end * ch * 2;
    const buf = new ArrayBuffer(bytes);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, end * ch * 2, true);
    let o = 44;
    for (let i = 0; i < end; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, data[c][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
      }
    }
    return new Uint8Array(buf);
  }

  // ---------------------------------------------------------- previews
  const previewCache = new Map();
  let previewKey = '';
  function previewBuffer(midi, style) {
    const k = JSON.stringify([style.breathiness, style.brightness, style.formantShift, style.vibDepth, style.vibRate]);
    if (k !== previewKey) { previewCache.clear(); previewKey = k; }
    if (previewCache.has(midi)) return previewCache.get(midi);
    const c = getCtx();
    const raw = L.engine.renderVoice(
      [{ midi, t0: 0.02, t1: 2.6, vel: 0.8, onset: [], nucleus: ['UW'], coda: [] }],
      Object.assign({}, style, { sampleRate: c.sampleRate, vibDelay: 0.35, tail: 0.3, attack: 0.03 })
    );
    L.engine.normalize(raw, 0.35);
    const ab = c.createBuffer(1, raw.length, c.sampleRate);
    ab.copyToChannel(raw, 0);
    previewCache.set(midi, ab);
    return ab;
  }
  const held = new Map();
  function noteOn(midi, style) {
    noteOff(midi);
    const c = getCtx();
    const src = c.createBufferSource();
    src.buffer = previewBuffer(midi, style);
    const g = c.createGain(); g.gain.value = 1;
    src.connect(g); g.connect(c.destination);
    src.start();
    held.set(midi, { src, g });
  }
  function noteOff(midi) {
    const h = held.get(midi);
    if (!h) return;
    held.delete(midi);
    const c = getCtx();
    h.g.gain.setTargetAtTime(0, c.currentTime, 0.05);
    setTimeout(() => { try { h.src.stop(); } catch (e) { /* done */ } }, 400);
  }
  function blip(midi, style) {
    noteOn(midi, style);
    setTimeout(() => noteOff(midi), 380);
  }

  function click(time, accent) {
    const c = getCtx();
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.25, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    o.connect(g); g.connect(c.destination);
    o.start(time); o.stop(time + 0.08);
  }

  const api = { getCtx, renderJobs, play, stop, position, renderMix, encodeWav, noteOn, noteOff, blip, click, previewBuffer };
  root.Lumen = root.Lumen || {};
  root.Lumen.audio = api;
})(typeof window !== 'undefined' ? window : globalThis);
