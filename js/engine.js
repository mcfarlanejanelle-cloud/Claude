/*
 * Lumen voice engine
 * ------------------
 * A source-filter singing synthesizer:
 *   glottal pulse (Rosenberg model) + aspiration noise
 *     -> cascade of 5 formant resonators (the vocal tract)
 *   + a parallel frication-noise path for consonants (s, sh, t, k ...)
 *
 * Everything is rendered offline into a Float32Array, which keeps the
 * engine deterministic and lets it run in the browser or in Node.
 *
 * Input "notes" are already timed in seconds and carry phones
 * (see arrange.js). The engine only knows how to sing them.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- tables
  // Formants (Hz) and bandwidths (Hz) for a light female / head-voice tract.
  // g = relative source gain for that nucleus (hums are quieter).
  const VOWELS = {
    AA: { f: [800, 1150, 2900, 3900, 4950], b: [80, 90, 120, 130, 140] },  // father
    AE: { f: [820, 1900, 2850, 3900, 4950], b: [80, 100, 120, 130, 140] }, // cat
    EH: { f: [600, 1900, 2800, 3800, 4950], b: [70, 100, 120, 150, 200] }, // bed
    IY: { f: [300, 2350, 3000, 3900, 4950], b: [60, 90, 100, 120, 120] },  // see
    IH: { f: [430, 2050, 2900, 3900, 4950], b: [70, 90, 110, 130, 140] },  // bit
    OH: { f: [480, 820, 2830, 3800, 4950], b: [70, 80, 100, 130, 135] },   // go (start)
    AO: { f: [620, 950, 2800, 3800, 4950], b: [70, 80, 100, 130, 135] },   // law
    UW: { f: [340, 720, 2700, 3800, 4950], b: [50, 60, 170, 180, 200] },   // you
    UH: { f: [460, 1050, 2750, 3800, 4950], b: [60, 80, 150, 170, 200] },  // book
    AH: { f: [720, 1300, 2850, 3850, 4950], b: [80, 90, 120, 130, 140] },  // but
    AX: { f: [560, 1500, 2800, 3800, 4950], b: [80, 90, 120, 130, 140] },  // about
    ER: { f: [500, 1400, 1750, 3800, 4950], b: [70, 90, 110, 130, 140] },  // her
    MM: { f: [280, 1000, 2300, 3400, 4500], b: [90, 250, 300, 300, 300], g: 0.45 }, // hum (closed lips)
    NN: { f: [280, 1600, 2600, 3400, 4500], b: [90, 250, 300, 300, 300], g: 0.45 }  // hum (n)
  };

  // Diphthongs = two nucleus targets, glide happens late in the note.
  const DIPHTHONGS = {
    EY: ['EH', 'IY'], AY: ['AA', 'IY'], OW: ['OH', 'UW'], AW: ['AA', 'UW'], OY: ['AO', 'IY']
  };

  // Consonants: list of sub-segments.
  //  d  = duration (s)        g  = articulation gain (0 = full closure)
  //  v  = voicing amount      asp = aspiration amount (through the tract)
  //  fr = frication amount    ff/fq = frication centre (Hz) / Q
  //  F/B = tract formants during the segment ('next' = take the vowel's)
  const N = 'next';
  const CONS = {
    P: [{ d: 0.045, g: 0, F: N }, { d: 0.03, v: 0, asp: 0.5, fr: 0.45, ff: 900, fq: 0.8, F: N }],
    B: [{ d: 0.035, g: 0.12, F: [250, 800, 2400, 3500, 4500] }, { d: 0.015, v: 0.8, fr: 0.2, ff: 900, fq: 0.8, F: N }],
    T: [{ d: 0.04, g: 0, F: N }, { d: 0.035, v: 0, asp: 0.45, fr: 0.8, ff: 4500, fq: 1.5, F: N }],
    D: [{ d: 0.03, g: 0.12, F: [250, 1700, 2600, 3500, 4500] }, { d: 0.015, v: 0.8, fr: 0.25, ff: 4000, fq: 1.5, F: N }],
    K: [{ d: 0.045, g: 0, F: N }, { d: 0.04, v: 0, asp: 0.55, fr: 0.6, ff: 2200, fq: 2, F: N }],
    G: [{ d: 0.035, g: 0.12, F: [250, 1900, 2300, 3500, 4500] }, { d: 0.02, v: 0.8, fr: 0.25, ff: 2200, fq: 2, F: N }],
    F: [{ d: 0.08, v: 0, fr: 0.35, ff: 5500, fq: 0.6, asp: 0.1, F: N }],
    V: [{ d: 0.06, v: 0.5, fr: 0.22, ff: 5000, fq: 0.6, F: [300, 1100, 2400, 3500, 4500] }],
    TH: [{ d: 0.07, v: 0, fr: 0.3, ff: 6000, fq: 0.7, F: N }],
    DH: [{ d: 0.04, v: 0.6, fr: 0.12, ff: 5000, fq: 0.7, F: [300, 1600, 2600, 3500, 4500] }],
    S: [{ d: 0.1, v: 0, fr: 1, ff: 7000, fq: 2.2, F: N }],
    Z: [{ d: 0.07, v: 0.5, fr: 0.55, ff: 6500, fq: 2, F: [300, 1600, 2600, 3500, 4500] }],
    SH: [{ d: 0.1, v: 0, fr: 1, ff: 3200, fq: 1.6, F: N }],
    ZH: [{ d: 0.07, v: 0.5, fr: 0.55, ff: 3000, fq: 1.6, F: [300, 1800, 2500, 3500, 4500] }],
    HH: [{ d: 0.07, v: 0, asp: 2, fr: 0.45, ff: 1900, fq: 0.5, F: N }],
    M: [{ d: 0.07, v: 1, g: 0.3, F: [280, 1000, 2300, 3400, 4500], B: [90, 250, 300, 300, 300] }],
    N: [{ d: 0.07, v: 1, g: 0.3, F: [280, 1600, 2600, 3400, 4500], B: [90, 250, 300, 300, 300] }],
    NG: [{ d: 0.07, v: 1, g: 0.3, F: [280, 2200, 2700, 3400, 4500], B: [90, 250, 300, 300, 300] }],
    L: [{ d: 0.06, v: 1, g: 0.75, F: [380, 1100, 2700, 3600, 4700] }],
    R: [{ d: 0.06, v: 1, g: 0.8, F: [420, 1100, 1600, 3300, 4500] }],
    W: [{ d: 0.05, v: 1, g: 0.75, F: [320, 700, 2400, 3500, 4500] }],
    Y: [{ d: 0.05, v: 1, g: 0.8, F: [290, 2300, 3000, 3800, 4800] }]
  };
  CONS.CH = CONS.T.slice(0, 1).concat([{ d: 0.08, v: 0, fr: 0.9, ff: 3300, fq: 1.6, F: N }]);
  CONS.JH = CONS.D.slice(0, 1).concat([{ d: 0.06, v: 0.5, fr: 0.5, ff: 3000, fq: 1.6, F: [300, 1800, 2500, 3500, 4500] }]);

  const DEFAULT_B = [80, 100, 140, 160, 180];

  // ---------------------------------------------------------------- utils
  function rng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return function () { // xorshift32 -> [0,1)
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function nucleusList(nuc) {
    const out = [];
    for (const v of nuc || []) {
      if (DIPHTHONGS[v]) out.push(...DIPHTHONGS[v]);
      else if (VOWELS[v]) out.push(v);
    }
    if (!out.length) out.push('UW');
    return out;
  }

  function expandCons(list, scale) {
    const segs = [];
    for (const c of list || []) {
      const def = CONS[c];
      if (!def) continue;
      for (const s of def) segs.push(Object.assign({}, s, { d: s.d * scale }));
    }
    return segs;
  }


  // ---------------------------------------------------------------- glottal source
  // Liljencrants-Fant (LF) glottal flow derivative, parameterised by Rd
  // (Fant 1995). Low Rd = pressed/tense, ~1 = modal, high Rd = breathy/soft.
  // One period of each Rd is pre-computed as a wavetable, plus its flow
  // (for noise modulation) and harmonic powers (for loudness compensation).
  const LF_N = 2048, RD_MIN = 0.3, RD_MAX = 2.7, RD_STEP = 0.1;
  let LF_TABLES = null;

  function buildLF(Rd) {
    const Ra = (-1 + 4.8 * Rd) / 100, Rk = (22.4 + 11.8 * Rd) / 100;
    const Rg = (Rk * (0.5 + 1.2 * Rk)) / (0.44 * Rd - 4 * Ra * (0.5 + 1.2 * Rk));
    const tp = 1 / (2 * Rg);
    const te = Math.min(0.97, tp * (1 + Rk));
    const ta = Math.max(0.002, Ra);
    const wg = Math.PI / tp;
    let eps = 1 / ta;
    for (let i = 0; i < 60; i++) eps = (1 - Math.exp(-eps * (1 - te))) / ta;
    // return-phase area (Ee = 1)
    const R = -(1 / (eps * ta)) * ((1 - Math.exp(-eps * (1 - te))) / eps - (1 - te) * Math.exp(-eps * (1 - te)));
    const open = (a) => {
      const E0 = -1 / (Math.exp(a * te) * Math.sin(wg * te));
      const I = (Math.exp(a * te) * (a * Math.sin(wg * te) - wg * Math.cos(wg * te)) + wg) / (a * a + wg * wg);
      return E0 * I;
    };
    // solve open(a) + R = 0 for the growth factor a
    let lo = -20, hi = 80;
    const f = (a) => open(a) + R;
    for (let k = 0; k < 40 && f(lo) * f(hi) > 0; k++) { lo -= 20; hi += 40; }
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; }
    const a = (lo + hi) / 2;
    const E0 = -1 / (Math.exp(a * te) * Math.sin(wg * te));
    const d = new Float32Array(LF_N + 1);
    for (let i = 0; i < LF_N; i++) {
      const t = i / LF_N;
      d[i] = t < te ? E0 * Math.exp(a * t) * Math.sin(wg * t)
        : -(1 / (eps * ta)) * (Math.exp(-eps * (t - te)) - Math.exp(-eps * (1 - te)));
    }
    // remove any residual DC so the flow returns to zero
    let mean = 0; for (let i = 0; i < LF_N; i++) mean += d[i]; mean /= LF_N;
    for (let i = 0; i < LF_N; i++) d[i] -= mean;
    d[LF_N] = d[0];
    const flow = new Float32Array(LF_N + 1);
    let acc = 0, fmax = 1e-9, fmin = 0;
    for (let i = 0; i < LF_N; i++) { acc += d[i]; flow[i] = acc; fmax = Math.max(fmax, acc); fmin = Math.min(fmin, acc); }
    for (let i = 0; i < LF_N; i++) flow[i] = (flow[i] - fmin) / (fmax - fmin);
    flow[LF_N] = flow[0];
    const harm = new Float64Array(41);
    for (let h = 1; h <= 40; h++) {
      let re = 0, im = 0;
      for (let i = 0; i < LF_N; i++) { const w = 2 * Math.PI * h * i / LF_N; re += d[i] * Math.cos(w); im -= d[i] * Math.sin(w); }
      harm[h] = (re * re + im * im) / (LF_N * LF_N);
    }
    return { d, flow, harm };
  }

  function lfTables() {
    if (!LF_TABLES) {
      LF_TABLES = [];
      for (let rd = RD_MIN; rd <= RD_MAX + 1e-9; rd += RD_STEP) LF_TABLES.push(buildLF(rd));
    }
    return LF_TABLES;
  }

  const DEFAULTS = {
    sampleRate: 48000,
    breathiness: 0.45,   // 0..1   aspiration + softer glottal pulse
    brightness: 0.5,     // 0..1   spectral tilt
    vibRate: 5.4,        // Hz
    vibDepth: 35,        // cents (peak)
    vibDelay: 0.32,      // s before vibrato blooms
    portamento: 0.06,    // s  legato glide time constant
    attack: 0.06,        // s
    release: 0.09,       // s
    formantShift: 1.06,  // >1 = smaller / lighter tract
    drift: 6,            // cents of slow pitch wander
    jitter: 0.006,       // cycle-to-cycle pitch noise
    shimmer: 0.04,       // cycle-to-cycle amplitude noise
    breaths: 0.5,        // 0..1  loudness of breath intakes between phrases
    humanize: 1,         // 0..1  micro-variation (formants, vibrato, flutter, onsets)
    detune: 0,           // cents (for doubles)
    seed: 1,
    tail: 1.0            // s of silence rendered after the last note
  };

  // ---------------------------------------------------------------- render
  function renderVoice(notes, opts) {
    const p = Object.assign({}, DEFAULTS, opts || {});
    const OS = 2;
    const SR = p.sampleRate;
    const SRo = SR * OS;
    const CR = 64;                 // control-rate block (oversampled samples)
    const fps = SRo / CR;          // control frames per second
    const T = 1 / SRo;
    const rand = rng(p.seed * 7919 + 17);

    let endT = 0.5;
    for (const n of notes) endT = Math.max(endT, n.t1);
    endT += p.tail;
    const nF = Math.ceil(endT * fps) + 2;

    // control tracks (targets)
    const tMidi = new Float32Array(nF).fill(NaN);
    const reset = new Uint8Array(nF);
    const pOff = new Float32Array(nF);
    const vibT = new Float32Array(nF);
    const ampT = new Float32Array(nF);
    const artT = new Float32Array(nF).fill(1);
    const voiT = new Float32Array(nF).fill(1);
    const aspT = new Float32Array(nF);
    const frT = new Float32Array(nF);
    const ffT = new Float32Array(nF).fill(5000);
    const fqT = new Float32Array(nF).fill(1);
    const inhT = new Float32Array(nF);   // breath intake envelope
    const fryT = new Float32Array(nF);   // creaky phrase endings
    const FT = [], BT = [];
    for (let k = 0; k < 5; k++) { FT.push(new Float32Array(nF).fill(NaN)); BT.push(new Float32Array(nF).fill(NaN)); }
    const hum = clamp(p.humanize, 0, 1);
    const breath = p.breathiness;
    // no two vowels are sung identically: small per-note formant variation
    const vary = (v) => ({
      f: v.f.map((x, k) => (k < 3 ? x * (1 + hum * (rand() - 0.5) * (k === 0 ? 0.06 : 0.04)) : x)),
      b: v.b.map((x) => x * (1 + hum * (rand() - 0.5) * 0.2)),
      g: v.g
    });

    const fr = (t) => Math.max(0, Math.min(nF - 1, Math.round(t * fps)));

    function paintSpec(spec, ta, tb, nextF, nextB) {
      const a = fr(ta), b = fr(tb);
      const F = spec.F === N || !spec.F ? nextF : spec.F;
      const B = spec.B || (spec.F === N || !spec.F ? nextB : DEFAULT_B);
      for (let i = a; i < b; i++) {
        artT[i] = spec.g === undefined ? 1 : spec.g;
        voiT[i] = spec.v === undefined ? 1 : spec.v;
        aspT[i] = spec.asp || 0;
        frT[i] = spec.fr || 0;
        if (spec.ff) { ffT[i] = spec.ff; fqT[i] = spec.fq || 1; }
        for (let k = 0; k < 5; k++) { FT[k][i] = F[k]; BT[k][i] = B[k]; }
      }
    }

    // ---- paint every note
    for (let ni = 0; ni < notes.length; ni++) {
      const n = notes[ni];
      const dur = Math.max(0.03, n.t1 - n.t0);
      const cs = clamp(dur / 0.35, 0.55, 1);
      const vel = n.vel === undefined ? 0.8 : n.vel;
      const nuc = nucleusList(n.nucleus);
      const v1 = vary(VOWELS[nuc[0]]), v2 = nuc.length > 1 ? vary(VOWELS[nuc[nuc.length - 1]]) : v1;
      const on = expandCons(n.onset, cs);
      let co = expandCons(n.coda, cs);
      const onDur = on.reduce((s, x) => s + x.d, 0);
      let coDur = co.reduce((s, x) => s + x.d, 0);
      if (coDur > dur * 0.4) {
        const k = (dur * 0.4) / coDur;
        co = co.map((x) => Object.assign({}, x, { d: x.d * k }));
        coDur = dur * 0.4;
      }
      const onStart = n.t0 - onDur * 0.65;
      const vA = onStart + onDur;
      const vB = n.t1 - coDur;

      // pitch & amplitude cover the whole syllable
      const a0 = fr(onStart), a1 = fr(n.t1 + (n.legatoNext ? 0.02 : 0));
      for (let i = a0; i < a1; i++) { tMidi[i] = n.midi; ampT[i] = vel; }
      if (!n.legatoPrev) reset[a0] = 1;

      // consonants (onset)
      let t = onStart;
      for (const s of on) { paintSpec(s, t, t + s.d, v1.f, v1.b); t += s.d; }
      // vowel nucleus (with diphthong glide in the last third)
      const vowelBase = { g: v1.g === undefined ? 1 : v1.g };
      if (nuc.length > 1 && vB - vA > 0.12) {
        const split = vA + (vB - vA) * 0.68;
        paintSpec(Object.assign({}, vowelBase, { F: v1.f, B: v1.b }), vA, split);
        paintSpec({ g: v2.g === undefined ? 1 : v2.g, F: v2.f, B: v2.b }, split, vB);
      } else {
        paintSpec(Object.assign({}, vowelBase, { F: v1.f, B: v1.b }), vA, vB);
      }
      // coda consonants
      t = vB;
      for (const s of co) { paintSpec(s, t, t + s.d, v2.f, v2.b); t += s.d; }

      // breathy onset: a little air escapes before the folds close ("h"-like)
      if (!n.legatoPrev && !on.length && rand() < (0.2 + 0.7 * breath) * hum) {
        const hd = 0.035 + 0.04 * breath;
        paintSpec({ v: 0, asp: 1.1, F: v1.f, B: v1.b }, onStart - hd, onStart);
        for (let i = fr(onStart - hd); i < a0; i++) ampT[i] = Math.max(ampT[i], vel * 0.55);
      }
      // breathy release: voicing stops a moment before the air does
      if (!n.legatoNext && !co.length && dur > 0.25 && rand() < (0.15 + 0.7 * breath) * hum) {
        const rd = 0.05 + 0.07 * breath;
        paintSpec({ v: 0.15, asp: 1.2, F: v2.f, B: v2.b }, n.t1 - 0.025, n.t1 + rd);
        for (let i = fr(n.t1); i < fr(n.t1 + rd); i++) { ampT[i] = Math.max(ampT[i], vel * 0.45); if (isNaN(tMidi[i])) tMidi[i] = n.midi; }
      }
      // breath intake before a phrase
      if (n.inhale) {
        const e = onStart - 0.05, b0 = e - n.inhale;
        for (let i = fr(b0); i < fr(e); i++) {
          const x = (i / fps - b0) / n.inhale;
          inhT[i] = Math.max(inhT[i], Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.1)), 1.3) * (n.inhaleLevel || 1));
        }
      }
      // creaky (fry) phrase ending
      if (n.fry) {
        const fd = Math.min(0.24, dur * 0.5);
        const s0 = fr(n.t1 - fd), s1 = fr(n.t1 + 0.05);
        for (let i = s0; i < s1; i++) fryT[i] = n.fry * clamp((i - s0) / Math.max(1, fr(n.t1) - s0), 0, 1);
      }

      // scoop into the note (pitch starts below and rises)
      if (n.scoop) {
        const b = fr(n.t0 + 0.3);
        for (let i = fr(onStart); i < b; i++) {
          const tt = Math.max(0, i / fps - n.t0);
          pOff[i] += -n.scoop * Math.exp(-tt / 0.055);
        }
      }
      // fall-off at the end (pitch sighs down, level fades)
      if (n.fall) {
        const fd = Math.min(0.3, dur * 0.45);
        const s0 = fr(n.t1 - fd), s1 = fr(n.t1);
        for (let i = s0; i < s1; i++) {
          const x = (i - s0) / Math.max(1, s1 - s0);
          pOff[i] += -n.fall * x * x;
          ampT[i] *= 1 - 0.75 * x;
        }
      }
      // vibrato depth envelope (blooms after the delay)
      const vs = n.vibScale === undefined ? 1 : n.vibScale;
      for (let i = a0; i < fr(n.t1); i++) {
        const tt = i / fps - n.t0 - p.vibDelay;
        vibT[i] = p.vibDepth * vs * clamp(tt / 0.4, 0, 1);
      }
    }

    // ---- hold-last fill for pitch & formants
    let firstMidi = 69;
    for (let i = 0; i < nF; i++) if (!isNaN(tMidi[i])) { firstMidi = tMidi[i]; break; }
    let lm = firstMidi;
    for (let i = 0; i < nF; i++) { if (isNaN(tMidi[i])) tMidi[i] = lm; else lm = tMidi[i]; }
    for (let k = 0; k < 5; k++) {
      let first = VOWELS.AH.f[k], firstB = VOWELS.AH.b[k];
      for (let i = 0; i < nF; i++) if (!isNaN(FT[k][i])) { first = FT[k][i]; firstB = BT[k][i]; break; }
      let lf = first, lb = firstB;
      for (let i = 0; i < nF; i++) {
        if (isNaN(FT[k][i])) { FT[k][i] = lf; BT[k][i] = lb; } else { lf = FT[k][i]; lb = BT[k][i]; }
      }
    }

    // ---- smooth control tracks -> per-frame values
    const kOf = (tau) => 1 - Math.exp(-1 / (fps * Math.max(tau, 1e-4)));
    const kAtt = kOf(p.attack), kRel = kOf(p.release);
    const kArt = kOf(0.006), kSrc = kOf(0.008), kFor = kOf(0.022), kVib = kOf(0.12), kFry = kOf(0.04);
    const kFl = kOf(0.035);
    // legato pitch moves like a damped spring: a small, natural overshoot
    const wP = 1.7 / Math.max(p.portamento, 0.012), zeta = 0.5 + 0.25 * (1 - hum), dtF = 1 / fps;

    const f0 = new Float32Array(nF + 1);
    const amp = new Float32Array(nF + 1);
    const ampF = new Float32Array(nF);
    const voi = new Float32Array(nF), asp = new Float32Array(nF), fri = new Float32Array(nF);
    const ffr = new Float32Array(nF), fqq = new Float32Array(nF);
    const rdA = new Float32Array(nF), fry = new Float32Array(nF), inh = new Float32Array(nF);
    const Fs = [], Bs = [];
    for (let k = 0; k < 5; k++) { Fs.push(new Float32Array(nF)); Bs.push(new Float32Array(nF)); }

    let sM = tMidi[0], vM = 0, sA = 0, sAF = 0, sArt = 1, sV = 1, sAs = 0, sFr = 0, sFf = 5000, sFq = 1, sVib = 0, sFry = 0;
    const sF = FT.map((a) => a[0]), sB = BT.map((a) => a[0]);
    let vph = rand() * Math.PI * 2, drift = 0, driftV = 0, flut = 0;
    const ph = [0, 0, 0, 0, 0].map(() => rand() * Math.PI * 2);
    const rdBase = 0.6 + 1.2 * breath;     // modal .. breathy
    for (let i = 0; i < nF; i++) {
      const tt = i / fps;
      if (reset[i]) { sM = tMidi[i]; vM = 0; } else {
        const acc = wP * wP * (tMidi[i] - sM) - 2 * zeta * wP * vM;
        vM += acc * dtF; sM += vM * dtF;
      }
      const at = ampT[i];
      sA += (at - sA) * (at > sA ? kAtt : kRel);
      sAF += (at - sAF) * kArt;
      sArt += (artT[i] - sArt) * kArt;
      sV += (voiT[i] - sV) * kSrc;
      sAs += (aspT[i] - sAs) * kSrc;
      sFr += (frT[i] - sFr) * kSrc;
      sFf += (ffT[i] - sFf) * kSrc;
      sFq += (fqT[i] - sFq) * kSrc;
      sVib += (vibT[i] - sVib) * kVib;
      sFry += (fryT[i] - sFry) * kFry;
      // slow drift, fast flutter, and a vibrato that is never quite regular
      driftV += (rand() - 0.5) * 0.02; driftV *= 0.995;
      drift += driftV; drift *= 0.999;
      flut += ((rand() - 0.5) * 2 - flut) * kFl;
      const rateMul = 1 + hum * 0.05 * Math.sin(2 * Math.PI * 0.43 * tt + ph[0]) + hum * 0.025 * Math.sin(2 * Math.PI * 1.1 * tt + ph[1]);
      const depthMul = 1 + hum * 0.2 * Math.sin(2 * Math.PI * 0.27 * tt + ph[2]) * Math.sin(2 * Math.PI * 0.61 * tt + ph[3]);
      vph += (2 * Math.PI * p.vibRate * rateMul) / fps;
      const vibS = Math.sin(vph) + 0.08 * Math.sin(2 * vph); // slightly asymmetric cycle
      const cents = sVib * depthMul * vibS + clamp(drift, -1, 1) * p.drift + flut * 55 * hum + p.detune;
      const midi = sM + pOff[i] + cents / 100 - sFry * 0.8;
      const hz = mtof(midi);
      f0[i] = hz;
      // the level breathes with the vibrato (formant/harmonic interaction + tremor)
      const am = 1 + hum * 0.06 * (sVib / 40) * Math.sin(vph - 0.7);
      amp[i] = sA * sArt * am;
      ampF[i] = sAF;
      voi[i] = sV; asp[i] = sAs + breath * 0.32 * sV; fri[i] = sFr;
      ffr[i] = sFf; fqq[i] = sFq;
      fry[i] = sFry; inh[i] = inhT[i];
      // voice quality: softer = breathier, higher = lighter, fry = pressed
      const loud = clamp(sA / 0.85, 0, 1.2);
      const rd = rdBase + 0.75 * (1 - loud) + 0.35 * clamp((midi - 70) / 14, 0, 1) - 0.9 * sFry
        + hum * 0.08 * Math.sin(2 * Math.PI * 0.37 * tt + ph[4]);
      rdA[i] = clamp(rd, RD_MIN, RD_MAX);
      // larynx rises with pitch: formants follow a little; slow formant wander
      const hShift = 1 + 0.035 * clamp((midi - 67) / 12, -1, 1.5);
      for (let k = 0; k < 5; k++) {
        sF[k] += (FT[k][i] - sF[k]) * kFor;
        sB[k] += (BT[k][i] - sB[k]) * kFor;
        const wander = k < 3 ? 1 + hum * 0.012 * Math.sin(2 * Math.PI * (0.19 + 0.07 * k) * tt + ph[k]) : 1;
        let F = sF[k] * p.formantShift * hShift * wander;
        const Bw = sB[k] * (1 + breath * (k < 2 ? 0.7 : 0.3)) * (1 + 0.6 * sFry * (k === 0 ? 1 : 0));
        if (k === 0) F = Math.max(F, hz * 1.08);            // F1 tracks f0 on high notes
        if (k === 1) F = Math.max(F, Fs[0][i] + 220);
        Fs[k][i] = Math.min(F, SRo * 0.45);
        Bs[k][i] = Bw;
      }
    }
    f0[nF] = f0[nF - 1]; amp[nF] = amp[nF - 1];

    // ---- sample loop (oversampled)
    const LF = lfTables();
    const nT = LF.length;
    const outLen = Math.ceil(nF * CR / OS);
    const out = new Float32Array(outLen);
    const VG = 2.9;                                  // voiced source gain
    // presence shelf after the tract (singer's brightness)
    const hs = highShelf(2400, SRo, 1 + 9 * p.brightness, 0.7);
    let hsx1 = 0, hsx2 = 0, hsy1 = 0, hsy2 = 0;

    const ry1 = new Float64Array(5), ry2 = new Float64Array(5);
    const rA = new Float64Array(5), rB = new Float64Array(5), rC = new Float64Array(5);
    let phase = 0, nPrev = 0, shim = 1, jit = 0, period = 0;
    let fx1 = 0, fx2 = 0, fy1 = 0, fy2 = 0;
    let bx1 = 0, bx2 = 0, by1 = 0, by2 = 0, airLp = 0;
    let ix1 = 0, ix2 = 0, iy1 = 0, iy2 = 0, inLp = 0;
    const airK = 0.45 * breath * breath + 0.18 * breath;
    const airLpK = 1 - Math.exp(-2 * Math.PI * 7000 / SRo);
    const inLpK = 1 - Math.exp(-2 * Math.PI * 5000 / SRo);
    const bp = (fc, Q) => {
      const w = 2 * Math.PI * fc / SRo, al = Math.sin(w) / (2 * Q), a0 = 1 + al;
      return [al / a0, -al / a0, (-2 * Math.cos(w)) / a0, (1 - al) / a0];
    };
    const [ab0, ab2, aa1, aa2] = bp(3800, 0.7);
    const [ib0, ib2, ia1, ia2] = bp(1500, 0.7);    // inhale: open-throat noise
    const inhK = 0.36 * p.breaths;
    // decimation filter (4th-order Butterworth @ 0.21*SRo) + DC blocker
    const lp = [biquadLP(0.21 * SRo, SRo, 0.5412), biquadLP(0.21 * SRo, SRo, 1.3066)];
    const lps = [[0, 0, 0, 0], [0, 0, 0, 0]];
    let dcx = 0, dcy = 0;
    let o = 0;

    let comp = 1;
    for (let i = 0; i < nF; i++) {
      for (let k = 0; k < 5; k++) {
        const F = Fs[k][i], Bw = Bs[k][i];
        const C = -Math.exp(-2 * Math.PI * Bw * T);
        const Bc = 2 * Math.exp(-Math.PI * Bw * T) * Math.cos(2 * Math.PI * F * T);
        rA[k] = 1 - Bc - C; rB[k] = Bc; rC[k] = C;
      }
      // glottal tables for this frame's voice quality
      const rf = (rdA[i] - RD_MIN) / RD_STEP;
      const ti = Math.min(nT - 2, Math.max(0, Math.floor(rf)));
      const tf = clamp(rf - ti, 0, 1);
      const TA = LF[ti], TB = LF[ti + 1];
      // Loudness compensation: estimate the tract's gain over the voice's
      // harmonics so that vowels and registers come out at similar levels.
      if ((i & 3) === 0) {
        const hz = f0[i];
        let pw = 0;
        for (let h = 1; h * hz < 5500 && h <= 40; h++) {
          const w = 2 * Math.PI * h * hz * T;
          const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
          let mag2 = 1;
          for (let k = 0; k < 5; k++) {
            const re = 1 - rB[k] * c1 - rC[k] * c2, im = rB[k] * s1 + rC[k] * s2;
            mag2 *= (rA[k] * rA[k]) / (re * re + im * im);
          }
          pw += mag2 * (TA.harm[h] + (TB.harm[h] - TA.harm[h]) * tf);
        }
        const target = 1 / Math.pow(Math.max(pw * 400, 1e-9), 0.5 * 0.85);
        comp = comp === 1 && i === 0 ? target : comp + (target - comp) * 0.25;
      }
      // frication band-pass (RBJ, 0 dB peak)
      const w0 = 2 * Math.PI * Math.min(ffr[i], SRo * 0.45) / SRo;
      const alpha = Math.sin(w0) / (2 * fqq[i]);
      const a0 = 1 + alpha;
      const fb0 = alpha / a0, fb2 = -alpha / a0, fa1 = (-2 * Math.cos(w0)) / a0, fa2 = (1 - alpha) / a0;

      const f0a = f0[i], f0b = f0[i + 1], ampA = amp[i], ampB = amp[i + 1];
      const vv = voi[i], aa = asp[i], ff = fri[i] * ampF[i], fy = fry[i], ih = inh[i] * inhK;
      const jitAmt = p.jitter * (0.5 + 0.5 * hum) + 0.06 * fy, shimAmt = p.shimmer * (0.5 + 0.5 * hum) + 0.35 * fy;
      for (let j = 0; j < CR; j++) {
        const x = j / CR;
        const hz = f0a + (f0b - f0a) * x;
        const g = ampA + (ampB - ampA) * x;
        const inc = (hz * (1 + jit)) * T;
        phase += inc;
        if (phase >= 1) {
          phase -= 1;
          period++;
          // correlated jitter, shimmer; fry alternates strong/weak pulses
          jit = 0.55 * jit + 0.45 * jitAmt * (rand() - 0.5) * 2;
          shim = 1 + shimAmt * (rand() - 0.5) * 2;
          if (fy > 0.05 && (period & 1)) shim *= 1 - 0.55 * fy;
        }
        // LF glottal flow derivative (wavetable, interpolated in time and Rd)
        const px = phase * LF_N, pi = px | 0, pf = px - pi;
        const dA = TA.d[pi] + (TA.d[pi + 1] - TA.d[pi]) * pf;
        const dB = TB.d[pi] + (TB.d[pi + 1] - TB.d[pi]) * pf;
        const flow = TA.flow[pi] + (TB.flow[pi] - TA.flow[pi]) * tf;
        const voiced = (dA + (dB - dA) * tf) * VG * vv * shim;
        // aspiration: high-passed noise, pulsed by the glottis
        const nz = rand() * 2 - 1;
        const hpn = nz - nPrev; nPrev = nz;
        const aspN = hpn * 0.35 * aa * (0.3 + 0.7 * flow);
        let s = (voiced + aspN) * g * comp;
        // vocal tract: 5 cascaded resonators
        for (let k = 0; k < 5; k++) {
          const y = rA[k] * s + rB[k] * ry1[k] + rC[k] * ry2[k];
          ry2[k] = ry1[k]; ry1[k] = y; s = y;
        }
        // presence shelf
        const pe = hs[0] * s + hs[1] * hsx1 + hs[2] * hsx2 - hs[3] * hsy1 - hs[4] * hsy2;
        hsx2 = hsx1; hsx1 = s; hsy2 = hsy1; hsy1 = pe; s = pe;
        // frication (parallel path)
        const fn = rand() * 2 - 1;
        const fyy = fb0 * fn + fb2 * fx2 - fa1 * fy1 - fa2 * fy2;
        fx2 = fx1; fx1 = fn; fy2 = fy1; fy1 = fyy;
        s += fyy * ff * 0.85;
        // breath ("air") layer: band-limited noise riding the glottal cycle
        const bn = rand() * 2 - 1;
        const by = ab0 * bn + ab2 * bx2 - aa1 * by1 - aa2 * by2;
        bx2 = bx1; bx1 = bn; by2 = by1; by1 = by;
        airLp += (by - airLp) * airLpK;
        s += airLp * airK * vv * g * (0.35 + 0.65 * flow);
        // breath intake between phrases
        if (ih > 1e-5) {
          const inn = rand() * 2 - 1;
          const iy = ib0 * inn + ib2 * ix2 - ia1 * iy1 - ia2 * iy2;
          ix2 = ix1; ix1 = inn; iy2 = iy1; iy1 = iy;
          inLp += (iy + 0.35 * inn - inLp) * inLpK;
          s += inLp * ih;
        }

        // decimation low-pass
        let z = s;
        for (let q = 0; q < 2; q++) {
          const c = lp[q], st = lps[q];
          const y = c[0] * z + c[1] * st[0] + c[2] * st[1] - c[3] * st[2] - c[4] * st[3];
          st[1] = st[0]; st[0] = z; st[3] = st[2]; st[2] = y; z = y;
        }
        if ((j & 1) === 1 && o < outLen) {
          const y = z - dcx + 0.996 * dcy; dcx = z; dcy = y;
          out[o++] = y;
        }
      }
    }
    return out;
  }

  function biquadLP(fc, sr, Q) {
    const w0 = 2 * Math.PI * fc / sr, c = Math.cos(w0), al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
    return [((1 - c) / 2) / a0, (1 - c) / a0, ((1 - c) / 2) / a0, (-2 * c) / a0, (1 - al) / a0];
  }

  function highShelf(fc, sr, dB, S) {
    const A = Math.pow(10, dB / 40), w0 = 2 * Math.PI * fc / sr, c = Math.cos(w0), sn = Math.sin(w0);
    const al = sn / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2), sa = 2 * Math.sqrt(A) * al;
    const a0 = (A + 1) - (A - 1) * c + sa;
    return [
      A * ((A + 1) + (A - 1) * c + sa) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - sa) / a0,
      2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - sa) / a0
    ];
  }

  function normalize(buf, peak) {
    let m = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
    if (m > 0) { const k = peak / m; for (let i = 0; i < buf.length; i++) buf[i] *= k; }
    return m;
  }

  const api = { renderVoice, normalize, VOWELS, CONS, DIPHTHONGS, DEFAULTS, rng, mtof };
  root.Lumen = root.Lumen || {};
  root.Lumen.engine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
