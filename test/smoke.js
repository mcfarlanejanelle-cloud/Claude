// Renders an example phrase in Node and writes test/out.wav
// usage: node test/smoke.js
const fs = require('fs');
const path = require('path');
for (const f of ['engine', 'lyrics', 'score', 'arrange']) require(path.join(__dirname, '../js', f + '.js'));
const { engine, score, arrange } = globalThis.Lumen;

const text = 'R:.5 Eb4:.5/hold G4:1/me Bb4:.5/in C5:.5/the Bb4:1.5/blue G4:.5/_ F4:2/light R:1 Eb4:.5/I\'ve G4:.5/been Bb4:.75/drift- C5:.75/ing Eb5:1/so Bb4:3/slow';
const parsed = score.parseNotation(text);
if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
const style = arrange.styleFromMacros(0.6, 0.6, 0.6);
const t0 = Date.now();
const arr = arrange.arrange({ bpm: 80, notes: parsed.notes }, style, { harmony: 'thirds' });
const SR = 48000;
let len = 0;
const bufs = arr.jobs.map((j) => {
  const b = engine.renderVoice(j.notes, Object.assign({ sampleRate: SR }, j.opts));
  const peak = engine.normalize(b, 0.7);
  if (!isFinite(peak) || peak === 0) throw new Error('bad render for ' + j.name + ' peak=' + peak);
  len = Math.max(len, b.length);
  return b;
});
console.log('key', score.keyName(arr.key), 'voices', arr.jobs.length, 'notes(lead)', arr.jobs[0].notes.length, 'render ms', Date.now() - t0);
const L = new Float32Array(len), R = new Float32Array(len);
arr.jobs.forEach((j, i) => {
  const g = j.gain, pl = Math.cos((j.pan + 1) * Math.PI / 4), pr = Math.sin((j.pan + 1) * Math.PI / 4);
  for (let k = 0; k < bufs[i].length; k++) { L[k] += bufs[i][k] * g * pl; R[k] += bufs[i][k] * g * pr; }
});
let m = 0; for (let k = 0; k < len; k++) m = Math.max(m, Math.abs(L[k]), Math.abs(R[k]));
const wav = Buffer.alloc(44 + len * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + len * 4, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(len * 4, 40);
for (let k = 0; k < len; k++) {
  wav.writeInt16LE(Math.round(L[k] / m * 0.9 * 32767), 44 + k * 4);
  wav.writeInt16LE(Math.round(R[k] / m * 0.9 * 32767), 46 + k * 4);
}
fs.writeFileSync(path.join(__dirname, 'out.wav'), wav);
// sanity: RMS per 100ms window of the lead
const lead = bufs[0];
const win = SR / 10, rms = [];
for (let k = 0; k + win < lead.length; k += win) { let s = 0; for (let q = 0; q < win; q++) s += lead[k + q] ** 2; rms.push(Math.sqrt(s / win).toFixed(2)); }
console.log('lead rms/100ms:', rms.join(' '));
console.log(arr.jobs[0].notes.map(n => score.noteName(n.midi) + (n.ornament ? '*' : '') + '[' + n.onset.join('') + '.' + n.nucleus.join('') + '.' + n.coda.join('') + ']').join(' '));
console.log('ok, wrote test/out.wav');
