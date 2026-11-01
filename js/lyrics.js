/*
 * Lumen lyrics -> phones
 * ----------------------
 * Turns one sung syllable ("hold", "drift-", "ooh", "[M AA]") into
 *   { onset: [consonants], nucleus: [vowel(s)], coda: [consonants] }
 * using ARPAbet-style symbols understood by engine.js.
 *
 * It is a heuristic English letter-to-sound converter tuned for sung
 * lyrics. A trailing "-" means the word continues on the next note,
 * which makes open syllables long ("ba-" + "by" = "bay-bee").
 * Square brackets bypass the rules: "[HH AY]".
 */
(function (root) {
  'use strict';

  const VOWEL_SET = new Set(['AA', 'AE', 'EH', 'IY', 'IH', 'OH', 'AO', 'UW', 'UH', 'AH', 'AX', 'ER', 'MM', 'NN', 'EY', 'AY', 'OW', 'AW', 'OY']);

  // whole-syllable exceptions (pronunciations as ARPAbet strings)
  const DICT = {
    i: 'AY', "i'm": 'AY M', "i'll": 'AY L', "i've": 'AY V', "i'd": 'AY D', my: 'M AY', me: 'M IY',
    you: 'Y UW', your: 'Y AO R', "you're": 'Y AO R', yours: 'Y AO R Z', "you'll": 'Y UW L',
    the: 'DH AX', a: 'AX', an: 'AE N', to: 'T UW', too: 'T UW', two: 'T UW', do: 'D UW', who: 'HH UW',
    oh: 'OW', ooh: 'UW', oo: 'UW', ou: 'UW', uh: 'AH', ah: 'AA', aah: 'AA', aa: 'AA', ha: 'HH AA',
    mm: 'MM', mmm: 'MM', hmm: 'HH MM', m: 'MM', n: 'NN', nn: 'NN', hm: 'HH MM',
    yeah: 'Y EH', ya: 'Y AA', yah: 'Y AA', eh: 'EH', ay: 'AY', ee: 'IY', woah: 'W OW', whoa: 'W OW', wo: 'W OW',
    la: 'L AA', da: 'D AA', na: 'N AA', ba: 'B AA', doo: 'D UW', dee: 'D IY', di: 'D IY', du: 'D UW',
    love: 'L AH V', of: 'AH V', come: 'K AH M', some: 'S AH M', one: 'W AH N', done: 'D AH N', none: 'N AH N',
    from: 'F R AH M', what: 'W AH T', was: 'W AH Z', does: 'D AH Z', are: 'AA R', were: 'W ER', where: 'W EH R',
    there: 'DH EH R', their: 'DH EH R', here: 'HH IY R', heart: 'HH AA R T', said: 'S EH D', says: 'S EH Z',
    eye: 'AY', eyes: 'AY Z', soul: 'S OW L', though: 'DH OW', through: 'TH R UW', thru: 'TH R UW',
    could: 'K UH D', would: 'W UH D', should: 'SH UH D', touch: 'T AH CH', young: 'Y AH NG',
    good: 'G UH D', food: 'F UW D', mood: 'M UW D', blood: 'B L AH D', flood: 'F L AH D',
    give: 'G IH V', live: 'L IH V', have: 'HH AE V', been: 'B IH N', any: 'EH N IY', many: 'M EH N IY',
    know: 'N OW', now: 'N AW', how: 'HH AW', down: 'D AW N', town: 'T AW N', own: 'OW N',
    blue: 'B L UW', true: 'T R UW', night: 'N AY T', light: 'L AY T', right: 'R AY T', tonight: 'T AX N AY T',
    sky: 'S K AY', fly: 'F L AY', why: 'W AY', by: 'B AY', cry: 'K R AY', try: 'T R AY', high: 'HH AY', die: 'D AY', lie: 'L AY',
    world: 'W ER L D', word: 'W ER D', work: 'W ER K', water: 'W AO T ER', want: 'W AA N T',
    baby: 'B EY B IY', body: 'B AA D IY', only: 'OW N L IY', every: 'EH V R IY', ever: 'EH V ER', never: 'N EH V ER',
    again: 'AX G EH N', away: 'AX W EY', alone: 'AX L OW N', above: 'AX B AH V', inside: 'IH N S AY D'
  };
  const DH_WORDS = new Set(['the', 'this', 'that', 'they', 'them', 'there', 'then', 'though', 'those', 'these', 'than', 'thy', 'thee', 'their', 'with', 'smooth', 'breathe']);

  // ---- consonant letters -> phones
  function consPhones(str, position, word) {
    const out = [];
    let i = 0;
    const s = str;
    while (i < s.length) {
      const two = s.substr(i, 2), three = s.substr(i, 3), c = s[i], nx = s[i + 1] || '';
      if (three === 'tch') { out.push('CH'); i += 3; continue; }
      if (two === 'sh') { out.push('SH'); i += 2; continue; }
      if (two === 'ch') { out.push('CH'); i += 2; continue; }
      if (two === 'th') { out.push(DH_WORDS.has(word) ? 'DH' : 'TH'); i += 2; continue; }
      if (two === 'ph') { out.push('F'); i += 2; continue; }
      if (two === 'wh') { out.push('W'); i += 2; continue; }
      if (two === 'ng') { out.push('NG'); i += 2; continue; }
      if (two === 'nk') { out.push('NG', 'K'); i += 2; continue; }
      if (two === 'ck') { out.push('K'); i += 2; continue; }
      if (two === 'gh') { if (position === 'onset') out.push('G'); i += 2; continue; }
      if (two === 'qu') { out.push('K', 'W'); i += 2; continue; }
      if (two === 'kn' && position === 'onset' && i === 0) { out.push('N'); i += 2; continue; }
      if (two === 'wr' && position === 'onset' && i === 0) { out.push('R'); i += 2; continue; }
      if (c === nx && c !== undefined) { i += 1; continue; } // double letters
      switch (c) {
        case 'b': out.push('B'); break;
        case 'c': out.push(position === 'onset-soft' ? 'S' : 'K'); break;
        case 'd': out.push('D'); break;
        case 'f': out.push('F'); break;
        case 'g': out.push('G'); break;
        case 'h': if (position !== 'coda') out.push('HH'); break;
        case 'j': out.push('JH'); break;
        case 'k': out.push('K'); break;
        case 'l': out.push('L'); break;
        case 'm': out.push('M'); break;
        case 'n': out.push('N'); break;
        case 'p': out.push('P'); break;
        case 'q': out.push('K'); break;
        case 'r': out.push('R'); break;
        case 's': out.push('S'); break;
        case 't': out.push('T'); break;
        case 'v': out.push('V'); break;
        case 'w': if (position !== 'coda') out.push('W'); break;
        case 'x': if (position === 'coda') out.push('K', 'S'); else out.push('Z'); break;
        case 'y': out.push('Y'); break;
        case 'z': out.push('Z'); break;
        default: break;
      }
      i += 1;
    }
    return out;
  }

  // ---- vowel group -> nucleus
  function vowelOf(group, ctx) {
    const { long, onset, rest, word } = ctx;
    switch (group) {
      case 'a':
        if (/^(ll|lk|lt|lm)/.test(rest)) return 'AO';
        if (rest[0] === 'r') return long ? 'EH' : 'AA';
        if (!long && /w$/.test(onset)) return 'AA';
        return long ? 'EY' : 'AE';
      case 'e': return long ? 'IY' : (rest[0] === 'r' ? 'ER' : 'EH');
      case 'i':
        if (/^(nd|ld)/.test(rest)) return 'AY';
        return long ? 'AY' : (rest[0] === 'r' ? 'ER' : 'IH');
      case 'o':
        if (/^(ld|st|ll)/.test(rest) && rest !== 'st') return 'OW';
        if (rest[0] === 'r') return /w$/.test(onset) ? 'ER' : 'AO';
        return long ? 'OW' : 'AA';
      case 'u':
        if (rest[0] === 'r') return 'ER';
        if (/^(ll|sh|t)$/.test(rest) && /^(p|b|f)$/.test(onset)) return 'UH';
        return long ? 'UW' : 'AH';
      case 'y': return ctx.alone ? 'AY' : 'IY';
      case 'ee': case 'ea': case 'ey': return group === 'ey' && rest === '' && onset ? 'EY' : (group === 'ea' && /^r[^aeiou]/.test(rest) ? 'ER' : 'IY');
      case 'ie': return rest === '' ? 'AY' : 'IY';
      case 'ei': return 'EY';
      case 'ai': case 'ay': return 'EY';
      case 'oo': return /^k/.test(rest) ? 'UH' : 'UW';
      case 'ou': return 'AW';
      case 'ow': {
        if (rest === '' && /(kn|sh|sl|gr|fl|thr|bl|gl|sn|l|r|gr|cr|tr|st)$/.test(onset)) return 'OW';
        if (rest === 'n' && /(gr|sh|bl|fl|kn|thr|sh)$/.test(onset)) return 'OW';
        return 'AW';
      }
      case 'oa': case 'oe': return 'OW';
      case 'oi': case 'oy': return 'OY';
      case 'au': case 'aw': return 'AO';
      case 'ue': case 'ew': case 'ui': return 'UW';
      case 'eau': return 'OW';
      case 'you': return 'UW';
      default: {
        // unknown cluster: use the first vowel letter
        return vowelOf(group[0], ctx);
      }
    }
  }

  function parseArpa(str) {
    const tokens = str.trim().toUpperCase().split(/\s+/).filter(Boolean);
    const onset = [], nucleus = [], coda = [];
    let seen = false;
    for (const t of tokens) {
      if (VOWEL_SET.has(t)) { nucleus.push(t); seen = true; } else if (!seen) onset.push(t); else coda.push(t);
    }
    if (!nucleus.length) nucleus.push('MM');
    return { onset, nucleus, coda };
  }


  function g2p(raw) {
    if (raw == null) return null;
    let w = String(raw).trim();
    if (!w) return null;
    const bracket = w.match(/^\[(.*)\]-?$/);
    if (bracket) return parseArpa(bracket[1]);
    const cont = /-$/.test(w);
    w = w.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z']/g, '');
    if (!w) return null;
    if (DICT[w] && !(cont && w.length <= 2)) return dictPhones(DICT[w]);
    const bare = w.replace(/'/g, '');

    // split: onset consonants | vowel group | rest
    let m = bare.match(/^([^aeiouy]*)(y?)(.*)$/);
    let onset = m[1] + m[2];
    let restAll = m[3];
    if (!restAll) { // no vowel letters at all, e.g. "hm", "mm", "sh"
      if (/^m+$/.test(bare) || /^h?m+$/.test(bare)) return parseArpa(bare[0] === 'h' ? 'HH MM' : 'MM');
      if (/^n+$/.test(bare)) return parseArpa('NN');
      // initial y was consumed: "y" -> "why"-ish
      if (onset.endsWith('y')) { onset = onset.slice(0, -1); restAll = 'y'; } else return { onset: consPhones(bare, 'onset', bare), nucleus: ['AX'], coda: [] };
    }
    if (/qu$/.test(onset + restAll[0]) && restAll[0] === 'u') { onset += 'u'; restAll = restAll.slice(1); }
    if (onset === 'q') { onset = 'qu'; restAll = restAll.replace(/^u/, ''); }

    let vm = restAll.match(/^([aeiouy]+)(.*)$/);
    if (!vm) return { onset: consPhones(onset, 'onset', bare), nucleus: ['AX'], coda: [] };
    let group = vm[1];
    let rest = vm[2];
    if (rest[0] === 'w' && /^(o|a|e)$/.test(group)) { group += 'w'; rest = rest.slice(1); }
    // "you" style groups and long clusters: keep at most 2 letters (except known 3s)
    if (group.length > 2 && group !== 'eau' && group !== 'you') {
      rest = group.slice(2) + rest; group = group.slice(0, 2);
    }
    // 'y' following a vowel acts as a vowel modifier (ay, ey, oy) – already in group
    // 'igh' -> long i
    let long = false;
    if (group === 'i' && /^gh/.test(rest)) { long = true; rest = rest.slice(2); }
    // magic e:  consonant(s) + e at end
    const magic = rest.match(/^([^aeiouy]{1,2})e(s|d)?$/);
    if (magic && group.length === 1 && !/^(le)$/.test(rest)) {
      long = true;
      rest = magic[1] + (magic[2] || '');
    }
    // open syllable: no coda
    const open = rest === '';
    if (open && group.length === 1) {
      if (cont) long = true;
      else if (group === 'a') long = false;
      else long = true;
    }
    // discard further vowels (extra syllables on a single note) but keep consonants
    rest = rest.replace(/[aeiouy]+/g, '');
    // r after vowel handled in vowelOf
    const ctx = { long, onset, rest, word: bare, alone: onset.length >= 0 && group === 'y' };
    let nuc = vowelOf(group, ctx);
    let codaStr = rest;
    if ((nuc === 'ER') && codaStr[0] === 'r') codaStr = codaStr.slice(1);
    // soft c in onset (cent, city)
    let onsetPh;
    if (/c$/.test(onset) && /^[eiy]/.test(group)) onsetPh = consPhones(onset.slice(0, -1), 'onset', bare).concat(['S']);
    else onsetPh = consPhones(onset, 'onset', bare);
    let codaPh = consPhones(codaStr, 'coda', bare);
    // "-ng" endings after i sound like IH NG; "s" after voiced coda -> Z
    if (codaPh.length >= 2 && codaPh[codaPh.length - 1] === 'S' && /[BDGVMNLR]|NG/.test(codaPh[codaPh.length - 2])) codaPh[codaPh.length - 1] = 'Z';
    if (magic && magic[1] === 's') codaPh = codaPh.map((c) => (c === 'S' ? 'Z' : c));
    return { onset: onsetPh, nucleus: [nuc], coda: codaPh };
  }

  // A dictionary entry may hold two syllables ("baby"). On one note we
  // sing the first vowel and glide to the last one; consonants between
  // the vowels are dropped.
  function dictPhones(str) {
    const tokens = str.trim().split(/\s+/);
    const vi = tokens.map((t, i) => (VOWEL_SET.has(t) ? i : -1)).filter((i) => i >= 0);
    if (!vi.length) return parseArpa(str);
    const first = vi[0], last = vi[vi.length - 1];
    const nucleus = first === last ? [tokens[first]] : [tokens[first], tokens[last]];
    return { onset: tokens.slice(0, first), nucleus, coda: tokens.slice(last + 1) };
  }

  // Split a lyric line into singable syllables, marking word continuations
  // with a trailing "-".  "baby I love you" -> ["ba-", "by", "I", "love", "you"]
  function syllabify(text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (const word of words) {
      if (word === '_' || word === '+') { out.push('_'); continue; }
      if (word.includes('-')) {
        const parts = word.split('-').filter(Boolean);
        parts.forEach((pt, i) => out.push(i < parts.length - 1 ? pt + '-' : pt));
        continue;
      }
      const parts = autoSplit(word);
      parts.forEach((pt, i) => out.push(i < parts.length - 1 ? pt + '-' : pt));
    }
    return out;
  }

  function autoSplit(word) {
    const w = word.toLowerCase();
    if (DICT[w.replace(/[^a-z']/g, '')] || w.length <= 3) return [word];
    // vowel groups (treat final silent e as not a group)
    const re = /[aeiouy]+/g;
    const groups = [];
    let mm;
    while ((mm = re.exec(w))) groups.push([mm.index, mm.index + mm[0].length]);
    if (groups.length && w.endsWith('e') && groups[groups.length - 1][0] === w.length - 1 && !/le$/.test(w)) groups.pop();
    if (groups.length && /es$|ed$/.test(w) && groups.length > 1 && !/(t|d)ed$|[sxz]es$|(ch|sh)es$/.test(w)) {
      const last = groups[groups.length - 1];
      if (last[0] === w.length - 2) groups.pop();
    }
    if (groups[0] && groups[0][0] === 0 && w[0] === 'y' && groups[0][1] - groups[0][0] > 1) groups[0][0] = 1;
    if (groups.length <= 1) return [word];
    const cuts = [];
    for (let g = 0; g < groups.length - 1; g++) {
      const a = groups[g][1], b = groups[g + 1][0];
      const cons = w.slice(a, b);
      let cut;
      if (cons.length <= 1) cut = a;                       // ba|by
      else if (/^(ch|sh|th|ph|wh|ck|ng)$/.test(cons)) cut = cons === 'ng' || cons === 'ck' ? b : a;
      else cut = a + 1;                                     // drif|ting
      if (/^le$/.test(w.slice(b - 1)) && cons.length >= 1) cut = b - 1; // gen|tle
      cuts.push(cut);
    }
    const parts = [];
    let s = 0;
    for (const c of cuts) { if (c > s) { parts.push(word.slice(s, c)); s = c; } }
    parts.push(word.slice(s));
    return parts.filter(Boolean);
  }

  const api = { g2p, syllabify, parseArpa, DICT };
  root.Lumen = root.Lumen || {};
  root.Lumen.lyrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
