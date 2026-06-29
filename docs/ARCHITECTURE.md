# Architecture

A deliberately small, **zero-dependency** app: a tiny Node server plus a
vanilla-JS browser front end (ES modules, no build step, no framework).

## Layout

```
msx-music-generator/
├── server.js              Node HTTP server: static files + Claude API proxy
├── package.json           "npm start" → node server.js (no dependencies)
├── .env / .env.example    ANTHROPIC_API_KEY (gitignored)
├── public/                served as-is to the browser
│   ├── index.html         UI markup
│   ├── style.css          styles (dark theme)
│   ├── app.js             UI controller (entry module)
│   ├── player.js          MML parser + Web Audio playback
│   ├── vgm.js             MML → PSG (AY-3-8910) VGM exporter
│   ├── vgm-opll.js        MML/PSG → MSX-Music (YM2413 FM) VGM exporter + transcoder
│   └── vgmplay.js         VGM decoder + Web Audio playback (PSG)
├── tools/                 Node CLIs: bin2c, vgm2c, vgm-psg2opll, vgm2lvgm (MSXzip wrapper)
├── msxgl-example/         ready-to-build MSXgl ROMs (VGM + lVGM) that play an exported track
└── docs/                  this documentation
```

## Data flow

```
 Browser (app.js)                         Server (server.js)            Anthropic
 ─────────────────                        ───────────────────          ─────────
 collect form fields ── POST /api/generate ─→ buildSystemPrompt ──────→ Claude API
                                              parse CHANNEL_A/B/C…  ←──── MML text
 current = {channels,    ←── JSON {channels, ─┘
   tempo, note, mml}          tempo, note, mml, raw}

 ▶ Preview (MML):  player.js   parseChannel(channels, tempo) → square-wave notes
 ▶ Play .vgm:      vgm.js      buildVGM(channels, tempo) → bytes
                   vgmplay.js  decodeVGM(bytes) → register writes → square-wave
 Download .vgm:    vgm.js      buildVGM(...) → Blob → file
 Download .mml:    current.mml → Blob → file
```

The **MML parser is the single source of truth**: both the preview and the VGM
exporter call `parseChannel`, so what you hear in preview is what gets encoded.

## Modules

### `server.js`
- Zero-dependency Node `http` server.
- Loads `.env` via `process.loadEnvFile` (Node 20.12+).
- `GET *` → serves files from `public/` (with a path-traversal guard and a small
  MIME map).
- `POST /api/generate` → builds the system prompt from the request fields, calls
  the Claude Messages API with the server-side key, parses the `CHANNEL_A:` /
  `CHANNEL_B:` / `CHANNEL_C:` / `TEMPO:` / `NOTE:` lines, and returns
  `{ channels, tempo, note, mml, raw }`. Errors (missing key, API failure,
  unparseable output) return a JSON `{ error }` with an appropriate status.

### `public/app.js` (entry module)
- Populates the style/key selects, wires every button, owns the `current`
  result object, and manages play/stop UI state (`setPlaying`, `stopAll`).
- Holds one `MMLPlayer` and one `VGMPlayer`; only one plays at a time.

### `public/player.js`
- `parseChannel(mml, bpm)` → `[{ midi|null, dur, vol }]` (see
  [MML-REFERENCE.md](MML-REFERENCE.md)). `expandLoops` resolves `[..]N`.
- `parseAlignedChannels(channels, bpm)` → parses all three and trims them to the
  shortest non-empty channel, so the piece loops cleanly even when a long AI
  generation gives the channels uneven lengths. The preview and both VGM
  exporters use this, so what you hear is what you export.
- Also `parseDrumChannel` / `drumOnsets` (Channel D), `loopPointSeconds` (the
  `/` marker), and the `VIB_RATE` / `VIB_DEPTH` vibrato constants live here so
  every renderer shares them.
- `class MMLPlayer` → Web Audio preview: a `square` oscillator per note with a
  pluck decay, optional vibrato LFO (`~`), synthesized drums, and an intro/loop
  point (`/`). `play(channels, bpm, loop)`, `stop()`, `onEnd`, `onLoop`.

### `public/vgm.js`
- `buildVGM(channels, bpm, loop)` → `Uint8Array` of a complete PSG VGM file.
  Renders the parsed events onto a 60 Hz frame grid and encodes PSG register
  writes, with per-note **decay**, **vibrato** (period modulation), **drums**
  (Channel D on the noise generator, ducking the bass), and a **loop point**.
  Full details in [VGM-FORMAT.md](VGM-FORMAT.md).

### `public/vgm-opll.js`
- MSX-Music (YM2413/OPLL FM): `buildOPLLfromMML(channels, bpm, loop,
  instruments)`, `transcodePsgToOPLL(psgBytes, …)`, `OPLL_INSTRUMENTS` names.
  Drums on the rhythm section, **vibrato** (F-number bend without re-key),
  per-note **instrument changes** (`@n`), and a **loop point**. Pure (no DOM) —
  testable in Node. See [VGM-FORMAT.md](VGM-FORMAT.md).

### `public/vgmplay.js`
- `decodeVGM(u8)` → `{ events, totalSamples, ayClock, loopSample }` by walking
  the command stream. Pure (no DOM) — unit-testable in Node.
- `class VGMPlayer` → three persistent `square` oscillators whose
  frequency/gain are scheduled from the decoded register writes; same
  `play/stop/onEnd/onLoop` shape as `MMLPlayer`.

## Conventions

- **No build step / no dependencies.** Browser code is ES modules loaded
  directly; the server is plain Node. Keep it that way unless there's a strong
  reason.
- **Parser is shared.** New musical features should be added to `parseChannel`
  so preview and export stay in lockstep.
- **Players share an API** (`play`, `stop`, `onEnd`, `onLoop`) so `app.js` can
  treat them uniformly.

## Testing

The pure functions are verifiable in Node despite the browser context, because
`parseChannel`, `buildVGM`, and `decodeVGM` don't touch the DOM:

```bash
# from the repo root, in a throwaway .mjs:
node --input-type=module -e '
  import { buildVGM } from "./public/vgm.js";
  import { decodeVGM } from "./public/vgmplay.js";
  const v = buildVGM({A:"o4 c4 e4 g4", B:"", C:""}, 120, true);
  console.log("bytes", v.length, decodeVGM(v).totalSamples, "samples");
'
```

(`app.js` and the player *classes* touch `window`/`document` and only run in a
browser; the parsing/encoding/decoding functions do not.)

## Extending

Already built (look at these as patterns): per-note decay, vibrato (`~`), drums
(Channel D — OPLL rhythm on FM, noise generator on PSG), mid-track FM instruments
(`@n`), a loop point (`/`), channel auto-alignment, and lVGM export (server
`/api/lvgm` via MSXgl's MSXzip + `tools/vgm2lvgm.mjs`).

Remaining ideas:

- **Add an MML command:** extend the `while` loop in `parseChannel`
  (`public/player.js`) and attach the new field to the note event; the exporters
  and preview read it. Document it in [MML-REFERENCE.md](MML-REFERENCE.md).
- **PSG hardware envelopes (R13):** set R11–R13 and the volume-register envelope
  bit (bit 4) in `vgm.js` for buzzy/auto-decaying bass; approximate in the players.
- **Sound effects (SFX):** a separate one-shot layer (ayFX-style), mixed over the
  music — distinct from the music exporters.
- **PAL (50 Hz):** parameterize `RATE`/`SAMPLES_PER_FRAME` and use the `0x63`
  wait command; thread a UI toggle through `app.js`.
- **Editable MML + re-preview / per-channel mute-solo:** browser-side polish of
  the generated MML (the biggest remaining quality lever).
