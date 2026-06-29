# MSXgl example — play your generated music on MSX

A minimal [MSXgl](https://github.com/aoineko-fr/MSXgl) project that plays a
single track exported by the **MSX MML Music Generator** (the web app in the
parent folder), looping forever. It supports:

- **PSG** (AY-3-8910 square waves) and **MSX-Music** (YM2413 FM — needs the
  FM-PAC extension when emulating), and
- both **standard VGM** (`s_mymusic`) and compact **lVGM** (`s_mymusic_lvgm`,
  75–85% smaller — recommended for real projects), and
- **multiple tracks in one ROM** with `s_mymusic_multi` (SPACE to switch).

```
Web app:  describe → Generate → Download .vgm
This dir:  .vgm ─→ music_vgm.h  ─→ build s_mymusic       ─→ ROM ─→ openMSX / real MSX
           .vgm ─→ (MSXzip) ─→ music_lvgm.h ─→ build s_mymusic_lvgm ─┘   (smaller)
```

> ⚠️ **Tested on macOS only** (MSXgl 1.4.1, openMSX 21, Apple Silicon). The prebuilt
> ROMs were verified in openMSX on macOS. The Windows/Linux build and emulator
> notes are provided for completeness but have **not** been verified.

## From the web app to a ROM (quickstart)

The common path: generate a track in the web app, click **Download .lvgm** (the
button appears when the server has `MSXZIP` set — see the parent README), then
turn it into a ROM. Paths below assume MSXgl at `/path/to/MSXgl` and that you run
the Node commands from the parent repo (`msx-music-generator/`).

```bash
# 1. Embed your downloaded lVGM as a C array. It's already compressed, so this is
#    just bin2c — no MSXzip needed. (For a .vgm download, see the sections below.)
node tools/bin2c.mjs ~/Downloads/your_track.lvgm \
     /path/to/MSXgl/projects/samples/music_lvgm.h  g_Music

# 2. Copy the lVGM project files into MSXgl and build (Windows: use copy / build.bat)
cp msxgl-example/s_mymusic_lvgm.c msxgl-example/s_mymusic_lvgm.js  /path/to/MSXgl/projects/samples/
cd /path/to/MSXgl/projects/samples/
bash build.sh s_mymusic_lvgm           # → out/s_mymusic_lvgm.rom

# 3. Run. Add -ext fmpac for an MSX-Music (FM) track; omit it for a PSG track.
openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart out/s_mymusic_lvgm.rom
```

Downloaded a **`.vgm`** instead of `.lvgm`? Use the `s_mymusic` project
([Build it yourself](#build-it-yourself--the-included-demo-track)) or convert it
to lVGM first ([Smaller ROMs with lVGM](#smaller-roms-with-lvgm)). Just want to
hear something now? Run a [prebuilt ROM](#try-it-immediately-prebuilt-roms--no-toolchain-needed).

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

The [`prebuilt/`](prebuilt/) folder has ready-to-run ROMs plus the source
`.vgm` / `.lvgm` files they were built from. With just an emulator installed you
can hear them right now:

```bash
# A short C-major demo as standard VGM, PSG then FM (FM needs the FM-PAC extension)
openmsx -machine C-BIOS_MSX2+ -cart prebuilt/s_mymusic_psg.rom
openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart prebuilt/s_mymusic_fm.rom

# The showcase track as compact lVGM — a D-minor FM title fanfare
# (instrument changes, vibrato, drums; FM, so -ext fmpac)
openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart prebuilt/s_mymusic_lvgm.rom

# Two tracks in one ROM — press SPACE to switch (a PSG track + the FM fanfare)
openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart prebuilt/s_mymusic_multi.rom
```

All verified in openMSX. Sources in `prebuilt/`: `demo_psg.*` / `demo_fm.*` (the
C-major demo, VGM + lVGM) and `title_screen_psg.lvgm` / `title_screen_fm.lvgm`
(the two-track tunes).

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

## Smaller ROMs with lVGM

Recommended for real projects. **lVGM** ("light VGM") is an MSX-optimized, compressed form of VGM — typically
**75–85% smaller** (our demo: PSG 629 → 92 bytes, FM 812 → 187). It's played by
MSXgl's `vgm/lvgm_player`. Use the `s_mymusic_lvgm.*` variant in this folder.

Conversion uses MSXgl's own **MSXzip** tool (the official, correct encoder — we
don't reimplement it). The parent repo has a thin wrapper:

```bash
# point MSXZIP at the binary in your MSXgl install (MSXzip.exe on Windows)
export MSXZIP=/path/to/MSXgl/tools/MSXtk/bin/MSXzip

# .vgm → compressed lVGM C array (g_Music[]), straight into MSXgl's samples folder
node tools/vgm2lvgm.mjs your_track.vgm /path/to/MSXgl/projects/samples/music_lvgm.h g_Music

# build + run the lVGM variant (add -ext fmpac for an MSX-Music file)
cd /path/to/MSXgl/projects/samples/
bash build.sh s_mymusic_lvgm           # Windows: build.bat s_mymusic_lvgm
openmsx -machine C-BIOS_MSX2+ -cart out/s_mymusic_lvgm.rom
```

Or call MSXzip directly: `MSXzip your_track.vgm -lVGM -c -o music_lvgm.h -t g_Music`.

## Multiple tracks in one ROM

`s_mymusic_multi` embeds **two** lVGM tracks and switches between them with SPACE
(it calls `LVGM_Stop` then `LVGM_Play` on the other array). The bundled demo pairs
a PSG track with an FM one, so run it with `-ext fmpac`.

Make your own from any two `.lvgm` files:

```bash
node tools/bin2c.mjs first.lvgm  /path/to/MSXgl/projects/samples/music1_lvgm.h g_Music1
node tools/bin2c.mjs second.lvgm /path/to/MSXgl/projects/samples/music2_lvgm.h g_Music2
cp s_mymusic_multi.c s_mymusic_multi.js  /path/to/MSXgl/projects/samples/
cd /path/to/MSXgl/projects/samples/ && bash build.sh s_mymusic_multi
openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart out/s_mymusic_multi.rom
```

To add more than two, extend the `g_Songs` / `g_Names` arrays in `s_mymusic_multi.c`.

## Files

| File | Purpose |
|------|---------|
| `s_mymusic.c` / `.js` | Standard-VGM player: inits screen + chips, `VGM_Play` / `VGM_Decode` each frame |
| `music_vgm.h` | The generated music as a C byte array (`g_Music[]`) — replace with your own |
| `s_mymusic_lvgm.c` / `.js` | Compact-**lVGM** player variant (`LVGM_Play` / `LVGM_Decode`) |
| `music_lvgm.h` | The showcase FM fanfare as a compressed lVGM C array (`g_Music[]`) |
| `s_mymusic_multi.c` / `.js` | **Two tracks in one ROM**, SPACE to switch (`g_Music1` PSG + `g_Music2` FM) |
| `music1_lvgm.h` / `music2_lvgm.h` | The two demo tracks for the multi player |
| `prebuilt/` | Ready-to-run ROMs (`s_mymusic_psg/_fm`, `s_mymusic_lvgm`, `s_mymusic_multi`) + their `.vgm` / `.lvgm` sources |

## Notes

- The ROM links every chip the player supports, so the **same ROM** plays PSG or
  MSX-Music files without reconfiguration. To shrink it further, drop unused
  modules from the `.js` and set the matching `VGM_USE_*` / `LVGM_USE_*` defines.
- `Target = "ROM_32K"` fits a short track. For longer/larger music, raise the
  target (e.g. `ROM_48K_ISR`) or use banking like MSXgl's own `s_vgm` sample.
- For real projects, prefer **lVGM** — it's much smaller and plays the same.
