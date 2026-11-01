# Lumen Vocal Studio

Lumen is an original female singing voice that runs entirely in the browser.
You give her a melody and lyrics, and she sings them back with phrasing from
alt-R&B and neo-soul: airy, breath-forward tone, stacked doubles and
harmonies, jazz-inflected runs, scoops into notes, sighing fall-offs and
timing that sits a little behind the beat.

The voice is synthesized from scratch. It is not trained on, sampled from or
modelled on any real singer's recordings. "Character" sliders shape the style.
They do not copy anyone's identity.

## Run it

No build step and no dependencies.

```sh
python3 -m http.server 8000     # or: npm start
# open http://localhost:8000
```

Opening `index.html` straight from disk also works, but the microphone needs
`localhost` or `https`.

## Ways to give her a melody

| Input | How |
| --- | --- |
| **Piano roll** | Click to add a note, drag to move, drag the right edge to resize, right-click to delete, double-click to type the lyric. `Enter`/`Tab` in the lyric box jumps to the next note. |
| **Text notation** | `NOTE:BEATS/lyric` tokens, e.g. `Eb4:.5/hold G4:1/me R:1 C5:2/ooh Bb4:1/_`. `R` is a rest, `_` holds the previous syllable over another note (melisma), `\|` bar lines are ignored, and `[HH AY]` spells sounds directly in ARPAbet. |
| **Lyrics box** | Type a line and press *Fit lyrics to notes*. Words are split into syllables (`drifting` → `drif-` `ting`), or you can split them yourself with hyphens. |
| **Play it** | Computer keys `A W S E D F T G Y H U J K` (Z/X change octave) or a Web MIDI keyboard. You hear her voice as you play. *Record* gives a 1-bar count-in and quantizes to the grid. |
| **Hum it** | Hum or sing on "doo" into the mic, or upload a voice memo. Pitch is tracked with YIN, split into notes, snapped to the key and moved into her range. |
| **Import MIDI** | Takes the top line of the busiest (or vocal-named) track, plus tempo and lyric events. |

## Shaping the voice

- **Airy**: breathiness, soft attacks, lighter vocal tract, left/right doubles, reverb and echo.
- **Agile**: how often she adds runs (pentatonic passing tones between notes, turns, flips, run-down endings), scoop depth and vibrato energy.
- **Cool**: restraint. Straighter tone, later vibrato, a darker colour, laid-back timing and sighing falls at phrase ends.
- **Layers**: diatonic harmonies (third above, triad stack, sixth below, both, octave below) in the detected or chosen key. Runs are harmonized too.
- **Fine tuning**: every underlying parameter (breath, brightness, voice size, vibrato, glide, run speed, scoop, fall, timing, mix levels, effects).

*Sing it* renders all voices. *Export WAV* saves the full mix with effects.
Green marks on the roll show the runs and grace notes she will add.

## How it works

```
lyrics ─▶ lyrics.js  letter-to-sound rules + dictionary ─▶ onset / vowel(s) / coda phones
melody ─▶ score.js   notation, key detection, scales
        ─▶ arrange.js timing, legato, melisma, runs, scoops, falls, layback, doubles, harmonies
        ─▶ engine.js  per voice, 2× oversampled:
                      Rosenberg glottal pulse + aspiration + "air" noise
                      → 5 cascaded formant resonators (vowel targets, F1 tracks f0 on high notes)
                      → presence shelf, + parallel frication noise for consonants
                      vibrato with delayed onset, drift, jitter/shimmer, loudness compensation
        ─▶ audio.js   Web Audio mix: EQ, warmth, compression, reverb, ping-pong delay, limiter, WAV export
```

`input.js` contains the MIDI file reader and the hum-to-melody pitch tracker.
`pianoroll.js` is the canvas editor, and `app.js` connects the UI.

## Tests

```sh
npm test
```

- `test/roundtrip.js`: Lumen sings a melody, the hum tracker transcribes it, and the notes must match.
- `test/midi.js`: builds a MIDI file with tempo, lyrics and a chord, then checks the import.
- `test/smoke.js`: renders the first example with harmony to `test/out.wav` and prints levels and the arranged runs.

## Single-file build

`npm run build:artifact` inlines everything into `dist/lumen-studio.html`,
the hosted version published as a claude.ai Artifact.

## Limits

This is a formant synthesizer, so she sounds like a stylized synthetic singer,
not a recording of a person. Consonants are simplified, and the English
spelling rules guess wrong on some words. Use `[ARPAbet]` or phonetic spelling
(`bay-bee`) to fix them. Realism would need a neural singing model (for
example DiffSinger-style acoustic models with a vocoder) trained on a
consenting singer's licensed data. The score and phrasing layer here is built
so it could drive such a backend later.
