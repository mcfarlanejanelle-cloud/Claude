/*
 * Lumen melody inputs:
 *   - Standard MIDI File import (top line of the busiest track, lyrics meta events)
 *   - Hum-to-melody: YIN pitch tracking + note segmentation
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ MIDI files
  function parseMidiFile(arrayBuffer) {
    const d = new DataView(arrayBuffer);
    let p = 0;
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
    const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
    const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
    const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

    if (str(4) !== 'MThd') throw new Error('This is not a MIDI file (missing MThd header).');
    const hlen = u32();
    const format = u16(), ntrk = u16(), div = u16();
    p = 8 + hlen;
    if (div & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported.');
    let tempo = 500000;
    const tracks = [];
    for (let t = 0; t < ntrk && p < d.byteLength; t++) {
      const id = str(4), len = u32(), end = p + len;
      if (id !== 'MTrk') { p = end; continue; }
      let tick = 0, status = 0;
      const on = new Map();
      const notes = [], lyrics = [];
      let name = '';
      while (p < end) {
        tick += vlq();
        let b = d.getUint8(p);
        if (b & 0x80) { status = b; p++; } // running status otherwise
        const type = status & 0xf0, chan = status & 0x0f;
        if (status === 0xff) {
          const mt = d.getUint8(p++); const ml = vlq();
          if (mt === 0x51 && ml === 3) tempo = (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2);
          if (mt === 0x05 || mt === 0x01) {
            let s = ''; for (let i = 0; i < ml; i++) s += String.fromCharCode(d.getUint8(p + i));
            if (mt === 0x05) lyrics.push({ tick, text: s });
          }
          if (mt === 0x03) { for (let i = 0; i < ml; i++) name += String.fromCharCode(d.getUint8(p + i)); }
          p += ml;
        } else if (status === 0xf0 || status === 0xf7) {
          p += vlq();
        } else if (type === 0x90 || type === 0x80) {
          const note = d.getUint8(p++), vel = d.getUint8(p++);
          const k = chan * 128 + note;
          if (type === 0x90 && vel > 0) on.set(k, { tick, vel });
          else if (on.has(k)) {
            const s = on.get(k); on.delete(k);
            notes.push({ midi: note, startTick: s.tick, endTick: tick, vel: s.vel / 127, chan });
          }
        } else if (type === 0xc0 || type === 0xd0) p += 1;
        else p += 2;
      }
      p = end;
      tracks.push({ name, notes, lyrics });
    }
    const usable = tracks.filter((t) => t.notes.some((n) => n.chan !== 9));
    if (!usable.length) throw new Error('No melodic notes found in this MIDI file.');
    usable.sort((a, b) => b.notes.length - a.notes.length);
    // prefer a track that looks like a vocal by name
    const voc = usable.find((t) => /vox|vocal|voice|melody|lead|sing/i.test(t.name));
    const tr = voc || usable[0];
    const allLyrics = tracks.flatMap((t) => t.lyrics);
    const notes = tr.notes.filter((n) => n.chan !== 9).sort((a, b) => a.startTick - b.startTick || b.midi - a.midi);
    const out = [];
    for (const n of notes) {
      const start = n.startTick / div, len = Math.max(0.0625, (n.endTick - n.startTick) / div);
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev.start - start) < 1e-6) continue; // chord: keep top
      const ly = allLyrics.find((l) => Math.abs(l.tick - n.startTick) <= div / 32);
      out.push({ midi: n.midi, start, len, lyric: ly ? ly.text.trim().replace(/\s+/g, '~') : '', vel: Math.max(0.5, n.vel) });
    }
    for (let i = 0; i < out.length - 1; i++) if (out[i].start + out[i].len > out[i + 1].start) out[i].len = out[i + 1].start - out[i].start;
    const bpm = Math.round(60000000 / tempo);
    return { bpm, notes: out, trackName: tr.name, format };
  }

  // ------------------------------------------------------------ pitch tracking
  function toMono(audioBuffer) {
    const n = audioBuffer.length, ch = audioBuffer.numberOfChannels;
    const out = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = audioBuffer.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
    return out;
  }

  // YIN fundamental-frequency estimator. Returns frames [{t, hz|0, rms}]
  function trackPitch(samples, sr, opts) {
    opts = opts || {};
    const hop = Math.round(sr * 0.01);
    const W = Math.round(sr * 0.032);
    const minHz = opts.minHz || 70, maxHz = opts.maxHz || 1100;
    const tauMin = Math.floor(sr / maxHz), tauMax = Math.min(W - 1, Math.ceil(sr / minHz));
    const dfn = new Float32Array(tauMax + 1);
    const frames = [];
    // overall level for a gate
    let peak = 0; for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    for (let start = 0; start + W + tauMax < samples.length; start += hop) {
      let e = 0; for (let i = 0; i < W; i++) e += samples[start + i] ** 2;
      const rms = Math.sqrt(e / W);
      let hz = 0;
      if (rms > peak * 0.04) {
        for (let tau = 1; tau <= tauMax; tau++) {
          let s = 0;
          for (let i = 0; i < W; i += 2) { const x = samples[start + i] - samples[start + i + tau]; s += x * x; }
          dfn[tau] = s;
        }
        // cumulative mean normalized difference
        let run = 0; dfn[0] = 1;
        for (let tau = 1; tau <= tauMax; tau++) { run += dfn[tau]; dfn[tau] = run ? dfn[tau] * tau / run : 1; }
        let best = -1;
        for (let tau = tauMin; tau <= tauMax; tau++) {
          if (dfn[tau] < 0.15) { while (tau + 1 <= tauMax && dfn[tau + 1] < dfn[tau]) tau++; best = tau; break; }
        }
        if (best > 0) {
          // parabolic interpolation
          const a = dfn[best - 1], b = dfn[best], c = best + 1 <= tauMax ? dfn[best + 1] : b;
          const den = a + c - 2 * b;
          const shift = den ? (a - c) / (2 * den) : 0;
          hz = sr / (best + shift);
        }
      }
      frames.push({ t: (start + W / 2) / sr, hz, rms });
    }
    return frames;
  }

  // Turn pitch frames into notes (seconds)
  function segmentNotes(frames, opts) {
    opts = opts || {};
    const minDur = opts.minDur || 0.09;
    const midi = frames.map((f) => (f.hz ? 69 + 12 * Math.log2(f.hz / 440) : NaN));
    // median filter (5) to kill octave blips
    const med = midi.map((_, i) => {
      const w = [];
      for (let k = -2; k <= 2; k++) { const v = midi[i + k]; if (v === v && v !== undefined) w.push(v); }
      if (isNaN(midi[i]) || w.length < 3) return NaN;
      w.sort((a, b) => a - b);
      return w[w.length >> 1];
    });
    const notes = [];
    let cur = null;
    const flush = () => {
      if (cur && cur.t1 - cur.t0 >= minDur) {
        cur.vals.sort((a, b) => a - b);
        const m = cur.vals[cur.vals.length >> 1];
        notes.push({ t0: cur.t0, t1: cur.t1, pitch: m });
      }
      cur = null;
    };
    for (let i = 0; i < frames.length; i++) {
      const v = med[i], t = frames[i].t;
      if (isNaN(v)) { flush(); continue; }
      if (cur) {
        const centre = cur.vals.slice().sort((a, b) => a - b)[cur.vals.length >> 1];
        // new note when pitch moves > 0.7 semitone and stays there
        const ahead = med.slice(i, i + 4).filter((x) => !isNaN(x));
        const moved = Math.abs(v - centre) > 0.7 && ahead.length >= 3 && ahead.every((x) => Math.abs(x - v) < 0.8);
        // re-articulation: a dip in level
        const dip = frames[i].rms < 0.45 * (frames[i - 3] ? frames[i - 3].rms : frames[i].rms) && frames[i + 2] && frames[i + 2].rms > frames[i].rms * 1.4;
        if (moved || dip) { cur.t1 = t; flush(); }
      }
      if (!cur) cur = { t0: t, t1: t, vals: [] };
      cur.vals.push(v); cur.t1 = t + 0.01;
    }
    flush();
    // drop short glide fragments that sit between two neighbouring notes
    for (let i = notes.length - 2; i >= 1; i--) {
      const a = notes[i - 1], n = notes[i], b = notes[i + 1];
      const lo = Math.min(a.pitch, b.pitch), hi = Math.max(a.pitch, b.pitch);
      if (n.t1 - n.t0 < 0.14 && n.t0 - a.t1 < 0.04 && b.t0 - n.t1 < 0.04 && n.pitch > lo + 0.3 && n.pitch < hi - 0.3) {
        b.t0 = n.t0 + (n.t1 - n.t0) / 2; a.t1 = b.t0;
        notes.splice(i, 1);
      }
    }
    // merge tiny gaps between equal pitches
    const merged = [];
    for (const n of notes) {
      const p = merged[merged.length - 1];
      if (p && Math.round(p.pitch) === Math.round(n.pitch) && n.t0 - p.t1 < 0.05) p.t1 = n.t1;
      else merged.push(n);
    }
    return merged;
  }

  // Seconds -> score notes in beats. Options: bpm, grid (beats), fitRange
  function notesToScore(segs, opts) {
    const S = root.Lumen.score;
    const bpm = opts.bpm || 84, grid = opts.grid || 0.25, bps = bpm / 60;
    if (!segs.length) return [];
    let notes = segs.map((s) => ({ midi: Math.round(s.pitch), start: s.t0 * bps, len: (s.t1 - s.t0) * bps, raw: s.pitch }));
    // keep the timing relative to the downbeat nearest the first note
    if (opts.alignStart) {
      const off = Math.floor(notes[0].start / 1) * 1; // whole beats of lead-in silence removed
      notes.forEach((n) => { n.start -= off; });
    }
    // fit to a comfortable range for her (median near G4)
    if (opts.fitRange) {
      const ms = notes.map((n) => n.midi).sort((a, b) => a - b);
      const median = ms[ms.length >> 1];
      const oct = Math.round((67 - median) / 12);
      notes.forEach((n) => { n.midi += oct * 12; });
    }
    // snap to key
    if (opts.snapKey) {
      const key = S.detectKey(notes.map((n) => ({ midi: n.midi, len: n.len })));
      const pcs = S.scalePCs(key, false);
      notes.forEach((n) => {
        if (!S.inScale(n.midi, pcs)) {
          const up = n.midi + 1, dn = n.midi - 1;
          const raw = n.raw + (n.midi - Math.round(n.raw));
          n.midi = S.inScale(up, pcs) && (!S.inScale(dn, pcs) || raw > n.midi) ? up : dn;
        }
      });
    }
    // quantize
    const q = (x) => Math.round(x / grid) * grid;
    const out = [];
    for (const n of notes) {
      let s = q(n.start), e = q(n.start + n.len);
      if (e <= s) e = s + grid;
      const prev = out[out.length - 1];
      if (prev && s < prev.start + prev.len) {
        if (s <= prev.start) { s = prev.start + prev.len; if (e <= s) e = s + grid; }
        else prev.len = s - prev.start;
      }
      out.push({ midi: n.midi, start: Math.max(0, s), len: e - s, lyric: '' });
    }
    return out;
  }

  const api = { parseMidiFile, toMono, trackPitch, segmentNotes, notesToScore };
  root.Lumen = root.Lumen || {};
  root.Lumen.input = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
