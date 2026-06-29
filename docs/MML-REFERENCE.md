# MML Reference

This is the subset of **MML (Music Macro Language)** that the app's parser
(`public/player.js`, function `parseChannel`) understands. Both the browser
preview and the VGM exporter consume this same parser, so anything documented
here plays *and* exports consistently.

> This is a pragmatic subset aimed at PSG game music, not a full MML dialect.
> The model is prompted (in `server.js`) to emit exactly these commands.

## Channels

A piece has three channels, conventionally:

| Channel | Role | PSG |
|---------|------|-----|
| **A** | Melody (higher register, movement) | Tone channel A |
| **B** | Harmony / chord tones | Tone channel B |
| **C** | Bass line / rhythm | Tone channel C |

Each channel is an independent MML string. The app keeps them in sync by making
all three the same total length; if they differ, the *longest* defines the loop
length and shorter channels simply fall silent for the remainder.

## Commands

| Syntax | Meaning | Notes |
|--------|---------|-------|
| `c d e f g a b` | Notes | Lowercase. Case-insensitive (input is lowercased). |
| `#` or `+` | Sharp | After a note: `c#`, `f+`. Multiple stack: `c##`. |
| `-` | Flat | After a note: `e-`, `b-`. |
| `1 2 4 8 16 …` | Note length | Immediately after a note/rest. `4`=quarter, `8`=eighth, etc. `1`=whole. Any integer works. |
| `.` | Dotted | After the length: `c4.` = 1.5×, `c4..` = 1.75×. |
| `r` | Rest | Takes a length like a note: `r4`, `r8.`. |
| `o1`–`o8` | Set octave | `o4 c` = middle C (MIDI 60 / C4). |
| `>` | Octave up | Adds 1 to the current octave. |
| `<` | Octave down | Subtracts 1. |
| `l1`–`l16…` | Default length | Length used when a note omits its own: `l8 c d e` = three eighths. |
| `v1`–`v15` | Volume | Maps to PSG volume 0–15. Default `v11`. Applies to following notes. |
| `t<bpm>` | Tempo | Global; supplied to the parser separately (the `TEMPO:` field). Inline `t` inside a channel is skipped. |
| `&` | Tie | `c4&c8` joins two **same-pitch** notes into one (durations add). Different pitches play sequentially. |
| `[ … ]N` | Loop | Repeats the bracketed pattern N times: `[c8 d8]4`. N defaults to **2** if omitted. Nested loops are supported (innermost resolved first). |
| whitespace | Ignored | Use freely for readability. |
| unknown chars | Skipped | The parser ignores anything it doesn't recognize rather than erroring. |

## Pitch & timing model

- **Octave/pitch:** `midi = (octave + 1) × 12 + semitone`, where
  `c=0, d=2, e=4, f=5, g=7, a=9, b=11` (± accidentals). So `o4 c` = MIDI 60.
  Frequency = `440 × 2^((midi − 69) / 12)`.
- **Duration:** a length-`N` note lasts `(4 / N)` quarter-notes; a quarter-note
  is `60 / bpm` seconds. Dots multiply by 1.5, 1.75, …
- Tempo (`bpm`) is passed into `parseChannel(mml, bpm)`; it is **not** read from
  inside the channel string.

## Examples

```
o4 c4 d4 e4 f4 g2                 ; C major run, ending on a half note
o5 [c8 d8 e8 f8]2 g4 r4           ; a looped four-note figure, then a note + rest
o4 c4&c8 g+4 a-4                  ; tie (C held 1.5 beats), then G# and Ab
l8 c d e f g a b > c              ; eighth-note scale using a default length
v15 o3 c2 v8 g2                   ; loud C, then quieter G
```

## Drums — Channel D

An optional fourth channel `D` adds drums on either chip:
- **MSX-Music:** drives the YM2413 **rhythm section** (its own channels 6–8 — the
  melody channels are untouched).
- **PSG:** rendered on the **noise generator**, overlaid on Channel C, so each hit
  briefly ducks the bass (the classic 3-channel PSG technique). Keep PSG drum
  patterns fairly sparse.

| Symbol | Drum | YM2413 rhythm bit |
|--------|------|-------------------|
| `k` | kick (bass drum) | 0x10 |
| `s` | snare | 0x08 |
| `t` | tom | 0x04 |
| `c` | cymbal (top) | 0x02 |
| `h` | hi-hat | 0x01 |
| `r` | rest | — |

Lengths, dots, `l` default length, and `[pattern]N` loops work as for notes.
**Group letters for simultaneous hits**: `kh8` = kick + hi-hat together for an
eighth. Example backbeat groove: `[k8 h8 s8 h8]4`. Keep Channel D the same total
length as the other channels (it's trimmed to the loop length on export).

Drums are parsed by `parseDrumChannel`; the FM exporter renders them to the OPLL
rhythm registers, the PSG exporter to the noise generator (channel C overlay),
and the browser preview approximates them with synthesized kick/snare/hat/tom/cymbal.

## Notes for the VGM path

The exporter (`public/vgm.js`) maps each parsed note to PSG registers:

- Pitch → 12-bit tone period `round(1789772 / (16 × freq))`, clamped to 1–4095.
- Volume → PSG volume register (0–15), used directly.
- Rests / `v0` → volume 0 (silence) on that channel.

Pitches far outside the PSG's range (≈27 Hz–above audible) are clamped to the
nearest valid period. See [VGM-FORMAT.md](VGM-FORMAT.md) for the encoding.
