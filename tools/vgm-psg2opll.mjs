// Transcode a PSG VGM file into an MSX-Music (YM2413/OPLL) VGM file.
// Usage: node tools/vgm-psg2opll.mjs <input-psg.vgm> <output-opll.vgm>
import { readFileSync, writeFileSync } from "node:fs";
import { transcodePsgToOPLL } from "../public/vgm-opll.js";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error("Usage: node tools/vgm-psg2opll.mjs <input-psg.vgm> <output-opll.vgm>");
  process.exit(1);
}

const psg = readFileSync(input);
const opll = transcodePsgToOPLL(new Uint8Array(psg.buffer, psg.byteOffset, psg.byteLength));
writeFileSync(output, opll);
console.log(`Wrote ${output}: ${opll.length} bytes (OPLL VGM)`);
