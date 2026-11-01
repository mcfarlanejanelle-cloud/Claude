/*
 * Lumen score helpers
 * -------------------
 * A score is { bpm, notes: [{ midi, start, len, lyric, vel }] } with
 * start/len in beats. This file parses and prints the text notation,
 * detects keys and walks scales.
 *
 * Notation (one token per note, spaces or bar lines between tokens):
 *    E4:1/hold   G4:.5/me   R:1   C5:2/ooh   Bb4:1/_
 *    NOTE[:BEATS][/LYRIC]     R or - is a rest     _ continues the syllable
 */
(function (root) {
  'use strict';

  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

  function noteName(m) {
    const r = Math.round(m);
    return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
  }

  function parsePitch(str) {
    const s = String(str).trim();
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    const m = s.match(/^([A-Ga-g])([#b♯♭s]*)(-?\d)$/);
    if (!m) return null;
    let pc = PC[m[1].toLowerCase()];
    for (const ch of m[2]) pc += ch === '#' || ch === '♯' || ch === 's' ? 1 : -1;
    return pc + (parseInt(m[3], 10) + 1) * 12;
  }

  function parseNotation(text) {
    const notes = [];
    const errors = [];
    let beat = 0;
    const tokens = String(text || '').replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      if (tok.startsWith('#')) continue;
      const slash = tok.indexOf('/');
      const head = slash >= 0 ? tok.slice(0, slash) : tok;
      const lyric = slash >= 0 ? tok.slice(slash + 1) : '';
      const [p, l] = head.split(':');
      const len = l === undefined || l === '' ? 1 : parseFloat(l);
      if (!(len > 0)) { errors.push(`"${tok}": length must be a positive number of beats`); continue; }
      if (/^(r|-|rest)$/i.test(p)) { beat += len; continue; }
      const midi = parsePitch(p);
      if (midi == null) { errors.push(`"${tok}": can't read the pitch "${p}" (try C4, F#4, Bb3 or a MIDI number)`); continue; }
      notes.push({ midi, start: beat, len, lyric: lyric.replace(/~/g, ' ') });
      beat += len;
    }
    return { notes, errors };
  }

  const fmtNum = (x) => {
    const r = Math.round(x * 1000) / 1000;
    return String(r).replace(/^0\./, '.');
  };

  function formatNotation(notes) {
    const sorted = notes.slice().sort((a, b) => a.start - b.start);
    const out = [];
    let beat = 0;
    let barBeat = 0;
    for (const n of sorted) {
      if (n.start > beat + 1e-6) { out.push('R:' + fmtNum(n.start - beat)); beat = n.start; }
      // overlapping notes: shorten the earlier one in the text
      let len = n.len;
      const tok = noteName(n.midi) + ':' + fmtNum(len) + (n.lyric ? '/' + String(n.lyric).replace(/\s+/g, '~') : '');
      out.push(tok);
      beat = n.start + len;
      if (Math.floor(beat / 4) > barBeat) { barBeat = Math.floor(beat / 4); out.push('|'); }
    }
    if (out[out.length - 1] === '|') out.pop();
    // break lines every 4 bars for readability
    const lines = [];
    let line = [];
    let bars = 0;
    for (const t of out) {
      line.push(t);
      if (t === '|' && ++bars % 2 === 0) { lines.push(line.join(' ')); line = []; }
    }
    if (line.length) lines.push(line.join(' '));
    return lines.join('\n');
  }

  // monophonic: when notes overlap, trim the earlier one
  function monophonize(notes) {
    const s = notes.slice().sort((a, b) => a.start - b.start || b.midi - a.midi);
    const out = [];
    for (const n of s) {
      const prev = out[out.length - 1];
      if (prev && n.start < prev.start + 1e-6) continue;          // same start: keep top
      if (prev && prev.start + prev.len > n.start) prev.len = Math.max(0.0625, n.start - prev.start);
      out.push(Object.assign({}, n));
    }
    return out;
  }

  // ---- keys & scales
  const MODES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10]
  };
  const PENTA = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10], dorian: [0, 3, 5, 7, 10], mixolydian: [0, 2, 4, 7, 9] };

  // Krumhansl-Kessler profiles
  const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function detectKey(notes) {
    const h = new Array(12).fill(0);
    for (const n of notes) h[((Math.round(n.midi) % 12) + 12) % 12] += n.len || 1;
    if (!notes.length) return { root: 0, mode: 'minor' };
    let best = { score: -Infinity, root: 0, mode: 'minor' };
    for (let r = 0; r < 12; r++) {
      for (const [mode, prof] of [['major', KK_MAJ], ['minor', KK_MIN]]) {
        let sc = 0;
        for (let i = 0; i < 12; i++) sc += h[(i + r) % 12] * prof[i];
        // the last note is often the tonic
        if (((notes[notes.length - 1].midi - r) % 12 + 12) % 12 === 0) sc += 2;
        if (sc > best.score) best = { score: sc, root: r, mode };
      }
    }
    return { root: best.root, mode: best.mode };
  }

  function scalePCs(key, penta) {
    const ivs = (penta ? PENTA : MODES)[key.mode] || MODES.major;
    return ivs.map((i) => (i + key.root) % 12);
  }

  function inScale(m, pcs) { return pcs.includes(((Math.round(m) % 12) + 12) % 12); }

  // move k scale steps from m (m snapped into the scale first)
  function scaleStep(m, k, pcs) {
    let x = Math.round(m);
    if (!inScale(x, pcs)) {
      // snap toward the direction of travel
      const dir = k >= 0 ? -1 : 1;
      let y = x;
      for (let i = 0; i < 12 && !inScale(y, pcs); i++) y += dir;
      x = y;
    }
    const dir = k >= 0 ? 1 : -1;
    let steps = Math.abs(k);
    while (steps > 0) { x += dir; if (inScale(x, pcs)) steps--; }
    return x;
  }

  function keyName(key) { return NAMES[key.root] + ' ' + key.mode; }

  const api = { noteName, parsePitch, parseNotation, formatNotation, monophonize, detectKey, scalePCs, scaleStep, inScale, keyName, MODES, NAMES };
  root.Lumen = root.Lumen || {};
  root.Lumen.score = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
