// Builds a small type-1 MIDI file (tempo, lyrics, a chord) and imports it.
// usage: node test/midi.js
const path = require('path');
for (const f of ['score', 'input']) require(path.join(__dirname, '../js', f + '.js'));
const { input, score } = globalThis.Lumen;
const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const trk = (ev) => { const d = ev.flat(); return [0x4d, 0x54, 0x72, 0x6b, (d.length >>> 24) & 255, (d.length >>> 16) & 255, (d.length >>> 8) & 255, d.length & 255, ...d]; };
const text = (s) => [...Buffer.from(s)];
const t0 = trk([[0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20], [0, 0xff, 0x2f, 0]]); // 120 bpm
const t1 = trk([
  [0, 0xff, 0x03, 4, ...text('Lead')],
  [0, 0xff, 0x05, 3, ...text('hey')], [0, 0x90, 64, 100], [0, 0x90, 60, 80], [...vlq(480), 0x80, 64, 0], [0, 0x80, 60, 0],
  [0, 0xff, 0x05, 3, ...text('you')], [0, 0x90, 67, 100], [...vlq(960), 0x90, 67, 0],
  [...vlq(240), 0x90, 72, 90], [...vlq(240), 0x80, 72, 0], [0, 0xff, 0x2f, 0]
]);
const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 0x01, 0xe0];
const bytes = Uint8Array.from([...hdr, ...t0, ...t1]);
const res = input.parseMidiFile(bytes.buffer);
const got = res.notes.map((n) => `${score.noteName(n.midi)}@${n.start}+${n.len}/${n.lyric}`).join(' ');
console.log('bpm', res.bpm, 'track', res.trackName, got);
const want = 'E4@0+1/hey G4@1+2/you C5@3.5+0.5/';
if (res.bpm !== 120 || got !== want) { console.error('MISMATCH, want', want); process.exit(1); }
console.log('midi ok');
