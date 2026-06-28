# VGM Export & MSXgl Integration

How `public/vgm.js` turns parsed MML into a standard **VGM** file for the
**AY-3-8910 (MSX PSG)**, and how to play that file in an MSXgl game.

- VGM specification: https://vgmrips.net/wiki/VGM_Specification
- MSXgl `vgm_player`: https://aoineko.org/msxgl/index.php?title=Modules/vgm/vgm_player

## What VGM is

VGM is an open, documented **register-log** format: a header describing the
sound chip(s), followed by a stream of commands that say "write value V to
chip register R" interleaved with "wait N samples". A player replays those
writes with the original timing. Because it's just register writes, **we can
generate it ourselves** — unlike the proprietary binaries of NDP/PT3/AKG.

## How the exporter works

`buildVGM(channels, bpm, loop = true) → Uint8Array`

1. **Parse** each channel with the shared `parseChannel` (see
   [MML-REFERENCE.md](MML-REFERENCE.md)) into `{ midi, dur, vol }` events.
2. **Frame grid:** the piece is rendered at **60 Hz** (NTSC). Each note event
   is painted onto the frames it spans (`round(startSec × 60)` …
   `round(endSec × 60)`).
3. **Per frame**, for each of the 3 channels, the target PSG registers are
   computed and written **only when they change** (keeps files small):
   - tone period (12-bit) → register pair (fine/coarse),
   - volume (0–15) → volume register.
   Then a "wait one frame" command (`0x62`, 735 samples @ 44100) is emitted.
4. A loop point and end marker are written; the header is filled in.

### PSG register map used

| Register | Purpose | Written |
|----------|---------|---------|
| R0 / R1 | Channel A tone period fine / coarse | per note change |
| R2 / R3 | Channel B tone period fine / coarse | per note change |
| R4 / R5 | Channel C tone period fine / coarse | per note change |
| R7 | Mixer | once: `0x38` = tones A/B/C on, noise off |
| R8 / R9 / R10 | Channel A / B / C volume (0–15) | per note change |

Tone period: `period = round(clock / (16 × freq))`, `clock = 1789772 Hz`
(MSX PSG = 3.579545 MHz ÷ 2). `fine = period & 0xFF`, `coarse = (period >> 8) & 0x0F`.

Noise (R6), envelope (R11–R13) are unused; silence is volume 0, not mixer muting.

### VGM commands emitted

| Byte(s) | Meaning |
|---------|---------|
| `A0 RR VV` | Write AY-3-8910 register `RR` = `VV` |
| `62` | Wait 735 samples (1 frame @ 60 Hz) |
| `66` | End of sound data |

### Header fields set (VGM v1.51)

| Offset | Field | Value |
|--------|-------|-------|
| `0x00` | Ident | `"Vgm "` |
| `0x04` | EOF offset | file size − 4 |
| `0x08` | Version | `0x00000151` (AY8910 support added in 1.51) |
| `0x18` | Total samples | sum of all waits |
| `0x1C` | Loop offset | → data start (when `loop`) |
| `0x20` | Loop samples | total samples (when `loop`) |
| `0x24` | Rate | 60 |
| `0x34` | VGM data offset | → `0x100` |
| `0x74` | AY8910 clock | `1789772` |
| `0x78` | AY8910 chip type | `0x00` (AY-3-8910) |

Data begins at `0x100`.

## Verifying a file

- **In the app:** click **▶ Play .vgm** — `public/vgmplay.js` decodes the exact
  bytes and plays them, so it reflects the file, not the MML.
- **On macOS:** open it in [Furnace](https://github.com/tildearrow/furnace/releases)
  (also shows the AY registers live). Note: Homebrew's `vgmstream` does **not**
  play chiptune register-log VGM — wrong tool.

## Using a `.vgm` in an MSXgl game

> High-level outline — confirm against your MSXgl version and the `s_vgm` sample
> (`projects/samples/s_vgm.c`). Not yet tested end-to-end from this app.

1. **Enable the module** in the project config:
   ```js
   MUSIC_MODULE: "vgm/vgm_player",
   ```
2. **Enable PSG** in the player config: `#define VGM_USE_PSG TRUE`.
3. **Place the file** in your project's `data/` directory and include it so the
   bytes are linked in (as the sample does).
4. **Drive playback** each frame:
   ```c
   #include "vgm/vgm_player.h"
   #include "data/my_music.h"   // the included VGM byte array

   void main() {
       VGM_Play(my_music, TRUE); // TRUE = loop
       while (1) {
           Halt();               // wait for VBlank (60 Hz)
           VGM_Decode();         // advance playback one frame
       }
   }
   ```
   (Exact function names vary by MSXgl version — check `vgm_player.h`.)

### Smaller files: lVGM

MSXgl ships **lVGM** ("light VGM") + `lvgm_player` for compact PSG playback.
Convert a standard `.vgm` to `.lvgm` with MSXgl's **MSXzip** tool, then use
`MUSIC_MODULE: "vgm/lvgm_player"` with `#define LVGM_USE_PSG TRUE`. This is the
recommended route for ROM-size-constrained games, since VGM register logs are
larger than tracker formats.

## MSX-Music (YM2413 / OPLL) export

Selecting **MSX-Music** in the app exports an FM VGM instead of PSG, implemented
in `public/vgm-opll.js`. The OPLL is a 9-channel FM chip with 15 built-in
instrument patches; our three voices map to OPLL channels 0/1/2.

- **Frequency:** `freq = fnum × (clock/72) / 2^(19 − block)`, `clock = 3579545`.
  We pick the smallest `block` (octave) that keeps the 9-bit `fnum` < 512.
- **Registers** (channel `c`): `0x10+c` F-Num low · `0x20+c` F-Num bit8 + block +
  key-on (bit 4) · `0x30+c` instrument (bits 4-7) + attenuation (bits 0-3, 0 = loud).
- **Volume:** PSG-style `v1..15` → attenuation `15 − v`.
- **Articulation:** a new note key-offs then key-ons within the frame so the FM
  envelope re-attacks.
- **Header:** YM2413 clock at offset `0x10` (AY clock left 0); commands are
  `0x51 RR VV`.

Functions: `buildOPLLfromMML(channels, bpm, loop, instruments)` (from MML),
`transcodePsgToOPLL(psgBytes, …)` (re-voice an existing PSG VGM as FM). Default
instruments are `[Vibraphone, Organ, Acoustic Bass]`.

**Playback:** MSXgl's `vgm_player` plays it when built with `VGM_USE_MSXMUSIC`
and the `msx-music` module linked, and the program calls `MSXMusic_Initialize()`.
In openMSX the machine needs the YM2413 — add `-ext fmpac`. The bundled
[`msxgl-example`](../msxgl-example/) handles all of this.

Note: this **re-voices** the same notes through FM; it is not music composed to
exploit FM synthesis.

## Current limitations

- 60 Hz (NTSC) only; no 50 Hz (PAL) variant yet.
- Tone + volume + rests only — no noise channel, SFX, or hardware envelopes.
- Volume is written linearly (MML `v1–15` → PSG `0–15`); the PSG's volume curve
  is logarithmic, so loud/soft balance is approximate.
