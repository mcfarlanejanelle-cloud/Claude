# Building a better voice model for Lumen

Research notes, November 2026. The goal is a voice that sounds like a real
singer while keeping Lumen's inputs (piano roll, notation, keyboard, humming,
MIDI) and its style controls (Airy / Agile / Cool).

## 1. Where Lumen is today, and its ceiling

Lumen is a rule-based **source–filter synthesizer**. It has an LF glottal
source, five formant resonators, noise for breath and consonants, and a
phrasing layer that adds runs, scoops, falls, breaths and fry. There is still
room to improve inside that design:

- **Nasal antiresonances** (zeros) for m/n/ng and nasalized vowels. Today
  nasals are only low formants.
- **Parallel-formant branch** for consonants, so each fricative and burst
  gets its own spectral shape (as in the Klatt synthesizer).
- **Measured targets.** Fit formants and glottal Rd from a real singer's
  sustained vowels (LPC / inverse filtering) instead of textbook tables.
- **Coarticulation rules.** Today vowel and consonant targets are simply
  smoothed.

These would help, but rule-based synthesis tops out at "a good synthetic
singer". Commercial-quality realism comes from **models trained on
recordings of a real singer**. The rest of this document is about that path.

## 2. The neural singing-voice stack

Modern singing voice synthesis (SVS) splits the job in three:

| Stage | What it predicts | Open examples |
| --- | --- | --- |
| **Variance / expression model** | Phoneme durations, pitch curve (vibrato, scoops, runs), energy, breathiness from the score | DiffSinger variance models |
| **Acoustic model** | Mel-spectrogram from phonemes + pitch + variance curves | DiffSinger (shallow diffusion, now with rectified-flow variants), VITS-based SVS / VISinger, NNSVS |
| **Vocoder** | Waveform from mel + f0 | NSF-HiFiGAN (pitch-aware, the standard for singing) |

- **DiffSinger** (AAAI 2022, actively maintained by OpenVPI) is the reference
  open system. The original paper trained on ~5.9 h of one female singer.
  Community voicebanks are trained with the MakeDiffSinger tooling: slicing,
  forced alignment, MIDI and slur labelling.
- **OpenUtau** is a free editor that already drives DiffSinger, NNSVS/ENUNU and
  UTAU voices. It shows that a piano-roll front end plus a neural back end is a
  proven split, which is exactly Lumen's shape.
- **Community NSF-HiFiGAN vocoders** come as pretrained and fine-tunable
  checkpoints with **ONNX exports** (~72 h of singing, 44.1 kHz, 128 mel bins).
  They are licensed **CC BY-NC-SA 4.0**, so non-commercial only.
- **Technique control.** TechSinger (AAAI 2025, flow matching) controls
  intensity, mixed voice, falsetto, breathy and more, using prompt words like
  "airy". TCSinger and StyleSinger transfer style from a reference clip. These
  correspond directly to Lumen's Airy / Agile / Cool sliders.

## 3. A lighter option that fits the browser: DDSP

**Differentiable DSP** keeps a harmonic-plus-noise synthesizer like Lumen's,
but a small neural network predicts the harmonic amplitudes and noise filters
frame by frame from (phoneme, pitch, loudness). Published results:

- A DDSP singing model trained in ~12 h on small, unprocessed datasets,
  conditioned on pitch and amplitude.
- Google's *Sounds of India* ran DDSP **in the browser** (TensorFlow.js,
  WebGL), with constants compressed from 10 MB to 300 KB. That was for
  instruments, but the same approach works for voice.

For Lumen this is the most natural upgrade. The arranger (runs, scoops,
breaths, harmonies) and the pitch engine stay the same. Only the tract and
source rendering becomes "learned" from a real singer, and it stays small
enough to run on the page.

## 4. Running neural models in the browser

- ONNX models can run in a page with **onnxruntime-web** (WebAssembly or
  WebGPU). FP16 or 4-bit quantization is the usual way to make them fit.
  One TTS decoder dropped from 534 MB to 145 MB at 4-bit.
- **No public benchmark** shows a singing vocoder rendering in real time in a
  browser. Lumen renders offline before playback, so faster-than-real-time
  is not required, but this needs a prototype measurement.
- A safe fallback is a small server running the model, with the page sending
  the arranged score.

## 5. Data: the deciding factor

**Open datasets are mostly non-commercial.**

| Dataset | Size | Notes | License |
| --- | --- | --- | --- |
| GTSinger | 20 singers, multi-technique, realistic scores | Technique labels (breathy, falsetto, mixed, vibrato, glissando) | CC BY-NC-SA 4.0 |
| M4Singer | 20 singers, Mandarin | | CC BY-NC-SA 4.0 |
| NHSS | 7 h, 5 F / 5 M, English, sung + spoken | | reported CC BY-NC-SA 4.0 (verify) |
| NUS-48E | 169 min, 12 singers, English | | CC BY 4.0 on a recent Zenodo upload (verify original terms) |
| Opencpop | ~5.25 h, 1 female, Mandarin | | not confirmed |

These are fine for experiments and a personal prototype, but not for
releasing music commercially.

**Recording a consenting singer is the real path** to a distinct
alt-R&B / neo-soul voice you own. A practical recording plan:

- 1–6 hours of dry, mono, 44.1 kHz / 24-bit vocals in a quiet treated room,
  one mic, consistent distance. The original DiffSinger used ~6 h. There is no
  official minimum; the community docs don't state one.
- Cover the singer's whole range, soft to strong, with **labelled
  techniques**: breathy, falsetto / head voice, mixed voice, straight tone vs.
  vibrato, scoops, runs and riffs, fry endings, breaths.
- English phoneme coverage: songs plus scripted syllable drills.
- Labelling: forced alignment (MFA) plus MIDI and slur labels (MakeDiffSinger
  tools, vLabeler).
- A **written agreement** that covers AI training, commercial use, credit and
  any revenue share.

## 6. Legal limits on sounding like a specific artist

- **Tennessee's ELVIS Act** (2024) prohibits cloning an artist's voice with AI
  without consent. About seven states have similar laws.
- The federal **NO FAKES Act** (S.4591) cleared Senate Judiciary in June 2026
  but had not passed either chamber as of late October 2026.
- Training on recordings of Kelela, Hiatus Kaiyote or Solange, or marketing
  output as their voices, is exactly what these laws target. Lumen should keep
  doing what it does now: an original voice whose *style* is inspired by a
  genre. Any trained voice must come from a singer who agreed to it.
- Licensed alternatives already exist. ACE Studio says its stock voices are
  royalty-free and the artists are paid, with some singers requiring separate
  licensing. Kits.ai requires artist approval for commercial use of artist
  models.

## 7. Recommended roadmap

1. **Bridge now (days).** Add **MIDI / UST / USTX export** with lyrics, so a
   Lumen melody, including its runs, can be sent to OpenUtau (DiffSinger
   voices), ACE Studio or Synthesizer V for realistic rendering today.
2. **Prototype the learned renderer (weeks).** Build a DDSP-style harmonic +
   noise model conditioned on Lumen's phones, f0 and loudness curves. Train it
   on NHSS / NUS-48E female singers (research use only) to prove quality and
   browser speed with onnxruntime-web.
3. **Record your own voice (1–2 months).** Hire a singer who fits the
   airy / agile / cool brief, under a written AI-training agreement, and record
   the plan in section 5.
4. **Train for real.** Choose a DDSP model (small, in-browser) or DiffSinger +
   NSF-HiFiGAN (higher quality, likely a server). Fine-tune the vocoder from a
   pretrained checkpoint whose license allows your use, or train it yourself.
5. **Add technique control.** Use technique labels like those in TechSinger
   and GTSinger to drive breathy, falsetto, mixed voice and vibrato from
   Lumen's sliders.

Throughout, keep Lumen's score and phrasing layer as the "performer brain".
Neural back ends need exactly this kind of expressive input (pitch curves,
runs, breaths), and that part already works.

## Sources

- DiffSinger paper: https://arxiv.org/pdf/2105.02446
- OpenVPI DiffSinger / topic listing: https://github.com/topics/singing-voice-synthesis
- OpenUtau: https://openutau.com/ · voicebank development wiki: https://github.com/stakira/OpenUtau/wiki/Voicebank-development
- MakeDiffSinger: https://huggingface.co/ameerazam08/MakeDiffSinger/blob/main/README.md
- Community NSF-HiFiGAN vocoders: https://github.com/openvpi/vocoders/releases · Kouon vocoder: https://github.com/Kouon-Project/Kouon_Vocoder/releases/tag/V1.0.0
- TechSinger: https://arxiv.org/abs/2502.12572v2 · TCSinger: https://arxiv.org/pdf/2409.15977
- GTSinger: https://arxiv.org/html/2409.13832v8 · dataset card: https://huggingface.co/datasets/YGGYY/GTSinger/blob/main/README.md
- M4Singer (NeurIPS 2022): https://papers.neurips.cc/paper_files/paper/2022/file/2de60892dd329683ec21877a4e7c3091-Paper-Datasets_and_Benchmarks.pdf
- NHSS: https://arxiv.org/abs/2012.00337v1 · NUS-48E record: https://zenodo.org/records/19595152
- DDSP singing: https://export.arxiv.org/abs/2103.07197 · Sounds of India (DDSP in browser): https://blog.tensorflow.org/2020/08/creating-sounds-of-india-with-tensorflow.html
- Browser ONNX/WebGPU examples: https://huggingface.co/danyalmalik/Chatterbox-ONNX-WebGPU · https://huggingface.co/Reza2kn/gooya-v1-ONNX-fp16
- ELVIS Act: https://en.wikipedia.org/wiki/ELVIS_Act · NO FAKES status: https://talkmie.com/news/no-fakes-act-voice-likeness-us-status · state laws: https://www.recordinglaw.com/us-laws/deepfake-laws/ai-voice-cloning-laws/
- ACE Studio review: https://soundonsound.com/reviews/ace-studio · Kits.ai artist licensing: https://kits.ai/blog/voice-artist-library-faq
