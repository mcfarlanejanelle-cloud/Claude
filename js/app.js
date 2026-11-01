/* Lumen Vocal Studio: UI wiring */
(function () {
  'use strict';
  const L = window.Lumen;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ examples
  // Original melodies written for this tool.
  const EXAMPLES = [
    { name: 'Blue light (lyrics)', bpm: 80, harmony: 'thirds',
      text: 'R:.5 Eb4:.5/hold G4:1/me Bb4:.5/in C5:.5/the Bb4:1.5/blue G4:.5/_ F4:2/light R:1 Eb4:.5/I\'ve G4:.5/been Bb4:.75/drift- C5:.75/ing Eb5:1/so Bb4:3/slow' },
    { name: 'Cloud bank (wordless stack)', bpm: 68, harmony: 'stack',
      text: 'C5:2/ooh Bb4:1/_ G4:1/_ | Ab4:3/ooh G4:1/_ | F4:2/mm Eb4:2/_ | G4:4/ah' },
    { name: 'Scat flight (runs)', bpm: 96, harmony: 'none',
      text: 'R:.5 G4:.5/da Bb4:.5/ba C5:.5/di D5:.25/ya F5:.75/doo D5:.5/_ C5:.5/ba Bb4:1/day | R:.5 F4:.5/doo G4:.5/bee Bb4:.5/da C5:1.5/ooh Bb4:.5/_ G4:2/mm' },
    { name: 'Late drive (low and close)', bpm: 72, harmony: 'below',
      text: 'R:.5 D4:.5/we F4:.5/could A4:1.5/stay G4:.5/_ F4:1/here R:.5 D4:.5/till F4:.5/the G4:.5/sky A4:.5/turns C5:2/gold A4:2/_' },
    { name: 'Empty page', bpm: 84, harmony: 'none', text: '' }
  ];

  // ------------------------------------------------------------ state
  const state = {
    bpm: 80,
    notes: [],
    overrides: {},
    cache: null,    // { key, arr, buffers, sr }
    playing: false,
    raf: 0
  };
  const history = [];
  const pushHistory = () => {
    history.push(JSON.stringify({ bpm: state.bpm, notes: state.notes }));
    if (history.length > 100) history.shift();
  };

  // ------------------------------------------------------------ advanced sliders
  const ADV = [
    { k: 'breathiness', label: 'Breath', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { k: 'brightness', label: 'Brightness', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { k: 'formantShift', label: 'Voice size', min: 0.92, max: 1.18, step: 0.005, fmt: (v) => (v > 1.06 ? 'lighter ' : v < 1.0 ? 'fuller ' : '') + v.toFixed(2) },
    { k: 'vibDepth', label: 'Vibrato depth', min: 0, max: 90, step: 1, fmt: (v) => Math.round(v) + '¢' },
    { k: 'vibRate', label: 'Vibrato rate', min: 3.5, max: 7.5, step: 0.1, fmt: (v) => v.toFixed(1) + ' Hz' },
    { k: 'vibDelay', label: 'Vibrato delay', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 1000) + ' ms' },
    { k: 'portamento', label: 'Glide', min: 0.01, max: 0.2, step: 0.005, fmt: (v) => Math.round(v * 1000) + ' ms' },
    { k: 'agility', label: 'Run amount', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { k: 'runSpeed', label: 'Run note length', min: 0.045, max: 0.16, step: 0.005, fmt: (v) => Math.round(v * 1000) + ' ms' },
    { k: 'scoop', label: 'Scoop', min: 0, max: 4, step: 0.1, fmt: (v) => v.toFixed(1) + ' st' },
    { k: 'fall', label: 'Fall-off', min: 0, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) + ' st' },
    { k: 'layback', label: 'Behind the beat', min: 0, max: 0.12, step: 0.002, fmt: (v) => Math.round(v * 1000) + ' ms' },
    { k: 'doubleLevel', label: 'Doubles level', min: 0, max: 0.8, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { k: 'harmonyLevel', label: 'Harmony level', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { k: 'reverb', label: 'Reverb', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { k: 'delay', label: 'Echo', min: 0, max: 0.6, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { k: 'air', label: 'Air (top end)', min: -4, max: 9, step: 0.5, fmt: (v) => (v > 0 ? '+' : '') + v + ' dB' }
  ];

  function style() {
    const s = L.arrange.styleFromMacros($('mAiry').value / 100, $('mAgile').value / 100, $('mCool').value / 100);
    s.harmonyLevel = 0.5;
    return Object.assign(s, state.overrides);
  }

  function buildAdvanced() {
    const host = $('advanced');
    host.innerHTML = '';
    for (const a of ADV) {
      const row = document.createElement('label');
      row.className = 'adv';
      row.innerHTML = `<span>${a.label}</span><input type="range" id="adv_${a.k}" min="${a.min}" max="${a.max}" step="${a.step}"><output id="advo_${a.k}"></output>`;
      host.appendChild(row);
      const inp = row.querySelector('input');
      inp.addEventListener('input', () => {
        state.overrides[a.k] = parseFloat(inp.value);
        $('advo_' + a.k).textContent = a.fmt(parseFloat(inp.value));
        invalidate();
      });
    }
    syncAdvanced();
  }
  function syncAdvanced() {
    const s = style();
    for (const a of ADV) {
      const v = s[a.k];
      $('adv_' + a.k).value = v;
      $('advo_' + a.k).textContent = a.fmt(v);
    }
    for (const id of ['mAiry', 'mAgile', 'mCool']) $(id + 'Out').textContent = $(id).value;
  }

  // ------------------------------------------------------------ status
  function setStatus(msg, kind) {
    const el = $('status');
    el.textContent = msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ------------------------------------------------------------ roll & notation
  const roll = new L.PianoRoll($('rollWrap'), $('roll'), {
    lo: 48, hi: 86,
    onChange: () => { pushHistoryPending(); commitNotes(); },
    onSelect: (i) => showInspector(i),
    onPreview: (m) => { try { L.audio.blip(m, style()); } catch (e) { /* audio not ready */ } },
    onEditLyric: () => { const el = $('inLyric'); el.focus(); el.select(); }
  });

  // history snapshot before a roll edit: capture lazily on first pointerdown
  let preEdit = null;
  $('roll').addEventListener('pointerdown', () => { preEdit = JSON.stringify({ bpm: state.bpm, notes: state.notes }); }, true);
  $('roll').addEventListener('keydown', () => { preEdit = JSON.stringify({ bpm: state.bpm, notes: state.notes }); }, true);
  function pushHistoryPending() {
    if (preEdit) { history.push(preEdit); preEdit = null; }
  }

  function commitNotes(fromText) {
    state.notes = roll.notes;
    if (!fromText && document.activeElement !== $('notation')) $('notation').value = L.score.formatNotation(state.notes);
    invalidate();
    save();
  }

  function setNotes(notes, opts) {
    opts = opts || {};
    if (!opts.noHistory) pushHistory();
    state.notes = notes.map((n) => ({ midi: n.midi, start: n.start, len: n.len, lyric: n.lyric || '' }));
    roll.setNotes(state.notes);
    if (!opts.fromText) $('notation').value = L.score.formatNotation(state.notes);
    showInspector(-1);
    invalidate();
    save();
    if (opts.scroll !== false) roll.scrollToNotes();
  }

  let textTimer = 0;
  $('notation').addEventListener('input', () => {
    clearTimeout(textTimer);
    textTimer = setTimeout(() => {
      const r = L.score.parseNotation($('notation').value);
      const err = $('notationErr');
      if (r.errors.length) { err.hidden = false; err.textContent = r.errors.slice(0, 3).join('  ·  '); return; }
      err.hidden = true;
      setNotes(r.notes, { fromText: true, scroll: false });
    }, 450);
  });
  $('notation').addEventListener('blur', () => {
    if ($('notationErr').hidden) $('notation').value = L.score.formatNotation(state.notes);
  });

  // inspector
  function showInspector(i) {
    const box = $('inspector');
    if (i < 0 || !state.notes[i]) { box.hidden = true; return; }
    box.hidden = false;
    const n = state.notes[i];
    if (document.activeElement !== $('inPitch')) $('inPitch').value = L.score.noteName(n.midi);
    if (document.activeElement !== $('inStart')) $('inStart').value = +n.start.toFixed(3);
    if (document.activeElement !== $('inLen')) $('inLen').value = +n.len.toFixed(3);
    if (document.activeElement !== $('inLyric')) $('inLyric').value = n.lyric || '';
  }
  function selNote() { return state.notes[roll.sel]; }
  function inspectorEdit(fn) {
    const n = selNote(); if (!n) return;
    pushHistory();
    fn(n);
    roll.notes.sort((a, b) => a.start - b.start);
    roll.sel = roll.notes.indexOf(n);
    roll.resize();
    commitNotes();
  }
  $('inPitch').addEventListener('change', () => {
    const m = L.score.parsePitch($('inPitch').value);
    if (m == null) { $('inPitch').value = L.score.noteName(selNote().midi); return; }
    inspectorEdit((n) => { n.midi = m; });
  });
  $('inStart').addEventListener('change', () => inspectorEdit((n) => { n.start = Math.max(0, parseFloat($('inStart').value) || 0); }));
  $('inLen').addEventListener('change', () => inspectorEdit((n) => { n.len = Math.max(0.0625, parseFloat($('inLen').value) || 1); }));
  $('inLyric').addEventListener('input', () => {
    const n = selNote(); if (!n) return;
    n.lyric = $('inLyric').value.trim().replace(/\s+/g, '~');
    roll.draw();
    commitNotes();
  });
  $('inLyric').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      // jump to the next note for fast lyric entry
      e.preventDefault();
      const next = roll.sel + (e.shiftKey ? -1 : 1);
      if (state.notes[next]) { roll.sel = next; roll.draw(); showInspector(next); $('inLyric').select(); }
    }
  });
  $('inDelete').addEventListener('click', () => {
    if (roll.sel < 0) return;
    pushHistory();
    roll.notes.splice(roll.sel, 1); roll.sel = -1; roll.resize(); showInspector(-1); commitNotes();
  });

  // lyrics fitting
  $('fitLyricsBtn').addEventListener('click', () => {
    const syl = L.lyrics.syllabify($('lyrics').value);
    if (!syl.length) { setStatus('Type some lyrics first', 'err'); return; }
    if (!state.notes.length) { setStatus('Add notes first', 'err'); return; }
    pushHistory();
    const sorted = state.notes.slice().sort((a, b) => a.start - b.start);
    sorted.forEach((n, i) => { n.lyric = i < syl.length ? syl[i] : ''; });
    roll.setNotes(state.notes, true);
    commitNotes();
    const diff = syl.length - sorted.length;
    setStatus(diff > 0 ? `${diff} syllable${diff > 1 ? 's' : ''} left over` : diff < 0 ? `${-diff} note${diff < -1 ? 's' : ''} sing "${$('defSyl').value}"` : 'Lyrics fitted');
  });

  // toolbar
  $('gridSel').addEventListener('change', () => { roll.grid = parseFloat($('gridSel').value); roll.draw(); });
  $('lenSel').addEventListener('change', () => { roll.defaultLen = parseFloat($('lenSel').value); });
  $('bpm').addEventListener('change', () => {
    const v = Math.max(40, Math.min(200, parseFloat($('bpm').value) || 84));
    $('bpm').value = v; state.bpm = v; invalidate(); save();
  });
  $('clearBtn').addEventListener('click', () => { setNotes([]); setStatus('Cleared. Undo brings it back.'); });
  function undo() {
    const last = history.pop();
    if (!last) { setStatus('Nothing to undo'); return; }
    const s = JSON.parse(last);
    state.bpm = s.bpm; $('bpm').value = s.bpm;
    setNotes(s.notes, { noHistory: true, scroll: false });
  }
  $('undoBtn').addEventListener('click', undo);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTyping(e)) { e.preventDefault(); undo(); }
    if (e.code === 'Space' && !isTyping(e) && document.activeElement && document.activeElement.tagName !== 'BUTTON') {
      e.preventDefault(); state.playing ? stopPlayback() : playAll();
    }
  });

  $('exampleSel').innerHTML = EXAMPLES.map((x, i) => `<option value="${i}">${x.name}</option>`).join('');
  $('exampleSel').addEventListener('change', () => loadExample(+$('exampleSel').value));
  function loadExample(i) {
    const ex = EXAMPLES[i];
    state.bpm = ex.bpm; $('bpm').value = ex.bpm;
    $('harmony').value = ex.harmony;
    setNotes(L.score.parseNotation(ex.text).notes);
    $('lyrics').value = '';
  }

  // key select
  (function () {
    const opts = ['<option value="auto">Auto-detect</option>'];
    for (const mode of ['major', 'minor', 'dorian']) for (let r = 0; r < 12; r++) opts.push(`<option value="${r}:${mode}">${L.score.NAMES[r]} ${mode}</option>`);
    $('keySel').innerHTML = opts.join('');
  })();

  // ------------------------------------------------------------ character
  for (const id of ['mAiry', 'mAgile', 'mCool']) {
    $(id).addEventListener('input', () => { state.overrides = {}; syncAdvanced(); invalidate(); save(); });
  }
  $('resetChar').addEventListener('click', () => {
    $('mAiry').value = 62; $('mAgile').value = 58; $('mCool').value = 55;
    state.overrides = {}; syncAdvanced(); invalidate(); save();
  });
  for (const id of ['harmony', 'keySel', 'doubles', 'transpose', 'defSyl']) $(id).addEventListener('change', () => { invalidate(); save(); });

  // ------------------------------------------------------------ rendering
  function arrangeNow() {
    const st = style();
    const keyV = $('keySel').value;
    const key = keyV === 'auto' ? 'auto' : { root: +keyV.split(':')[0], mode: keyV.split(':')[1] };
    const dbl = $('doubles').value;
    return L.arrange.arrange({ bpm: state.bpm, notes: state.notes }, st, {
      key, harmony: $('harmony').value, transpose: parseInt($('transpose').value, 10) || 0,
      doubles: dbl === 'auto' ? undefined : +dbl, doubleLevel: st.doubleLevel, harmonyLevel: st.harmonyLevel,
      defaultSyllable: $('defSyl').value
    });
  }
  function cacheKey() {
    return JSON.stringify([state.bpm, state.notes, style(), $('harmony').value, $('keySel').value, $('doubles').value, $('transpose').value, $('defSyl').value]);
  }
  function fx() {
    const s = style();
    return { reverb: s.reverb, delay: s.delay, air: s.air, bpm: state.bpm };
  }

  let ghostTimer = 0;
  function invalidate() {
    // update the ghost runs preview cheaply (arrangement only, no audio)
    clearTimeout(ghostTimer);
    ghostTimer = setTimeout(updateGhost, 120);
  }
  function updateGhost() {
    if (!state.notes.length) { roll.ghost = []; roll.draw(); $('keyInfo').textContent = ''; return; }
    const arr = arrangeNow();
    const bps = state.bpm / 60;
    const tr = parseInt($('transpose').value, 10) || 0;
    roll.ghost = arr.jobs[0].notes.map((n) => ({ midi: n.midi - tr, start: (n.t0 - arr.timeShift) * bps, len: (n.t1 - n.t0) * bps, ornament: n.ornament }));
    roll.draw();
    $('keyInfo').textContent = `Key: ${L.score.keyName(arr.key)}${$('keySel').value === 'auto' ? ' (detected)' : ''}. Runs and harmonies follow this scale. ${arr.jobs.length} voice${arr.jobs.length > 1 ? 's' : ''}.`;
  }

  async function ensureRendered() {
    const c = L.audio.getCtx();
    const key = cacheKey();
    if (state.cache && state.cache.key === key && state.cache.sr === c.sampleRate) return state.cache;
    const arr = arrangeNow();
    const t0 = performance.now();
    const buffers = await L.audio.renderJobs(arr, c.sampleRate, (i, n, name) => setStatus(`Singing ${name.toLowerCase()} (${i + 1}/${n})…`, 'busy'));
    state.cache = { key, arr, buffers, sr: c.sampleRate };
    setStatus(`Rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    return state.cache;
  }

  async function playAll() {
    if (!state.notes.length) { setStatus('Add some notes first', 'err'); return; }
    $('playBtn').disabled = true;
    try {
      const r = await ensureRendered();
      L.audio.play(r.buffers, r.arr.jobs, fx(), 0);
      state.playing = true;
      setStatus('Singing');
      const end = r.arr.duration + 1.5;
      const bps = state.bpm / 60;
      cancelAnimationFrame(state.raf);
      const tick = () => {
        const pos = L.audio.position();
        if (pos == null || pos > end) { stopPlayback(true); return; }
        roll.playhead = (pos - r.arr.timeShift) * bps;
        // keep the playhead in view
        const x = roll.xOf(roll.playhead), wrap = $('rollWrap');
        if (x > wrap.scrollLeft + wrap.clientWidth - 60) wrap.scrollLeft = x - roll.gutter - 40;
        roll.draw();
        state.raf = requestAnimationFrame(tick);
      };
      state.raf = requestAnimationFrame(tick);
    } catch (e) {
      console.error(e);
      setStatus('Could not render: ' + e.message, 'err');
    } finally {
      $('playBtn').disabled = false;
    }
  }
  function stopPlayback(natural) {
    L.audio.stop();
    state.playing = false;
    cancelAnimationFrame(state.raf);
    roll.playhead = null; roll.draw();
    if (!natural) setStatus('Stopped'); else setStatus('Ready');
  }
  $('playBtn').addEventListener('click', playAll);
  $('stopBtn').addEventListener('click', () => stopPlayback());

  // ------------------------------------------------------------ export
  $('exportBtn').addEventListener('click', async () => {
    if (!state.notes.length) { setStatus('Add some notes first', 'err'); return; }
    $('exportBtn').disabled = true;
    try {
      const r = await ensureRendered();
      setStatus('Mixing…', 'busy');
      const mix = await L.audio.renderMix(r.buffers, r.arr.jobs, fx(), r.sr);
      const wav = L.audio.encodeWav(mix);
      const res = await saveFile('lumen-take.wav', wav, 'audio/wav');
      setStatus(res);
    } catch (e) {
      console.error(e);
      setStatus(e && e.message ? e.message : 'Export failed', 'err');
    } finally {
      $('exportBtn').disabled = false;
    }
  });

  async function saveFile(name, bytes, mime) {
    // Inside a claude.ai artifact, files go through the downloads capability.
    if (window.claude && typeof window.claude.use === 'function') {
      let dl = null;
      try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
      if (dl) {
        try {
          await dl.save({ filename: name, data: new Blob([bytes]) });
          return 'Saved ' + name;
        } catch (e) {
          if (e && e.code === 'rejected_extension') {
            const zipName = name.replace(/\.[^.]+$/, '') + '.zip';
            await dl.save({ filename: zipName, data: new Blob([zipStore(name, bytes)]) });
            return 'Saved ' + zipName + ' (the WAV is inside)';
          }
          if (e && e.code === 'declined') return 'Save cancelled';
          throw new Error(e && e.message ? e.message : 'Saving is not available here');
        }
      }
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'Saved ' + name;
  }

  // minimal uncompressed zip (one file)
  function zipStore(name, data) {
    const crcT = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = crcT[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const nb = new TextEncoder().encode(name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true);
    const cdOff = 30 + nb.length + data.length;
    const ed = new DataView(new ArrayBuffer(22));
    ed.setUint32(0, 0x06054b50, true); ed.setUint16(8, 1, true); ed.setUint16(10, 1, true);
    ed.setUint32(12, 46 + nb.length, true); ed.setUint32(16, cdOff, true);
    const parts = [new Uint8Array(lh.buffer), nb, data, new Uint8Array(ch.buffer), nb, new Uint8Array(ed.buffer)];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // ------------------------------------------------------------ live playing & recording
  const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16 };
  let octave = 60;
  const down = new Map(); // code -> midi
  const rec = { on: false, t0: 0, notes: [], open: new Map(), countIn: 0 };

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  function updOct() { $('octInfo').textContent = L.score.noteName(octave); }
  updOct();

  function liveOn(midi, vel) {
    try { L.audio.noteOn(midi, style()); } catch (e) { /* ignore */ }
    if (rec.on) rec.open.set(midi, { t: L.audio.getCtx().currentTime, vel: vel || 0.8 });
  }
  function liveOff(midi) {
    L.audio.noteOff(midi);
    if (rec.on && rec.open.has(midi)) {
      const s = rec.open.get(midi); rec.open.delete(midi);
      rec.notes.push({ midi, t0: s.t - rec.t0, t1: L.audio.getCtx().currentTime - rec.t0, vel: s.vel });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (document.activeElement === $('roll') && /^Arrow|Delete|Backspace|Enter/.test(e.key)) return;
    if (e.code === 'KeyZ') { octave = Math.max(36, octave - 12); updOct(); return; }
    if (e.code === 'KeyX') { octave = Math.min(84, octave + 12); updOct(); return; }
    if (KEYMAP[e.code] === undefined) return;
    e.preventDefault();
    const m = octave + KEYMAP[e.code];
    down.set(e.code, m);
    liveOn(m, 0.8);
  });
  document.addEventListener('keyup', (e) => {
    if (!down.has(e.code)) return;
    const m = down.get(e.code); down.delete(e.code);
    liveOff(m);
  });
  window.addEventListener('blur', () => { for (const [c, m] of down) liveOff(m); down.clear(); });

  $('midiBtn').addEventListener('click', async () => {
    if (!navigator.requestMIDIAccess) { setStatus('This browser has no Web MIDI. Try Chrome or Edge.', 'err'); return; }
    try {
      const access = await navigator.requestMIDIAccess();
      let n = 0;
      access.inputs.forEach((inp) => {
        n++;
        inp.onmidimessage = (ev) => {
          const [st, d1, d2] = ev.data;
          const type = st & 0xf0;
          if (type === 0x90 && d2 > 0) liveOn(d1, d2 / 127);
          else if (type === 0x80 || (type === 0x90 && d2 === 0)) liveOff(d1);
        };
      });
      setStatus(n ? `MIDI connected (${n} input${n > 1 ? 's' : ''})` : 'No MIDI keyboard found', n ? '' : 'err');
      $('midiBtn').textContent = n ? 'MIDI on' : 'Connect MIDI';
    } catch (e) {
      setStatus('MIDI access was blocked', 'err');
    }
  });

  async function countIn(beats) {
    const c = L.audio.getCtx();
    const spb = 60 / state.bpm;
    const t = c.currentTime + 0.1;
    for (let i = 0; i < beats; i++) L.audio.click(t + i * spb, i === 0);
    return t + beats * spb; // the downbeat
  }

  $('recBtn').addEventListener('click', async () => {
    if (rec.on) { finishRecording(); return; }
    if (state.playing) stopPlayback();
    rec.notes = []; rec.open.clear();
    const btn = $('recBtn');
    btn.classList.add('on'); btn.querySelector('span:last-child').textContent = 'Stop recording';
    setStatus('Count-in…', 'busy');
    const downbeat = await countIn(4);
    rec.t0 = downbeat;
    rec.on = true;
    // metronome while recording
    const c = L.audio.getCtx();
    const spb = 60 / state.bpm;
    let next = downbeat, i = 0;
    rec.timer = setInterval(() => {
      while (next < c.currentTime + 0.2) { L.audio.click(next, i % 4 === 0); next += spb; i++; }
      if (c.currentTime > downbeat) setStatus(`Recording · bar ${Math.floor((c.currentTime - downbeat) / spb / 4) + 1}`, 'busy');
    }, 50);
  });

  function finishRecording() {
    clearInterval(rec.timer);
    const c = L.audio.getCtx();
    for (const [m] of rec.open) liveOff(m);
    rec.on = false;
    const btn = $('recBtn');
    btn.classList.remove('on'); btn.querySelector('span:last-child').textContent = 'Record';
    const bps = state.bpm / 60;
    const grid = Math.max(0.25, parseFloat($('gridSel').value));
    const q = (x) => Math.round(x / grid) * grid;
    const notes = rec.notes.filter((n) => n.t1 > 0).sort((a, b) => a.t0 - b.t0).map((n) => {
      const s = Math.max(0, q(n.t0 * bps));
      return { midi: n.midi, start: s, len: Math.max(grid, q(n.t1 * bps) - s), lyric: '' };
    });
    if (!notes.length) { setStatus('Nothing was played', 'err'); return; }
    setNotes(L.score.monophonize(notes));
    setStatus(`Recorded ${notes.length} notes`);
    void c;
  }

  // ------------------------------------------------------------ hum to melody
  async function melodyFromAudio(audioBuffer, alignToDownbeat) {
    setStatus('Listening for pitches…', 'busy');
    await new Promise((r) => setTimeout(r, 20));
    const mono = L.input.toMono(audioBuffer);
    const frames = L.input.trackPitch(mono, audioBuffer.sampleRate);
    const segs = L.input.segmentNotes(frames);
    let offsetSec = 0;
    if (alignToDownbeat != null) offsetSec = alignToDownbeat;
    const shifted = segs.map((s) => ({ t0: s.t0 - offsetSec, t1: s.t1 - offsetSec, pitch: s.pitch })).filter((s) => s.t1 > 0);
    const notes = L.input.notesToScore(shifted, {
      bpm: state.bpm, grid: Math.max(0.25, parseFloat($('gridSel').value)),
      fitRange: $('humFit').checked, snapKey: $('humSnap').checked, alignStart: alignToDownbeat == null
    });
    if (!notes.length) { setStatus('No clear notes found. Try humming louder on "doo".', 'err'); return; }
    setNotes(notes);
    setStatus(`Heard ${notes.length} notes`);
  }

  $('humFile').addEventListener('change', async () => {
    const f = $('humFile').files[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const ab = await L.audio.getCtx().decodeAudioData(buf);
      await melodyFromAudio(ab, null);
    } catch (e) {
      console.error(e);
      setStatus('Could not read that audio file', 'err');
    }
    $('humFile').value = '';
  });

  const hum = { rec: null, stream: null, chunks: [], startAt: 0, downbeat: 0 };
  $('humBtn').addEventListener('click', async () => {
    if (hum.rec) { hum.rec.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      setStatus('No microphone here. Upload a voice memo instead.', 'err'); return;
    }
    try {
      hum.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    } catch (e) {
      setStatus('Microphone unavailable. Upload a voice memo instead.', 'err'); return;
    }
    const c = L.audio.getCtx();
    hum.chunks = [];
    const mr = new MediaRecorder(hum.stream);
    hum.rec = mr;
    mr.ondataavailable = (e) => { if (e.data.size) hum.chunks.push(e.data); };
    mr.onstop = async () => {
      hum.stream.getTracks().forEach((t) => t.stop());
      hum.rec = null;
      $('humBtn').textContent = 'Hum into mic';
      try {
        const blob = new Blob(hum.chunks, { type: mr.mimeType });
        const ab = await c.decodeAudioData(await blob.arrayBuffer());
        await melodyFromAudio(ab, hum.downbeat - hum.startAt);
      } catch (e) {
        console.error(e);
        setStatus('Could not decode the recording', 'err');
      }
    };
    hum.startAt = c.currentTime;
    mr.start();
    $('humBtn').textContent = 'Stop humming';
    setStatus('Count-in, then hum…', 'busy');
    hum.downbeat = await countIn(4);
  });

  // ------------------------------------------------------------ MIDI import
  $('midiFile').addEventListener('change', async () => {
    const f = $('midiFile').files[0];
    if (!f) return;
    try {
      const res = L.input.parseMidiFile(await f.arrayBuffer());
      state.bpm = Math.max(40, Math.min(200, res.bpm)); $('bpm').value = state.bpm;
      // move the melody into her range if it sits very low or high
      const ms = res.notes.map((n) => n.midi).sort((a, b) => a - b);
      const med = ms[ms.length >> 1];
      const oct = Math.round((67 - med) / 12) * 12;
      setNotes(res.notes.map((n) => Object.assign({}, n, { midi: n.midi + oct })));
      setStatus(`Imported ${res.notes.length} notes${res.trackName ? ' from "' + res.trackName + '"' : ''}${oct ? `, moved ${oct > 0 ? 'up' : 'down'} ${Math.abs(oct / 12)} octave` : ''}`);
    } catch (e) {
      setStatus(e.message || 'Could not read that MIDI file', 'err');
    }
    $('midiFile').value = '';
  });

  // ------------------------------------------------------------ persistence (this browser only)
  const STORE = 'lumen-studio-v1';
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify({
          bpm: state.bpm, notes: state.notes, overrides: state.overrides,
          macros: [$('mAiry').value, $('mAgile').value, $('mCool').value],
          harmony: $('harmony').value, key: $('keySel').value, doubles: $('doubles').value,
          transpose: $('transpose').value, defSyl: $('defSyl').value
        }));
      } catch (e) { /* storage unavailable */ }
    }, 300);
  }
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!s || !Array.isArray(s.notes)) return false;
      state.bpm = s.bpm || 84; $('bpm').value = state.bpm;
      [$('mAiry').value, $('mAgile').value, $('mCool').value] = s.macros || [62, 58, 55];
      state.overrides = s.overrides || {};
      $('harmony').value = s.harmony || 'none'; $('keySel').value = s.key || 'auto';
      $('doubles').value = s.doubles || 'auto'; $('transpose').value = s.transpose || 0; $('defSyl').value = s.defSyl || 'ooh';
      setNotes(s.notes, { noHistory: true });
      $('exampleSel').value = '';
      return s.notes.length > 0;
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------ boot
  buildAdvanced();
  if (!restore()) loadExample(0);
  syncAdvanced();
  history.length = 0;
  window.addEventListener('resize', () => roll.resize());
  // repaint the roll when the colour scheme changes
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', () => roll.draw());
  }
  new MutationObserver(() => roll.draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  setStatus('Ready. Press Sing it.');
})();
