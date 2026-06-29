// Zero-dependency Node server for the MSX MML generator.
// - Serves the static UI from ./public
// - Proxies music generation to the Claude API (keeps the API key server-side)
//
// Run:  ANTHROPIC_API_KEY=sk-... node server.js
//   or: put the key in a .env file (see .env.example) and run: node server.js

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Load .env if present (Node 20.12+). Harmless if the file is missing.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  /* no .env — rely on the environment */
}

const PORT = process.env.PORT || 5173;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MSX_MODEL || "claude-sonnet-4-6";
// Optional: path to MSXgl's MSXzip binary. When set, enables /api/lvgm
// (VGM -> compact lVGM conversion) and the "Download .lvgm" button in the UI.
const MSXZIP = process.env.MSXZIP;
const LVGM_ENABLED = Boolean(MSXZIP && fs.existsSync(MSXZIP));

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function buildSystemPrompt(p) {
  const fm = p.chip === "MSX-Music";
  const chipDesc = fm
    ? "OPLL / FM-PAC, 9 FM channels"
    : "AY-3-8910, 3 square-wave channels A/B/C";
  // Drums (Channel D) are only supported on MSX-Music (YM2413 rhythm section).
  const drumStep = fm
    ? `\n6. DRUMS (Channel D). Lay down a groove on the rhythm section: kick on beats 1 & 3, snare on 2 & 4, hi-hats on the off-beats/8ths. Keep it tasteful and the same length as the other channels.`
    : "";
  const drumLine = fm ? `\nCHANNEL_D: <drum mml>` : "";
  const drumRule = fm
    ? `\n- Channel D = drums: k=kick, s=snare, h=hi-hat, t=tom, c=cymbal; r=rest; use lengths and [pattern]N loops like the other channels; group letters for simultaneous hits (e.g. "kh8" = kick+hi-hat). Example groove: [k8 h8 s8 h8]4`
    : "";
  return `You are an expert MSX chiptune composer in the tradition of classic Konami and Falcom MSX soundtracks, writing MML (Music Macro Language) for the ${p.chip} chip (${chipDesc}).

Compose ${p.bars} of looping game music in ${p.key} at a ${p.tempo} tempo. Style/mood: "${p.prompt || p.style}".

Follow this process IN YOUR HEAD — do NOT write any of it down (no chord charts, no bar counting, no commentary):
1. CHORDS first. Choose a strong progression in ${p.key} that fits the mood (e.g. i–VI–III–VII or i–iv–V for minor drama; I–V–vi–IV or I–IV–V for bright/heroic). Develop it over the piece; it's the backbone of all three channels.
2. BASS (Channel C). Drive the harmony: play roots and fifths of each chord with a rhythmic, pulsing or walking pattern (mix 8th/16th notes, the occasional run or octave jump). Avoid plain whole notes.
3. HARMONY (Channel B). Reinforce the chords with chord tones. Prefer ARPEGGIOS — fast 16th-note chord tones like "o4 c16 e16 g16 e16" — for that classic shimmering chiptune texture, or held thirds/sixths for softer moods.
4. MELODY (Channel A). Write a MEMORABLE, singable tune built on a short recurring MOTIF. Give it shape: clear rise-and-fall contour, phrasing (use rests to breathe), call-and-response, and rhythmic variety (mix 4/8/16 lengths, dotted notes, ties, syncopation). Avoid aimless up-and-down scale runs.
5. STRUCTURE. Develop across sections (e.g. an A theme, a contrasting B, then back to A) while keeping a recurring hook so it feels cohesive and loops seamlessly.${drumStep}

Aim for tension and release and a hook a player would remember. Make the parts complement each other (consonant on strong beats, no muddy clashes).

Your ENTIRE response must be ONLY the lines below, starting immediately with "CHANNEL_A:". No preamble, no planning, no explanations, no markdown — nothing before or after:

CHANNEL_A: <mml>
CHANNEL_B: <mml>
CHANNEL_C: <mml>${drumLine}
TEMPO: <bpm number>
NOTE: <one sentence describing the piece>

MML syntax rules:
- Notes: c d e f g a b (lowercase), # for sharp, - for flat
- Octave: o1-o8 prefix (e.g. o5c). Use o4-o6 for melody, o3-o5 for harmony, o2-o3 for bass.
- Length after note: 1=whole 2=half 4=quarter 8=eighth 16=sixteenth (e.g. c4 c8). Dotted with a trailing dot (c4.)
- Rest: r (e.g. r4) — use rests for phrasing, don't fill every beat
- Octave shift: > (up) < (down)
- Tie: & (c4&c8) for held/longer notes
- Volume: v1-v15 — use it for dynamics and accents (e.g. louder on downbeats, softer harmony than melody)
- Loop: [pattern]N to repeat a figure compactly
- Channel A = melody, Channel B = harmony/arpeggios, Channel C = bass${drumRule}
- CRITICAL: all channels MUST have exactly the same total duration (sum of note+rest lengths) so they stay in sync and loop seamlessly. Count carefully and double-check before answering.`;
}

function parseModelText(text) {
  const parsed = {};
  text.split("\n").forEach((line) => {
    const m = line.match(/^(CHANNEL_[ABCD]|TEMPO|NOTE):\s*(.+)/);
    if (m) parsed[m[1]] = m[2].trim();
  });
  return parsed;
}

async function generate(params) {
  // Scale the output budget with the requested length so long, through-composed
  // pieces aren't truncated. ~120 tokens per bar of 3-channel MML, clamped.
  const barsNum = parseInt(params.bars, 10) || 16;
  const maxTokens = Math.min(8000, Math.max(2500, barsNum * 150));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: buildSystemPrompt(params),
      messages: [{ role: "user", content: "Generate the MML now." }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `API error ${res.status}`);
  }

  const text = data.content?.find((b) => b.type === "text")?.text || "";
  const parsed = parseModelText(text);
  if (!parsed.CHANNEL_A) {
    throw new Error("Could not parse model output. Raw:\n" + text.slice(0, 400));
  }

  const bpm = parsed.TEMPO || "120";
  const channels = {
    A: parsed.CHANNEL_A,
    B: parsed.CHANNEL_B || "",
    C: parsed.CHANNEL_C || "",
  };
  if (parsed.CHANNEL_D) channels.D = parsed.CHANNEL_D;
  const drumLine = channels.D ? `\n\n; Channel D — Drums (MSX-Music rhythm)\nD: ${channels.D}` : "";
  const mml = `; MSX MML — ${params.chip} | ${params.style} | ${params.key} | ${bpm} BPM | ${params.bars}
; Loops seamlessly. Generated by Claude (${MODEL}).

t${bpm}

; Channel A — Melody
A: ${channels.A}

; Channel B — Harmony
B: ${channels.B}

; Channel C — Bass / rhythm
C: ${channels.C}${drumLine}`;

  return { channels, tempo: Number(bpm), note: parsed.NOTE || "", mml, raw: text };
}

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  });
}

// Convert VGM bytes to lVGM by shelling out to MSXgl's MSXzip. Returns a Buffer.
function vgmToLVGM(vgmBuf, freq) {
  const stamp = `msxmml-${process.pid}-${Date.now()}`;
  const inPath = path.join(os.tmpdir(), `${stamp}.vgm`);
  const outPath = path.join(os.tmpdir(), `${stamp}.lvgm`);
  try {
    fs.writeFileSync(inPath, vgmBuf);
    const r = spawnSync(
      MSXZIP,
      [inPath, "-lVGM", "--freq", freq === "50" ? "50" : "60", "-bin", "-o", outPath],
      { encoding: "buffer" }
    );
    if (r.status !== 0 || !fs.existsSync(outPath)) {
      const msg = (r.stderr && r.stderr.toString()) || `MSXzip exited with code ${r.status}`;
      throw new Error(msg.trim());
    }
    return fs.readFileSync(outPath);
  } finally {
    for (const p of [inPath, outPath]) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

const server = http.createServer((req, res) => {
  // Lets the UI know which optional features are available.
  if (req.method === "GET" && req.url === "/api/config") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ lvgm: LVGM_ENABLED }));
    return;
  }

  // Optional: convert posted VGM bytes to compact lVGM (needs MSXZIP configured).
  if (req.method === "POST" && req.url.split("?")[0] === "/api/lvgm") {
    if (!LVGM_ENABLED) {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "lVGM is not enabled on the server. Set MSXZIP to your MSXgl MSXzip binary. See .env.example." }));
      return;
    }
    const freq = new URL(req.url, "http://x").searchParams.get("freq") || "60";
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const lvgm = vgmToLVGM(Buffer.concat(chunks), freq);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(lvgm);
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "lVGM conversion failed: " + e.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate") {
    if (!API_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set on the server. See .env.example." }));
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const params = JSON.parse(body || "{}");
        const result = await generate(params);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`MSX MML generator running at http://localhost:${PORT}`);
  if (!API_KEY) {
    console.log("WARNING: ANTHROPIC_API_KEY is not set — generation will fail until you set it.");
  }
  console.log(LVGM_ENABLED
    ? `lVGM export enabled (MSXzip: ${MSXZIP})`
    : "lVGM export disabled (set MSXZIP to enable the Download .lvgm button).");
});
