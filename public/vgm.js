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

import { parseAlignedChannels, parseDrumChannel, loopPointSeconds, VIB_RATE, VIB_DEPTH } from "./player.js";

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

// Per-note volume decay so PSG notes "pluck" instead of droning: drop from the
// note volume to a sustain (~half) over ~8 frames, then hold.
function decayVol(vol, age) {
  if (vol <= 0) return 0;
  const sustain = Math.max(1, Math.round(vol * 0.5));
  const D = 8;
  const v = vol - (vol - sustain) * Math.min(1, age / D);
  return Math.max(0, Math.min(15, Math.round(v)));
}

// Render one channel's events to per-frame { period, vol, age } (age = frames
// since the note started, for the decay envelope).
function channelFrames(events, frameCount) {
  const frames = Array.from({ length: frameCount }, () => ({ period: 0, vol: 0, age: 0 }));
  let t = 0;
  for (const ev of events) {
    const startF = Math.round(t * RATE);
    const endF = Math.round((t + ev.dur) * RATE);
    if (ev.midi != null) {
      const base = midiToPeriod(ev.midi);
      const vol = Math.max(0, Math.min(15, ev.vol));
      for (let f = startF; f < endF && f < frameCount; f++) {
        const age = f - startF;
        let period = base;
        if (ev.vib && age > 3) {
          const mod = 1 + VIB_DEPTH * Math.sin((2 * Math.PI * VIB_RATE * age) / RATE);
          period = Math.max(1, Math.min(4095, Math.round(base * mod)));
        }
        frames[f] = { period, vol, age };
      }
    }
    t += ev.dur;
  }
  return frames;
}

// PSG drum voices on the noise generator: { noise period (0-31), length, volume }.
function drumParams(bits) {
  if (bits & 0x10) return { np: 0x14, len: 8, vol: 15 }; // kick
  if (bits & 0x08) return { np: 0x08, len: 6, vol: 13 }; // snare
  if (bits & 0x04) return { np: 0x10, len: 7, vol: 13 }; // tom
  if (bits & 0x02) return { np: 0x03, len: 12, vol: 10 }; // cymbal
  return { np: 0x02, len: 3, vol: 9 }; // hi-hat
}

// Build a per-frame drum overlay (noise hits with a decay tail) for channel C.
function drumOverlay(drumMML, bpm, frameCount) {
  const overlay = new Array(frameCount).fill(null);
  let t = 0;
  for (const ev of parseDrumChannel(drumMML, bpm)) {
    const f0 = Math.round(t * RATE);
    if (ev.bits) {
      const d = drumParams(ev.bits);
      for (let i = 0; i < d.len && f0 + i < frameCount; i++) {
        overlay[f0 + i] = { np: d.np, vol: Math.max(0, Math.round(d.vol * (1 - i / d.len))) };
      }
    }
    t += ev.dur;
  }
  return overlay;
}

// channels: { A, B, C, D? } raw MML; bpm number; loop boolean.
// Returns a Uint8Array containing a complete .vgm file.
export function buildVGM(channels, bpm, loop = true) {
  const aligned = parseAlignedChannels(channels, bpm);
  const evs = [aligned.A, aligned.B, aligned.C];
  const cycle = Math.max(...evs.map((e) => e.reduce((s, n) => s + n.dur, 0)), 0);
  const frameCount = Math.max(1, Math.round(cycle * RATE));
  const chFrames = evs.map((e) => channelFrames(e, frameCount));
  // Drums (optional) overlay channel C via the noise generator.
  const drums = channels.D ? drumOverlay(channels.D, bpm, frameCount) : null;
  // Optional loop point ("/" marker): intro plays once, then loop from here.
  const loopFrame = Math.min(frameCount, Math.round(loopPointSeconds(channels, bpm) * RATE));

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

  const MIX_DEFAULT = 0x38; // tone A/B/C on, noise off
  const MIX_C_DRUM = 0x1c; // A/B tone on, C tone off + C noise on
  write(7, MIX_DEFAULT);

  let totalSamples = 0;
  let loopBytePos = 0; // data offset where the loop restarts (0 = whole track)
  for (let f = 0; f < frameCount; f++) {
    // At the loop point, force a full register re-write so the seam is clean.
    if (loopFrame > 0 && f === loopFrame) {
      loopBytePos = cmds.length;
      reg.fill(-1);
    }
    // Channels A and B: tonal with decay.
    for (let c = 0; c < 2; c++) {
      const { period, vol, age } = chFrames[c][f];
      write(REG_FINE[c], period & 0xff);
      write(REG_COARSE[c], (period >> 8) & 0x0f);
      write(REG_VOL[c], decayVol(vol, age));
    }
    // Channel C: a drum hit (noise) ducks the bass for its duration.
    const hit = drums && drums[f];
    if (hit) {
      write(7, MIX_C_DRUM);
      write(6, hit.np & 0x1f); // noise period
      write(REG_VOL[2], hit.vol & 0x0f);
    } else {
      write(7, MIX_DEFAULT);
      const { period, vol, age } = chFrames[2][f];
      write(REG_FINE[2], period & 0xff);
      write(REG_COARSE[2], (period >> 8) & 0x0f);
      write(REG_VOL[2], decayVol(vol, age));
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
    dv.setUint32(0x1c, HEADER_SIZE + loopBytePos - 0x1c, true); // loop offset
    dv.setUint32(0x20, totalSamples - loopFrame * SAMPLES_PER_FRAME, true); // loop # samples
  }
  dv.setUint32(0x24, RATE, true); // rate (Hz)
  dv.setUint32(0x34, HEADER_SIZE - 0x34, true); // VGM data offset (relative to 0x34)
  dv.setUint32(0x74, PSG_CLOCK, true); // AY8910 clock
  u8[0x78] = 0x00; // AY8910 chip type = AY-3-8910

  u8.set(cmds, HEADER_SIZE);
  return u8;
}
