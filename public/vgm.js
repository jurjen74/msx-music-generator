// MML -> standard VGM (AY-3-8910 / MSX PSG) export.
//
// Reuses the same parseChannel() the browser preview uses, then renders the
// timed note events onto a 60Hz frame grid and encodes them as VGM commands:
//   0xA0 RR VV  = write PSG register RR = VV
//   0x62        = wait one 1/60s frame (735 samples @ 44100)
//   0x66        = end of data
// The result plays directly on MSXgl's vgm_player (VGM_USE_PSG), and can be
// shrunk to lVGM with MSXgl's MSXzip tool.
//
// VGM spec: https://vgmrips.net/wiki/VGM_Specification

import { parseChannel } from "./player.js";

const PSG_CLOCK = 1789772; // MSX PSG: 3.579545 MHz / 2
const RATE = 60; // NTSC frames per second
const SAMPLES_PER_FRAME = 735; // 44100 / 60
const HEADER_SIZE = 0x100;

const REG_FINE = [0, 2, 4]; // tone period low byte, channels A/B/C
const REG_COARSE = [1, 3, 5]; // tone period high nibble
const REG_VOL = [8, 9, 10]; // channel volume

function midiToPeriod(midi) {
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const period = Math.round(PSG_CLOCK / (16 * freq));
  return Math.max(1, Math.min(4095, period));
}

// Render one channel's note events onto a per-frame array of { period, vol }.
function channelFrames(events, frameCount) {
  const frames = Array.from({ length: frameCount }, () => ({ period: 0, vol: 0 }));
  let t = 0;
  for (const ev of events) {
    const startF = Math.round(t * RATE);
    const endF = Math.round((t + ev.dur) * RATE);
    let state = { period: 0, vol: 0 };
    if (ev.midi != null) {
      state = { period: midiToPeriod(ev.midi), vol: Math.max(0, Math.min(15, ev.vol)) };
    }
    for (let f = startF; f < endF && f < frameCount; f++) frames[f] = state;
    t += ev.dur;
  }
  return frames;
}

// channels: { A, B, C } raw MML; bpm number; loop boolean.
// Returns a Uint8Array containing a complete .vgm file.
export function buildVGM(channels, bpm, loop = true) {
  const evs = ["A", "B", "C"].map((k) => parseChannel(channels[k], bpm));
  const cycle = Math.max(...evs.map((e) => e.reduce((s, n) => s + n.dur, 0)), 0);
  const frameCount = Math.max(1, Math.round(cycle * RATE));
  const chFrames = evs.map((e) => channelFrames(e, frameCount));

  // Build the command stream, only emitting register writes that changed.
  const cmds = [];
  const reg = new Array(16).fill(-1);
  const write = (r, v) => {
    v &= 0xff;
    if (reg[r] !== v) {
      reg[r] = v;
      cmds.push(0xa0, r, v);
    }
  };

  write(7, 0x38); // mixer: tone on A/B/C (bits 0-2 = 0), noise off (bits 3-5 = 1)

  let totalSamples = 0;
  for (let f = 0; f < frameCount; f++) {
    for (let c = 0; c < 3; c++) {
      const { period, vol } = chFrames[c][f];
      write(REG_FINE[c], period & 0xff);
      write(REG_COARSE[c], (period >> 8) & 0x0f);
      write(REG_VOL[c], vol & 0x0f);
    }
    cmds.push(0x62); // wait one frame
    totalSamples += SAMPLES_PER_FRAME;
  }
  cmds.push(0x66); // end of data

  // Assemble header + data.
  const total = HEADER_SIZE + cmds.length;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8.set([0x56, 0x67, 0x6d, 0x20], 0x00); // "Vgm "
  dv.setUint32(0x04, total - 4, true); // EOF offset (relative to 0x04)
  dv.setUint32(0x08, 0x00000151, true); // version 1.51 (AY8910 support)
  dv.setUint32(0x18, totalSamples, true); // total # samples
  if (loop) {
    dv.setUint32(0x1c, HEADER_SIZE - 0x1c, true); // loop offset -> data start
    dv.setUint32(0x20, totalSamples, true); // loop # samples
  }
  dv.setUint32(0x24, RATE, true); // rate (Hz)
  dv.setUint32(0x34, HEADER_SIZE - 0x34, true); // VGM data offset (relative to 0x34)
  dv.setUint32(0x74, PSG_CLOCK, true); // AY8910 clock
  u8[0x78] = 0x00; // AY8910 chip type = AY-3-8910

  u8.set(cmds, HEADER_SIZE);
  return u8;
}
