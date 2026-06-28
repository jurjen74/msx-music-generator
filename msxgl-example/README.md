# MSXgl example — play your generated music on MSX

A minimal [MSXgl](https://github.com/aoineko-fr/MSXgl) project that plays a
single `.vgm` exported by the **MSX MML Music Generator** (the web app in the
parent folder), looping forever. It works with both export formats:

- **PSG** (AY-3-8910 square waves), and
- **MSX-Music** (YM2413 FM) — needs the FM-PAC extension when emulating.

```
Web app:  describe → Generate → Download .vgm
This dir:  .vgm → music_vgm.h → build → s_mymusic.rom → openMSX / real MSX
```

> ⚠️ **Tested on macOS only** (MSXgl 1.4.1, openMSX 21, Apple Silicon). The prebuilt
> ROMs were verified in openMSX on macOS. The Windows/Linux build and emulator
> notes are provided for completeness but have **not** been verified.

## Prerequisites

- **MSXgl** checked out and working (tested with MSXgl 1.4.1). It bundles SDCC and
  the build tools, so no separate compiler install is needed. Follow MSXgl's own
  setup guide for your OS (`SETUP_MACOS.md` / `SETUP_WINDOWS.md` /
  `SETUP_LINUX.md`) and confirm you can build one of its samples first.
- **Node.js 20.12+** (for the conversion tools in the parent repo).
- An emulator such as **openMSX**, or real hardware:

  | OS | Install openMSX |
  |----|-----------------|
  | **macOS** | `brew install openmsx` |
  | **Windows** | Installer from [openmsx.org](https://openmsx.org) (or `choco install openmsx`) |
  | **Linux** | `sudo apt install openmsx` / distro package, or the AppImage from [openmsx.org](https://openmsx.org) |

### Build command per OS

MSXgl's build script is `build.sh` on macOS/Linux and `build.bat` on Windows. The
examples below use `build.sh`; on Windows run `build.bat s_mymusic` instead (from
a regular Command Prompt / PowerShell, with Node on `PATH`).

## Try it immediately (prebuilt ROMs — no toolchain needed)

The [`prebuilt/`](prebuilt/) folder contains ready-to-run ROMs of the demo track
(a short C-major arpeggio), plus the source `.vgm` files they were built from.
With just an emulator installed you can hear the result right now:

```bash
# PSG (AY-3-8910) version — runs on any MSX
openmsx -machine C-BIOS_MSX2+ -cart prebuilt/s_mymusic_psg.rom

# MSX-Music (YM2413 FM) version — needs the FM-PAC extension
openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart prebuilt/s_mymusic_fm.rom
```

Both were built with the steps below and verified in openMSX. `prebuilt/demo_psg.vgm`
and `prebuilt/demo_fm.vgm` are the exact files fed into them — drop them into the
web app's tools or inspect them to see what the generator produces.

## Build it yourself — the included demo track

This folder ships with a ready-made `music_vgm.h` (a short C-major tune) so you
can verify the whole chain before plugging in your own music.

```bash
# 1. Copy the three project files into MSXgl's samples folder
#    (Windows: use `copy` instead of `cp`)
cp s_mymusic.c s_mymusic.js music_vgm.h  /path/to/MSXgl/projects/samples/

# 2. Build  (Windows: build.bat s_mymusic)
cd /path/to/MSXgl/projects/samples/
bash build.sh s_mymusic        # → out/s_mymusic.rom

# 3. Run
openmsx -machine C-BIOS_MSX2+ -cart out/s_mymusic.rom
```

You should see a small status screen (`Header: OK`, `PSG: ✓`, …) and hear the
tune looping.

## Use your own music

1. **Generate** a track in the web app (parent folder: `npm start`), choose the
   **Target chip** (PSG or MSX-Music; for MSX-Music pick the FM voices), and
   click **Download .vgm**.

2. **Convert** the `.vgm` to a C array named `g_Music`, writing it straight into
   MSXgl's samples folder:

   ```bash
   # from the parent repo (msx-music-generator/)
   node tools/bin2c.mjs ~/Downloads/your_track.vgm \
        /path/to/MSXgl/projects/samples/music_vgm.h  g_Music
   ```

3. **Rebuild and run** (the build + run steps above). For an **MSX-Music (FM)** file,
   add the FM-PAC extension so the YM2413 exists in the emulator:

   ```bash
   openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart out/s_mymusic.rom
   ```

   The status screen confirms what was detected: `PSG: ✓` for a PSG file, or
   `MSX-Mus: ✓` for an FM file.

## Converting an existing PSG file to FM

If you already have a PSG `.vgm` and want to hear it on MSX-Music, transcode it
first (re-voices the same notes as FM), then convert to a C array:

```bash
# from the parent repo
node tools/vgm-psg2opll.mjs your_psg.vgm your_fm.vgm
node tools/bin2c.mjs your_fm.vgm /path/to/MSXgl/projects/samples/music_vgm.h g_Music
```

## Files

| File | Purpose |
|------|---------|
| `s_mymusic.c` | The program: inits the screen + chips, `VGM_Play`, `VGM_Decode` each frame |
| `s_mymusic.js` | MSXgl project config — `ROM_32K`, PSG + MSX-Music + SCC + MSX-Audio + VGM player modules |
| `music_vgm.h` | The generated music as a C byte array (`g_Music[]`) — replace with your own |
| `prebuilt/` | Ready-to-run `s_mymusic_psg.rom` / `s_mymusic_fm.rom` + their source `.vgm` files |

## Notes

- The ROM links every chip the VGM player supports, so the **same ROM** plays
  PSG or MSX-Music files without reconfiguration. To shrink it, you can drop
  unused modules from `s_mymusic.js` and set the matching `VGM_USE_*` defines.
- `Target = "ROM_32K"` fits a short track. For longer/larger music, raise the
  target (e.g. `ROM_48K_ISR`) or use banking like MSXgl's own `s_vgm` sample.
- MSXgl ships a `MSXzip` tool that converts VGM to the compact **lVGM** format
  (`vgm/lvgm_player`) for size-constrained ROMs — see MSXgl's docs.
