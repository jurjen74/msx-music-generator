# Pipeline & Format Choice

Why this app exports **PSG VGM** as its primary, fully-automatable output, and
how that compares to the original **NDP** plan and other options. This records
the research so the decision is reproducible.

## The goal

`Claude → MML → game-ready binary → MSXgl player → sound`, ideally with every
step runnable on **macOS** with no manual GUI work.

## What MSXgl can play (PSG)

| Format | Authoring tool | Binary is… | CLI compiler on Mac? |
|--------|----------------|------------|----------------------|
| NDP | NDP editor (naruto2413) | proprietary | ❌ Windows-only GUI, no CLI |
| PT3 | Vortex Tracker II | proprietary | ❌ GUI |
| AKG/AKY/AKM | Arkos Tracker 2/3 | proprietary | ✅ CLI, cross-platform — but input is a **tracker** file, not MML |
| WYZ | WYZ Tracker | proprietary | ❌ |
| **VGM / lVGM** | (register log) | **open, documented** | ✅ **we generate it ourselves** |
| ayFX | ayFX editor | proprietary | ❌ (SFX only) |

The compact formats (NDP, PT3, AKG, WYZ) all use **undocumented proprietary
binaries** — generating them ourselves would mean reverse-engineering. **VGM is
the only open, documented format** in the list, which is why it's the one we can
emit directly from code.

## Why not NDP (the original plan)

NDP is a closed **Windows-only** .NET Framework 4.8 WinForms application. The
MML→binary "compilation" happens *inside that GUI* (type MML, press F5 to play,
export to save). There is **no command-line compiler**, the `.ndp` binary format
(MSX BSAVE) is undocumented, and the MML dialect is published only as a text file
inside the download. So NDP can't be scripted; it would always be a manual step
(run the Windows app under a VM/Wine, click export).

The app still supports the NDP route — **Download .mml** / **Copy** produce clean
MML for it — but it's no longer the recommended path.

## Why not mml2vgm

[mml2vgm](https://github.com/kuma4649/mml2vgm) has a real CLI (`mvc`) that
compiles MML→VGM and supports the AY-3-8910. But its README marks it
**Windows-only** (Windows audio dependencies, no cross-platform binaries), so it
isn't usable on macOS without building from source and stripping Windows deps —
not worth it when we can emit VGM directly.

## Why not Arkos Tracker

Arkos Tracker 3 is genuinely cross-platform with a solid **command-line**
exporter — the strongest tooling here. But its input is an Arkos `.aks` **tracker
project**, not MML, so it abandons the "AI writes MML text" model that's the core
of this project. A good option if the project ever pivots to tracker authoring.

## Does Docker help?

**Docker Desktop on macOS runs Linux containers, not Windows ones.** So it does
*not* let you run NDP or other Windows-only `.exe`s natively (only via Wine,
which for a GUI compiler is fragile and pointless). It's genuinely useful
*downstream* — a reproducible Linux box for the MSXgl build itself (SDCC, MSXzip,
openMSX) — but it doesn't change the music-compile decision.

## Decision

**Generate standard PSG VGM ourselves**, in-app, in JavaScript:

- ✅ Keeps Claude writing MML (the project's premise).
- ✅ Runs entirely on macOS, no external tools, no Windows, no GUI.
- ✅ Open, documented format we fully control.
- ✅ Plays on MSXgl `vgm_player` (`VGM_USE_PSG`); shrink to **lVGM** with MSXgl's
  own **MSXzip** tool for ROM size.

Trade-off: VGM register logs are larger than tracker formats (mitigated by lVGM),
and we implement the chip features ourselves (currently tone + volume + rests;
noise/SFX/envelopes are future work — see [ARCHITECTURE.md](ARCHITECTURE.md)).

## Verification status

- VGM output **byte-validated** against the spec, and **round-trip tested**
  (encode → `decodeVGM` → correct note frequencies/timing).
- **Not yet** run through MSXgl's `s_vgm` sample on openMSX — the recommended
  next confirmation.

## References

- VGM spec — https://vgmrips.net/wiki/VGM_Specification
- MSXgl — https://github.com/aoineko-fr/MSXgl · vgm_player / lvgm_player module docs at https://aoineko.org/msxgl/
- NDP — https://ndp.squares.net/web/
- mml2vgm — https://github.com/kuma4649/mml2vgm
- Arkos Tracker — https://www.julien-nevo.com/arkostracker/
- Furnace (VGM playback/verification) — https://github.com/tildearrow/furnace
