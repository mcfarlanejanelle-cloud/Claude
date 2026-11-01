// Sings a melody with the engine, then runs the hum-to-melody tracker on the
// result and checks the recovered pitches. usage: node test/roundtrip.js
const path = require('path');
for (const f of ['engine', 'lyrics', 'score', 'arrange', 'input']) require(path.join(__dirname, '../js', f + '.js'));
const { engine, score, arrange, input } = globalThis.Lumen;
const text = 'C4:1/doo E4:1/doo G4:1/doo C5:2/doo R:1 A4:1/doo F4:1/doo D4:2/doo';
const notes = score.parseNotation(text).notes;
const style = Object.assign(arrange.styleFromMacros(0.3, 0, 0.5), { agility: 0, scoop: 0, fall: 0, layback: 0 });
const arr = arrange.arrange({ bpm: 90, notes }, style, { doubles: 0 });
const buf = engine.renderVoice(arr.jobs[0].notes, Object.assign({ sampleRate: 44100 }, arr.jobs[0].opts));
const frames = input.trackPitch(buf, 44100);
const segs = input.segmentNotes(frames);
const got = input.notesToScore(segs, { bpm: 90, grid: 0.25, alignStart: true });
const want = notes.map((n) => n.midi), have = got.map((n) => n.midi);
console.log('want', want.map(score.noteName).join(' '));
console.log('have', have.map(score.noteName).join(' '));
if (JSON.stringify(want) !== JSON.stringify(have)) { console.error('MISMATCH'); process.exit(1); }
console.log('roundtrip ok');
