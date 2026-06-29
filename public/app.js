import { MMLPlayer, parseChannel } from "./player.js";
import { buildVGM } from "./vgm.js";
import { VGMPlayer } from "./vgmplay.js";
import { buildOPLLfromMML, OPLL_INSTRUMENTS, DEFAULT_INSTRUMENTS } from "./vgm-opll.js";

const STYLES = [
  "Action / battle", "Adventure / exploration", "Mysterious / cave",
  "Cheerful / overworld", "Boss fight", "Title screen", "Game over", "Fanfare / victory",
];
const KEYS = ["C major", "A minor", "G major", "D minor", "F major", "E minor"];

const $ = (id) => document.getElementById(id);
const player = new MMLPlayer();
const vgmPlayer = new VGMPlayer();
let current = null; // { channels, tempo, note, mml }

// Populate selects
$("style").innerHTML = STYLES.map((s) => `<option>${s}</option>`).join("");
$("key").innerHTML = KEYS.map((k) => `<option>${k}</option>`).join("");

// FM instrument pickers (OPLL built-in voices 1..15)
const instOptions = OPLL_INSTRUMENTS.map((n, i) => (i === 0 ? "" : `<option value="${i}">${n}</option>`)).join("");
["instA", "instB", "instC"].forEach((id, c) => {
  $(id).innerHTML = instOptions;
  $(id).value = String(DEFAULT_INSTRUMENTS[c]);
});

function isMSXMusic() {
  return $("chip").value === "MSX-Music";
}
function getInstruments() {
  return [Number($("instA").value), Number($("instB").value), Number($("instC").value)];
}
function updateChipUI() {
  $("instRow").classList.toggle("hidden", !isMSXMusic());
}
$("chip").addEventListener("change", updateChipUI);
updateChipUI();

// Build the right VGM bytes for the currently selected chip.
function vgmBytes() {
  return isMSXMusic()
    ? buildOPLLfromMML(current.channels, current.tempo, true, getInstruments())
    : buildVGM(current.channels, current.tempo, true);
}

function setError(msg) {
  const el = $("error");
  if (!msg) return el.classList.add("hidden");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function setPlaying(on, label) {
  $("play").disabled = on;
  $("playVgm").disabled = on;
  $("stop").disabled = !on;
  const chip = $("loopState");
  chip.textContent = on ? `${label} — looping…` : "looping…";
  chip.classList.toggle("hidden", !on);
}

function stopAll() {
  player.stop();
  vgmPlayer.stop();
  setPlaying(false);
}

async function generate() {
  setError("");
  stopAll();
  const btn = $("generate");
  btn.disabled = true;
  btn.textContent = "Composing…";

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: $("prompt").value.trim(),
        chip: $("chip").value,
        tempo: $("tempo").value,
        style: $("style").value,
        key: $("key").value,
        bars: $("bars").value,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Error ${res.status}`);

    current = data;
    $("mml").textContent = data.mml;
    $("note").textContent = data.note || "";
    showSyncInfo();
    $("result").classList.remove("hidden");
  } catch (e) {
    setError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate MML music";
  }
}

// Show each channel's playback length and warn if they're unequal (which makes
// long pieces loop with silent gaps). Helps spot desynced long generations.
function showSyncInfo() {
  if (!current) return;
  const dur = (k) => parseChannel(current.channels[k], current.tempo).reduce((s, n) => s + n.dur, 0);
  const a = dur("A"), b = dur("B"), c = dur("C");
  const max = Math.max(a, b, c), min = Math.min(a, b, c);
  const fmt = `A ${a.toFixed(1)}s · B ${b.toFixed(1)}s · C ${c.toFixed(1)}s · loop ${max.toFixed(1)}s`;
  const el = $("syncInfo");
  if (max - min < 0.1) {
    el.textContent = `Channels in sync ✓  (${fmt})`;
    el.style.color = "";
  } else {
    el.textContent = `⚠ Channels differ by ${(max - min).toFixed(1)}s — the loop uses the longest channel, so shorter ones fall silent before it repeats. Regenerate or pick fewer bars for a tighter loop.  (${fmt})`;
    el.style.color = "var(--err)";
  }
}

function play() {
  if (!current) return;
  stopAll();
  player.onEnd = () => setPlaying(false);
  const cycle = player.play(current.channels, current.tempo, true);
  if (cycle > 0) setPlaying(true, "MML preview");
  else setError("Nothing playable was parsed from this MML.");
}

function playVgm() {
  if (!current) return;
  stopAll();
  // The in-browser VGM player emulates the PSG only. FM (MSX-Music) can't be
  // auditioned here — use Preview (MML) to hear the notes, or play the exported
  // .vgm in MSXgl / openMSX (with FM-PAC) for the real FM timbre.
  if (isMSXMusic()) {
    setError("MSX-Music (FM) can't be previewed in-browser. Use ▶ Preview (MML) to audition, then Download .vgm and play it in MSXgl / openMSX.");
    return;
  }
  try {
    const bytes = buildVGM(current.channels, current.tempo, true);
    vgmPlayer.onEnd = () => setPlaying(false);
    const cycle = vgmPlayer.play(bytes, true);
    if (cycle > 0) setPlaying(true, "exported .vgm");
    else setError("The exported VGM had no playable data.");
  } catch (e) {
    setError("VGM playback failed: " + e.message);
  }
}

function copy() {
  if (!current) return;
  navigator.clipboard.writeText(current.mml).then(() => {
    const b = $("copy");
    const old = b.textContent;
    b.textContent = "Copied!";
    setTimeout(() => (b.textContent = old), 1500);
  });
}

function baseName() {
  const chip = isMSXMusic() ? "fm" : "psg";
  const stem = `${$("style").value} ${$("key").value}`.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "msx_music";
  return `${stem}_${chip}`;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function download() {
  if (!current) return;
  saveBlob(new Blob([current.mml], { type: "text/plain" }), `${baseName()}.mml`);
}

function downloadVgm() {
  if (!current) return;
  try {
    saveBlob(new Blob([vgmBytes()], { type: "application/octet-stream" }), `${baseName()}.vgm`);
  } catch (e) {
    setError("VGM export failed: " + e.message);
  }
}

// Optional: compact lVGM, converted server-side via MSXgl's MSXzip.
async function downloadLvgm() {
  if (!current) return;
  try {
    const res = await fetch("/api/lvgm?freq=60", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: vgmBytes(),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Error ${res.status}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    saveBlob(new Blob([buf], { type: "application/octet-stream" }), `${baseName()}.lvgm`);
  } catch (e) {
    setError("lVGM export failed: " + e.message);
  }
}

// Reveal the lVGM button only if the server has MSXzip configured.
fetch("/api/config")
  .then((r) => r.json())
  .then((c) => { if (c.lvgm) $("downloadLvgm").classList.remove("hidden"); })
  .catch(() => {});

$("generate").addEventListener("click", generate);
$("play").addEventListener("click", play);
$("playVgm").addEventListener("click", playVgm);
$("stop").addEventListener("click", stopAll);
$("copy").addEventListener("click", copy);
$("download").addEventListener("click", download);
$("downloadVgm").addEventListener("click", downloadVgm);
$("downloadLvgm").addEventListener("click", downloadLvgm);
