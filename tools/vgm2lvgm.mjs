// Convert a VGM file to MSX-optimized lVGM, using MSXgl's MSXzip tool.
// lVGM is a heavily compressed, MSX-tailored VGM (typically 75-85% smaller),
// played by MSXgl's vgm/lvgm_player. We don't reimplement the encoder — we call
// MSXgl's official, correct converter.
//
// Usage:
//   MSXZIP=/path/to/MSXgl/tools/MSXtk/bin/MSXzip \
//     node tools/vgm2lvgm.mjs <in.vgm> <out.h> [arrayName] [--freq 50|60]
//
// Output extension decides the format: .h => C array (default), .bin/.lvgm => binary.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: MSXZIP=/path/to/MSXzip node tools/vgm2lvgm.mjs <in.vgm> <out.h> [arrayName] [--freq 50|60]");
  process.exit(1);
}

const msxzip = process.env.MSXZIP;
if (!msxzip || !existsSync(msxzip)) {
  console.error(
    "MSXzip not found. Set MSXZIP to the binary in your MSXgl install, e.g.\n" +
      "  export MSXZIP=~/Repositories/MSXgl-1.4.1/tools/MSXtk/bin/MSXzip\n" +
      "(use MSXzip.exe on Windows)."
  );
  process.exit(1);
}

// Parse optional flags
let arrayName = null;
let freq = "60";
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--freq") freq = rest[++i];
  else if (!arrayName) arrayName = rest[i];
}

const isBinary = /\.(bin|lvgm|lvm)$/i.test(output);
const args = [input, "-lVGM", "--freq", freq, isBinary ? "-bin" : "-c", "-o", output];
if (!isBinary && arrayName) args.push("-t", arrayName);

const r = spawnSync(msxzip, args, { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`Wrote ${output} (lVGM${isBinary ? ", binary" : `, C array${arrayName ? " " + arrayName : ""}`}, ${freq}Hz)`);
