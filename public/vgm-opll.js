// MSX-Music (YM2413 / OPLL) VGM support.
//
// The OPLL is an FM chip with 9 channels and 15 built-in instrument patches.
// VGM drives it with `0x51 RR VV` (write register RR = VV). We map our three
// voices (A melody / B harmony / C bass) onto OPLL channels 0/1/2.
//
// This module can:
//  - build an OPLL VGM from per-frame {freq, vol} channel data, and
//  - transcode an existing PSG VGM into an OPLL VGM (decode PSG notes, replay
//    them as FM), so PSG exports can be auditioned on MSX-Music.
//
// OPLL frequency: F-Number (9-bit) + Block (3-bit octave).
//   freq = fnum * (clock/72) / 2^(19 - block),  clock = 3579545 Hz.
// Register map (channel c = 0..8):
//   0x10+c : F-Number low 8 bits
//   0x20+c : bit0 = F-Num bit8, bits1-3 = block, bit4 = key-on, bit5 = sustain
//   0x30+c : bits4-7 = instrument (1-15 built-in), bits0-3 = attenuation (0=loud)

import { decodeVGM } from "./vgmplay.js";
import { parseChannel } from "./player.js";

// Built-in OPLL instrument names, indexed 1..15 (0 = user/custom patch).
export const OPLL_INSTRUMENTS = [
  "Custom", "Violin", "Guitar", "Piano", "Flute", "Clarinet", "Oboe",
  "Trumpet", "Organ", "Horn", "Synthesizer", "Harpsichord", "Vibraphone",
  "Synth Bass", "Acoustic Bass", "Electric Guitar",
];

const OPLL_CLOCK = 3579545;
const FSAMPLE = OPLL_CLOCK / 72; // ~49716 Hz
const RATE = 60;
const SAMPLES_PER_FRAME = 735;
const HEADER_SIZE = 0x100;

// Built-in OPLL instruments: 1 Violin, 2 Guitar, 3 Piano, 4 Flute, 5 Clarinet,
// 6 Oboe, 7 Trumpet, 8 Organ, 9 Horn, 10 Synth, 11 Harpsichord, 12 Vibraphone,
// 13 Synth Bass, 14 Acoustic Bass, 15 Electric Guitar.
export const DEFAULT_INSTRUMENTS = [12, 8, 14]; // melody=Vibraphone, harmony=Organ, bass=Acoustic Bass

function freqToFnumBlock(freq) {
  for (let block = 0; block <= 7; block++) {
    const fnum = Math.round((freq * Math.pow(2, 19 - block)) / FSAMPLE);
    if (fnum < 512) return { fnum: Math.max(0, fnum), block };
  }
  return { fnum: 511, block: 7 };
}

// Decode a PSG VGM into per-channel, per-frame { freq, vol } at 60 Hz.
export function psgFramesFromVGM(u8) {
  const { events, totalSamples, ayClock } = decodeVGM(u8);
  const FINE = [0, 2, 4];
  const COARSE = [1, 3, 5];
  const VOL = [8, 9, 10];
  const frameCount = Math.max(1, Math.round(totalSamples / SAMPLES_PER_FRAME));
  const regs = new Array(16).fill(0);
  const frames = [[], [], []];
  let ev = 0;
  for (let f = 0; f < frameCount; f++) {
    const cutoff = (f + 1) * SAMPLES_PER_FRAME;
    while (ev < events.length && events[ev].t < cutoff) {
      regs[events[ev].reg] = events[ev].val;
      ev++;
    }
    for (let c = 0; c < 3; c++) {
      const period = regs[FINE[c]] | ((regs[COARSE[c]] & 0x0f) << 8);
      const freq = period > 0 ? ayClock / (16 * period) : 0;
      const vol = regs[VOL[c]] & 0x0f;
      const toneOff = (regs[7] >> c) & 1;
      frames[c].push(toneOff ? { freq: 0, vol: 0 } : { freq, vol });
    }
  }
  return frames;
}

// Build an OPLL VGM (Uint8Array) from per-channel per-frame { freq, vol } data.
export function buildOPLLfromFrames(frames, loop = true, instruments = DEFAULT_INSTRUMENTS) {
  const frameCount = Math.max(...frames.map((f) => f.length), 1);
  const cmds = [];
  const write = (r, v) => cmds.push(0x51, r & 0xff, v & 0xff);

  // Per-channel playback state.
  const st = [0, 1, 2].map(() => ({ on: false, fnum: 0, block: 0, atten: -1, inst: -1 }));

  let totalSamples = 0;
  for (let f = 0; f < frameCount; f++) {
    for (let c = 0; c < 3; c++) {
      const cell = frames[c][f] || { freq: 0, vol: 0 };
      const on = cell.vol > 0 && cell.freq > 0;
      const s = st[c];
      if (on) {
        const { fnum, block } = freqToFnumBlock(cell.freq);
        const atten = Math.max(0, Math.min(15, 15 - cell.vol));
        const inst = instruments[c];
        const newNote = !s.on || fnum !== s.fnum || block !== s.block;
        if (newNote) {
          if (s.on) write(0x20 + c, (s.block << 1) | ((s.fnum >> 8) & 1)); // key-off to retrigger
          write(0x10 + c, fnum & 0xff);
          write(0x20 + c, 0x10 | (block << 1) | ((fnum >> 8) & 1)); // key-on
        }
        if (newNote || atten !== s.atten || inst !== s.inst) {
          write(0x30 + c, (inst << 4) | atten);
        }
        s.on = true;
        s.fnum = fnum;
        s.block = block;
        s.atten = atten;
        s.inst = inst;
      } else if (s.on) {
        write(0x20 + c, (s.block << 1) | ((s.fnum >> 8) & 1)); // key-off
        s.on = false;
      }
    }
    cmds.push(0x62); // wait one frame
    totalSamples += SAMPLES_PER_FRAME;
  }
  cmds.push(0x66); // end

  const total = HEADER_SIZE + cmds.length;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const out = new Uint8Array(buf);
  out.set([0x56, 0x67, 0x6d, 0x20], 0x00); // "Vgm "
  dv.setUint32(0x04, total - 4, true);
  dv.setUint32(0x08, 0x00000151, true); // version 1.51
  dv.setUint32(0x10, OPLL_CLOCK, true); // YM2413 clock
  dv.setUint32(0x18, totalSamples, true);
  if (loop) {
    dv.setUint32(0x1c, HEADER_SIZE - 0x1c, true);
    dv.setUint32(0x20, totalSamples, true);
  }
  dv.setUint32(0x24, RATE, true);
  dv.setUint32(0x34, HEADER_SIZE - 0x34, true);
  out.set(cmds, HEADER_SIZE);
  return out;
}

// Convenience: PSG VGM bytes -> OPLL VGM bytes.
export function transcodePsgToOPLL(u8, loop = true, instruments = DEFAULT_INSTRUMENTS) {
  return buildOPLLfromFrames(psgFramesFromVGM(u8), loop, instruments);
}

// Render MML channels into per-channel, per-frame { freq, vol } at 60 Hz.
export function mmlToFrames(channels, bpm) {
  const evs = ["A", "B", "C"].map((k) => parseChannel(channels[k], bpm));
  const cycle = Math.max(...evs.map((e) => e.reduce((s, n) => s + n.dur, 0)), 0);
  const frameCount = Math.max(1, Math.round(cycle * RATE));
  return evs.map((events) => {
    const frames = Array.from({ length: frameCount }, () => ({ freq: 0, vol: 0 }));
    let t = 0;
    for (const ev of events) {
      const startF = Math.round(t * RATE);
      const endF = Math.round((t + ev.dur) * RATE);
      const cell =
        ev.midi != null
          ? { freq: 440 * Math.pow(2, (ev.midi - 69) / 12), vol: Math.max(0, Math.min(15, ev.vol)) }
          : { freq: 0, vol: 0 };
      for (let f = startF; f < endF && f < frameCount; f++) frames[f] = cell;
      t += ev.dur;
    }
    return frames;
  });
}

// Build an OPLL (MSX-Music) VGM directly from MML channels.
export function buildOPLLfromMML(channels, bpm, loop = true, instruments = DEFAULT_INSTRUMENTS) {
  return buildOPLLfromFrames(mmlToFrames(channels, bpm), loop, instruments);
}
