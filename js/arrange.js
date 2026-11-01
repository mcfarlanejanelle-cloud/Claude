/*
 * Lumen arranger
 * --------------
 * Turns a score (beats + lyrics) and a style into voice "jobs" the
 * engine can render: timing, syllables, legato, scoops, fall-offs,
 * melismatic runs, laid-back phrasing, stacked doubles and harmonies.
 */
(function (root) {
  'use strict';
  const L = root.Lumen;
  const E = () => L.engine, S = () => L.score, Y = () => L.lyrics;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  // ------------------------------------------------------------ style
  // Three character macros (0..1) -> concrete voice/phrasing parameters.
  //   airy  : breath, softness, space, stacked layers
  //   agile : runs, scoops, vibrato energy
  //   cool  : restraint, straight tone, laid-back timing, sighing falls
  function styleFromMacros(airy, agile, cool) {
    const A = airy, G = agile, C = cool;
    return {
      breathiness: 0.2 + 0.55 * A,
      brightness: clamp(0.7 - 0.25 * C - 0.1 * A + 0.12 * G, 0.05, 1),
      vibRate: 5.0 + 1.0 * G - 0.3 * C,
      vibDepth: 14 + 42 * G * (1 - 0.4 * C) + 10 * (1 - C),
      vibDelay: 0.22 + 0.35 * C,
      portamento: 0.035 + 0.045 * C,
      attack: 0.03 + 0.09 * A,
      release: 0.07 + 0.12 * A,
      formantShift: 1.03 + 0.06 * A,
      agility: G,
      runSpeed: 0.1 - 0.04 * G,
      scoop: 0.4 + 2.0 * G,
      fall: 0.8 + 3 * C,
      layback: 0.05 * C,
      doubles: A > 0.45 ? 2 : 0,
      doubleLevel: 0.16 + 0.3 * A,
      reverb: 0.12 + 0.45 * A,
      delay: 0.04 + 0.25 * A,
      air: 1 + 5 * A,
      breaths: 0.25 + 0.55 * A,
      fryChance: 0.08 + 0.4 * C,
      humanize: 1
    };
  }

  // ------------------------------------------------------------ helpers
  function splitNucleus(nuc) {
    const D = E().DIPHTHONGS;
    const out = [];
    for (const v of nuc) { if (D[v]) out.push(...D[v]); else out.push(v); }
    return out;
  }

  function makeSyllables(notes, defaultSyl) {
    const g2p = Y().g2p;
    const def = g2p(defaultSyl || 'ooh') || { onset: [], nucleus: ['UW'], coda: [] };
    let prev = null;
    for (const n of notes) {
      const lyr = (n.lyric || '').trim();
      if ((lyr === '_' || lyr === '+') && prev) {
        // melisma: continue the previous syllable's vowel
        const full = prev._nucleusFull;
        const parts = splitNucleus(full);
        prev.nucleus = [parts[0]];
        n.onset = [];
        n.nucleus = full;
        n._nucleusFull = full;
        n.coda = prev.coda; prev.coda = [];
        n.melisma = true;
      } else {
        const ph = g2p(lyr) || def;
        n.onset = ph.onset.slice(); n.nucleus = ph.nucleus.slice(); n.coda = ph.coda.slice();
        n._nucleusFull = ph.nucleus.slice();
      }
      prev = n;
    }
  }

  function linkLegato(notes, thresh) {
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i], nx = notes[i + 1];
      n.legatoNext = false;
      if (i === 0) n.legatoPrev = false;
      if (nx) {
        const gap = nx.t0 - n.t1;
        if (gap < thresh || nx.melisma) { n.legatoNext = true; n.t1 = Math.max(n.t0 + 0.03, nx.t0); nx.legatoPrev = true; }
        else nx.legatoPrev = false;
      }
    }
  }

  function phrases(notes, gapSec) {
    const out = [];
    let cur = [];
    for (let i = 0; i < notes.length; i++) {
      if (cur.length && notes[i].t0 - cur[cur.length - 1].t1 > gapSec) { out.push(cur); cur = []; }
      cur.push(notes[i]);
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // split one note into ornament pieces + main body, same syllable
  function piecewise(n, pieces) {
    // pieces: [{midi, dur|null}] - exactly one has dur null (the body)
    const fixed = pieces.reduce((s, p) => s + (p.dur || 0), 0);
    const total = n.t1 - n.t0;
    const bodyDur = total - fixed;
    if (bodyDur < 0.06) return [n];
    const nucParts = splitNucleus(n.nucleus);
    const out = [];
    let t = n.t0;
    pieces.forEach((p, i) => {
      const d = p.dur == null ? bodyDur : p.dur;
      const first = i === 0, last = i === pieces.length - 1;
      out.push({
        midi: p.midi, t0: t, t1: t + d, vel: n.vel * (p.dur == null ? 1 : 0.9) * (p.velMul || 1),
        onset: first ? n.onset : [],
        nucleus: last ? n.nucleus : [nucParts[0]],
        coda: last ? n.coda : [],
        legatoPrev: first ? n.legatoPrev : true,
        legatoNext: last ? n.legatoNext : true,
        melisma: first ? n.melisma : true,
        ornament: p.dur != null,
        vibScale: p.dur == null ? 1 : 0
      });
      t += d;
    });
    return out;
  }

  function between(a, b, pcs, max) {
    const dir = b > a ? 1 : -1;
    const tones = [];
    for (let m = a + dir; dir > 0 ? m < b : m > b; m += dir) if (S().inScale(m, pcs)) tones.push(m);
    if (tones.length <= max) return tones;
    return tones.slice(tones.length - max); // the ones nearest the target
  }

  function ornament(notes, style, key, rand) {
    const pcsD = S().scalePCs(key, false);
    const pcsP = S().scalePCs(key, true);
    const step = Math.max(0.05, style.runSpeed);
    const out = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i], nx = notes[i + 1];
      const dur = n.t1 - n.t0;
      const phraseEnd = !nx || nx.t0 - n.t1 > 0.25;
      const cands = [];
      if (nx && n.legatoNext && Math.abs(nx.midi - n.midi) >= 3 && dur >= 0.35) cands.push(['tail', 3]);
      if (phraseEnd && dur >= 0.55) cands.push(['fall', 2]);
      if (dur >= 0.7) cands.push(['turn', 1.5]);
      if (dur >= 0.3) cands.push(['flip', 1]);
      if (!cands.length || rand() > style.agility * 0.85) { out.push(n); continue; }
      let tot = cands.reduce((s, c) => s + c[1], 0), r = rand() * tot, kind = cands[0][0];
      for (const c of cands) { if ((r -= c[1]) <= 0) { kind = c[0]; break; } }
      const m = n.midi;
      let pieces;
      if (kind === 'tail') {
        let pass = between(m, nx.midi, pcsP, 4);
        if (!pass.length) pass = between(m, nx.midi, pcsD, 3);
        // R&B approach: sometimes overshoot one step past the target first
        if (rand() < 0.35) pass.push(S().scaleStep(nx.midi, nx.midi > m ? 1 : -1, pcsP));
        const d = Math.min(step, (dur * 0.5) / Math.max(1, pass.length));
        pieces = [{ midi: m, dur: null }].concat(pass.map((x) => ({ midi: x, dur: d })));
        // body is first here; put a tiny final piece so the last piece keeps coda
      } else if (kind === 'fall') {
        const a = S().scaleStep(m, -1, pcsP), b = S().scaleStep(m, -2, pcsP), c = S().scaleStep(m, -3, pcsP);
        const d = Math.min(step * 1.15, dur * 0.16);
        const seq = rand() < 0.5 ? [S().scaleStep(m, 1, pcsP), m, a, b] : [m, a, b, c];
        pieces = [{ midi: m, dur: null }].concat(seq.map((x, k) => ({ midi: x, dur: d, velMul: 1 - 0.12 * k })));
      } else if (kind === 'turn') {
        const up = S().scaleStep(m, 1, pcsD), dn = S().scaleStep(m, -1, pcsD);
        const d = Math.min(step, dur * 0.12);
        const bodyA = dur * 0.35;
        pieces = [{ midi: m, dur: bodyA }, { midi: up, dur: d }, { midi: m, dur: d }, { midi: dn, dur: d }, { midi: m, dur: null }];
      } else {
        const up = S().scaleStep(m, 1, pcsD);
        pieces = [{ midi: up, dur: Math.min(step * 0.8, dur * 0.25) }, { midi: m, dur: null }];
      }
      const split = piecewise(n, pieces);
      out.push(...split);
    }
    return out;
  }

  // ------------------------------------------------------------ main
  function arrange(score, style, opts) {
    opts = opts || {};
    const rand = E().rng((opts.seed || 1) * 31 + 7);
    const bpm = score.bpm || 84;
    const spb = 60 / bpm;
    const transpose = opts.transpose || 0;
    const base = S().monophonize(score.notes || []).map((n) => ({
      midi: n.midi + transpose, start: n.start, len: n.len, lyric: n.lyric, vel: n.vel == null ? 0.82 : n.vel
    }));
    const key = opts.key && opts.key !== 'auto' ? opts.key : S().detectKey(base);
    if (!base.length) return { key, jobs: [], duration: 0, timeShift: 0 };

    let notes = base.map((n) => ({ midi: n.midi, t0: n.start * spb, t1: (n.start + n.len) * spb, vel: n.vel, lyric: n.lyric }));
    makeSyllables(notes, opts.defaultSyllable);
    linkLegato(notes, 0.06);

    // dynamics: gentle arch across each phrase
    for (const ph of phrases(notes, 0.25)) {
      ph.forEach((n, i) => {
        const pos = ph.length > 1 ? i / (ph.length - 1) : 0.5;
        n.vel *= 0.9 + 0.1 * Math.sin(Math.PI * pos) + (rand() - 0.5) * 0.06;
      });
    }

    // runs & ornaments
    notes = ornament(notes, style, key, rand);

    // scoops & falls
    const ph2 = phrases(notes, 0.25);
    for (const ph of ph2) {
      ph.forEach((n, i) => {
        const dur = n.t1 - n.t0;
        if (!n.legatoPrev && dur > 0.18 && rand() < 0.3 + 0.5 * style.agility) n.scoop = style.scoop * (0.55 + 0.45 * rand());
        else if (n.legatoPrev && !n.ornament && dur > 0.25 && rand() < 0.25 * style.agility) n.scoop = style.scoop * 0.4;
      });
      const last = ph[ph.length - 1];
      if (!last.ornament && last.t1 - last.t0 >= 0.4 && rand() < 0.35 + 0.4 * (style.fall / 4)) last.fall = style.fall * (0.5 + 0.5 * rand());
    }

    // laid-back phrasing: each phrase sits a little behind the beat
    for (const ph of ph2) {
      const off = style.layback * (0.5 + 0.5 * rand()) + 0.008 * (rand() - 0.5);
      for (const n of ph) { n.t0 += off; n.t1 += off; }
    }
    // tiny note-to-note timing variation inside phrases (nobody is a sequencer)
    const hum = style.humanize == null ? 1 : style.humanize;
    for (const ph of ph2) {
      for (let i = 1; i < ph.length; i++) {
        const n = ph[i], pv = ph[i - 1];
        if (n.ornament || pv.ornament) continue;
        const d = (rand() - 0.5) * 0.024 * hum;
        const t0 = n.t0 + d;
        if (t0 < pv.t0 + 0.05 || t0 > n.t1 - 0.05) continue;
        n.t0 = t0;
        if (pv.legatoNext) pv.t1 = t0;
      }
    }

    // breath intakes before phrases, creaky (fry) phrase endings
    for (let pi = 0; pi < ph2.length; pi++) {
      const ph = ph2[pi], first = ph[0], last = ph[ph.length - 1];
      const prevEnd = pi === 0 ? -Infinity : ph2[pi - 1][ph2[pi - 1].length - 1].t1;
      const gap = first.t0 - prevEnd;
      const phraseLen = last.t1 - first.t0;
      if ((style.breaths || 0) > 0 && gap > 0.45) {
        const want = 0.22 + 0.12 * rand() + Math.min(0.15, phraseLen * 0.03);
        first.inhale = Math.max(0.15, Math.min(want, gap - 0.25));
        first.inhaleLevel = (0.6 + 0.4 * rand()) * Math.min(1, 0.5 + phraseLen / 6);
      }
      if (last.t1 - last.t0 >= 0.35 && rand() < (style.fryChance || 0)) last.fry = 0.35 + 0.5 * rand();
    }

    // make sure nothing starts before zero (consonants and breaths lead the beat)
    const lead = notes[0].inhale ? notes[0].inhale + 0.2 : 0.12;
    const shift = Math.max(0, lead - notes[0].t0);
    if (shift) for (const n of notes) { n.t0 += shift; n.t1 += shift; }

    const voiceBase = {
      breathiness: style.breathiness, brightness: style.brightness, vibRate: style.vibRate, vibDepth: style.vibDepth,
      vibDelay: style.vibDelay, portamento: style.portamento, attack: style.attack, release: style.release,
      formantShift: style.formantShift, breaths: style.breaths, humanize: style.humanize
    };

    const jobs = [{ name: 'Lead', notes, opts: Object.assign({}, voiceBase, { seed: 1 }), pan: 0, gain: 1 }];

    const copyNotes = (src, fnMidi, timeJit, r) => {
      const out = [];
      for (const ph of phrases(src, 0.25)) {
        const off = timeJit * (0.4 + 0.6 * r());
        for (const n of ph) out.push(Object.assign({}, n, { midi: fnMidi(n.midi), t0: n.t0 + off, t1: n.t1 + off }));
      }
      return out;
    };

    // stacked doubles (same line, slightly off in time & tune, wide)
    const nd = Math.round(opts.doubles == null ? style.doubles : opts.doubles);
    for (let d = 0; d < nd; d++) {
      const r = E().rng(101 + d * 13);
      jobs.push({
        name: 'Double ' + (d + 1),
        notes: copyNotes(notes, (m) => m, 0.022, r),
        opts: Object.assign({}, voiceBase, {
          seed: 11 + d * 7, detune: d % 2 ? 7 : -6, breaths: style.breaths * 0.25, breathiness: clamp(style.breathiness + 0.15, 0, 1),
          vibDepth: style.vibDepth * 0.6, brightness: style.brightness * 0.85
        }),
        pan: d % 2 ? 0.75 : -0.75,
        gain: (opts.doubleLevel == null ? style.doubleLevel : opts.doubleLevel)
      });
    }

    // harmonies (diatonic, parallel; runs harmonize too)
    const HARM = {
      none: [], thirds: [2], stack: [2, 4], below: [-3], lush: [2, -3], octave: ['-12']
    };
    const pcs = S().scalePCs(key, false);
    const hs = HARM[opts.harmony || 'none'] || [];
    hs.forEach((k, hi) => {
      const r = E().rng(303 + hi * 17);
      const f = typeof k === 'string' ? (m) => m + parseInt(k, 10) : (m) => S().scaleStep(m, k, pcs);
      jobs.push({
        name: 'Harmony ' + (hi + 1),
        notes: copyNotes(notes, f, 0.016, r),
        opts: Object.assign({}, voiceBase, {
          seed: 41 + hi * 5, breaths: style.breaths * 0.25, breathiness: clamp(style.breathiness + 0.12, 0, 1),
          vibDepth: style.vibDepth * 0.55, brightness: style.brightness * 0.9
        }),
        pan: hs.length === 1 ? 0.35 : (hi % 2 ? 0.45 : -0.45),
        gain: (opts.harmonyLevel == null ? 0.5 : opts.harmonyLevel)
      });
    });

    let duration = 0;
    for (const j of jobs) for (const n of j.notes) duration = Math.max(duration, n.t1);
    return { key, jobs, duration, timeShift: shift };
  }

  const api = { arrange, styleFromMacros };
  root.Lumen = root.Lumen || {};
  root.Lumen.arrange = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
