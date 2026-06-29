# MSX2 Game — AI Music Integration Context

> **Historical note.** This is the original brainstorm that kicked off the project,
> when the plan centred on the NDP toolchain. The project has since moved to a
> Mac-native **VGM / lVGM** pipeline (PSG *and* MSX-Music). For current, accurate
> docs see the [README](README.md) and [docs/](docs/) — especially
> [docs/PIPELINE.md](docs/PIPELINE.md), which explains why VGM replaced NDP.
> This file is kept for context only.

## Project
- Building an MSX2 game using **MSXgl** (C game library): https://github.com/aoineko-fr/MSXgl
- Target chip: **PSG (AY-3-8910)** built into MSX2, 3 square-wave channels (A/B/C)
- Optional expansion: MSX-Music (OPLL/FM-PAC), Konami SCC

## Goal
Generate game music using AI (Claude), then integrate it into the MSXgl game. The chosen pipeline is:

```
Claude AI → MML text → NDP compiler (Windows) → .ndp binary → MSXgl ndp_player module → sound in game
```

## Audio format chosen: NDP
- **NDP** is a PSG driver for MSX by naruto2413: https://ndp.squares.net/web/
- Uses **MML (Music Macro Language)** as input — a text-based music notation
- Windows editor + MML compiler included; exports `.ndp` binary files
- MSXgl has a built-in `ndp/ndp_player` module with a sample at `projects/samples/s_ndp/`

## MML syntax used by the AI generator
- Notes: `c d e f g a b` (lowercase), `#` sharp, `-` flat
- Octave: `o1`–`o8` prefix (e.g. `o5c`)
- Length after note: `1`=whole `2`=half `4`=quarter `8`=eighth `16`=sixteenth
- Rest: `r` (e.g. `r4`)
- Octave shift: `>` up, `<` down
- Tie: `&` (e.g. `c4&c8`)
- Volume: `v1`–`v15`
- Loop: `[pattern]N`
- Tempo: `tBPM` (e.g. `t120`)
- Format: `CHANNEL_A:` melody, `CHANNEL_B:` harmony, `CHANNEL_C:` bass/rhythm

## MSXgl integration — project_config.js
```js
MUSIC_MODULE: "ndp/ndp_player",
```

## MSXgl integration — C code pattern
```c
#include "ndp/ndp_player.h"

// Include compiled binary data
#include "data/my_music.ndp"   // exposes byte array

void main() {
    NDP_Initialize();
    NDP_Play(my_music);        // start BGM

    while(1) {
        UpdateGame();
        Halt();                // wait for VBlank (60Hz NTSC)
        NDP_Update();          // must be called once per frame
    }
}

// To switch tracks (e.g. boss fight):
NDP_Stop();
NDP_Play(boss_music);

// To stop:
NDP_Stop();
```

## Other supported MSXgl audio formats (alternatives)
| Format | Tool | Module |
|--------|------|--------|
| AKG/AKY/AKM | Arkos Tracker 2/3 | `arkos/akg_player` |
| PT3 | Vortex Tracker II | `pt3/pt3_player` |
| WYZ | WYZ Tracker | `wyz/wyz_player` |
| VGM | Furnace Tracker | `vgm/vgm_player` |
| ayFX | ayFX Editor (SFX only) | `ayfx/ayfx_player` |

## Sound effects
- Use **ayFX** format separately for SFX (jumps, shots, explosions)
- Integrates alongside music players
- Module: `ayfx/ayfx_player`

## Reference sample in MSXgl
- `projects/samples/s_ndp/` — working NDP playback example to use as skeleton
- `projects/samples/s_ayfx/` — ayFX sound effects example

## Next steps
1. Generate MML with the AI script below (call it from CLI or paste into claude.ai)
2. Paste MML into NDP editor, preview, export `.ndp`
3. Place `.ndp` in `projects/your_game/data/`
4. Enable `ndp/ndp_player` in `project_config.js`
5. Add `NDP_Initialize()`, `NDP_Play()`, `NDP_Update()` to game C code
6. Build and test in openMSX emulator

---

## AI MML Generator script

Save as `generate_mml.js` and run with `node generate_mml.js` (requires Node.js).
Set your `ANTHROPIC_API_KEY` environment variable first.

```js
// generate_mml.js
// Usage: node generate_mml.js [description]
// Example: node generate_mml.js "fast boss fight in A minor"
// Requires: ANTHROPIC_API_KEY environment variable

const https = require("https");

const description = process.argv.slice(2).join(" ") || "cheerful overworld theme in C major, medium tempo, 16 bars";

const systemPrompt = `You are an expert MSX chiptune composer writing MML (Music Macro Language) for the PSG chip (AY-3-8910, 3 square-wave channels A/B/C).

Write looping game music based on this description: "${description}".

Output ONLY this exact format — no markdown, no preamble, no extra text:

CHANNEL_A: <mml>
CHANNEL_B: <mml>
CHANNEL_C: <mml>
TEMPO: <bpm number>
NOTE: <one sentence describing the piece>

MML syntax rules:
- Notes: c d e f g a b (lowercase), # for sharp, - for flat
- Octave: o1-o8 prefix (e.g. o5c)
- Length after note: 1=whole 2=half 4=quarter 8=eighth 16=sixteenth (e.g. c4 c8)
- Rest: r (e.g. r4)
- Octave shift: > (up) < (down)
- Tie: & (c4&c8)
- Volume: v1-v15
- Loop: [pattern]N
- Channel A = melody (higher register, more movement)
- Channel B = harmony / mid bass (chord tones)
- Channel C = bass line or rhythmic pattern
- End the phrase so it loops seamlessly`;

const body = JSON.stringify({
  model: "claude-sonnet-4-6",
  max_tokens: 1000,
  system: systemPrompt,
  messages: [{ role: "user", content: "Generate the MML now." }]
});

const options = {
  hostname: "api.anthropic.com",
  path: "/v1/messages",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "Content-Length": Buffer.byteLength(body)
  }
};

const req = https.request(options, (res) => {
  let data = "";
  res.on("data", chunk => data += chunk);
  res.on("end", () => {
    const json = JSON.parse(data);
    if (json.error) { console.error("API error:", json.error.message); process.exit(1); }

    const text = json.content?.find(b => b.type === "text")?.text || "";
    const parsed = {};
    text.split("\n").forEach(line => {
      const m = line.match(/^(CHANNEL_[ABC]|TEMPO|NOTE):\s*(.+)/);
      if (m) parsed[m[1]] = m[2].trim();
    });

    if (!parsed["CHANNEL_A"]) {
      console.error("Could not parse output:\n", text);
      process.exit(1);
    }

    const bpm = parsed["TEMPO"] || "120";
    const mml = `; MSX PSG MML
; ${description}
; ${bpm} BPM — loops seamlessly
; Generated by Claude AI — paste into NDP editor to compile

t${bpm}

; Channel A — Melody
A: ${parsed["CHANNEL_A"]}

; Channel B — Harmony
B: ${parsed["CHANNEL_B"]}

; Channel C — Bass / rhythm
C: ${parsed["CHANNEL_C"]}

; ${parsed["NOTE"] || ""}
`;

    console.log(mml);

    // Optionally write to file
    const fs = require("fs");
    const filename = "output.mml";
    fs.writeFileSync(filename, mml);
    console.error(`\nSaved to ${filename}`);
  });
});

req.on("error", e => { console.error("Request error:", e.message); process.exit(1); });
req.write(body);
req.end();
```

### CLI usage examples

```bash
# Set API key once
export ANTHROPIC_API_KEY=your_key_here

# Generate with a description
node generate_mml.js "upbeat action theme, C major, fast tempo, 16 bars"
node generate_mml.js "mysterious cave BGM, A minor, slow, eerie atmosphere"
node generate_mml.js "boss fight theme, D minor, fast and aggressive"
node generate_mml.js "title screen fanfare, G major, triumphant"

# Save output directly
node generate_mml.js "overworld theme" > my_music.mml
```

The MML output is printed to stdout and also saved to `output.mml`.
Paste the contents into the NDP editor on Windows to compile to `.ndp`.
