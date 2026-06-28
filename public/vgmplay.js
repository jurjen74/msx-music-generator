// Decode a PSG (AY-3-8910) VGM file and play it back through Web Audio.
// This reads the *actual exported bytes* — register writes + waits — and
// reconstructs frequency/volume per channel, so it verifies the .vgm file
// itself rather than re-playing the MML. Mirrors the MMLPlayer API.

const SAMPLE_RATE = 44100;
const FINE = [0, 2, 4];
const COARSE = [1, 3, 5];
const VOL = [8, 9, 10];

// Walk the VGM command stream into timestamped register writes.
export function decodeVGM(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = dv.getUint32(0x08, true);
  let dataOffset = 0x40;
  if (version >= 0x150) {
    const rel = dv.getUint32(0x34, true);
    if (rel) dataOffset = 0x34 + rel;
  }
  const ayClock = dv.getUint32(0x74, true) || 1789772;
  const loopRel = dv.getUint32(0x1c, true);
  const loopOffset = loopRel ? 0x1c + loopRel : 0;

  const events = []; // { t: sampleTime, reg, val }
  let i = dataOffset;
  let sample = 0;
  let loopSample = null;

  while (i < u8.length) {
    if (loopOffset && i === loopOffset && loopSample === null) loopSample = sample;
    const cmd = u8[i++];
    if (cmd === 0xa0) {
      const r = u8[i++];
      const v = u8[i++];
      events.push({ t: sample, reg: r, val: v });
    } else if (cmd === 0x62) {
      sample += 735; // 1/60 s
    } else if (cmd === 0x63) {
      sample += 882; // 1/50 s
    } else if (cmd === 0x61) {
      sample += u8[i] | (u8[i + 1] << 8);
      i += 2;
    } else if (cmd >= 0x70 && cmd <= 0x7f) {
      sample += (cmd & 0x0f) + 1;
    } else if (cmd === 0x66) {
      break;
    } else if (cmd >= 0x51 && cmd <= 0x5f) {
      i += 2; // other chip writes (defensive — our files don't emit these)
    } else if (cmd >= 0xa1 && cmd <= 0xbf) {
      i += 2;
    } else if (cmd === 0x4f || cmd === 0x50) {
      i += 1;
    } else {
      break; // unknown — stop safely
    }
  }
  return { events, totalSamples: sample, ayClock, loopSample: loopSample ?? 0 };
}

export class VGMPlayer {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.timers = [];
    this.playing = false;
    this.onEnd = null;
    this.onLoop = null;
  }

  play(u8, loop = true) {
    this.stop();
    const { events, totalSamples, ayClock } = decodeVGM(u8);
    if (totalSamples <= 0) return 0;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.playing = true;

    const t0 = this.ctx.currentTime + 0.08;
    const regs = new Array(16).fill(0);
    const osc = [];
    const gains = [];
    for (let c = 0; c < 3; c++) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "square";
      o.frequency.value = 440;
      g.gain.value = 0;
      o.connect(g).connect(this.master);
      o.start(t0);
      osc.push(o);
      gains.push(g);
    }
    this._osc = osc;

    const last = [
      { f: -1, g: -1 },
      { f: -1, g: -1 },
      { f: -1, g: -1 },
    ];
    const applyChannel = (c, when) => {
      const period = regs[FINE[c]] | ((regs[COARSE[c]] & 0x0f) << 8);
      const freq = period > 0 ? ayClock / (16 * period) : 0;
      const vol = regs[VOL[c]] & 0x0f;
      const toneDisabled = (regs[7] >> c) & 1; // mixer bit set = tone off
      const gainVal = toneDisabled || vol === 0 || freq <= 0 ? 0 : (vol / 15) * 0.16;
      if (freq > 0 && freq !== last[c].f) {
        osc[c].frequency.setValueAtTime(freq, Math.max(when, this.ctx.currentTime));
        last[c].f = freq;
      }
      if (gainVal !== last[c].g) {
        gains[c].gain.setValueAtTime(gainVal, Math.max(when, this.ctx.currentTime));
        last[c].g = gainVal;
      }
    };

    const cycle = totalSamples / SAMPLE_RATE;
    let cycleIndex = 0;
    const scheduleCycle = () => {
      if (!this.playing) return;
      const base = t0 + cycleIndex * cycle;
      for (const ev of events) {
        regs[ev.reg] = ev.val;
        const when = base + ev.t / SAMPLE_RATE;
        for (let c = 0; c < 3; c++) applyChannel(c, when);
      }
      cycleIndex++;
      if (loop) {
        if (cycleIndex > 1 && this.onLoop) this.onLoop(cycleIndex);
        this.timers.push(setTimeout(scheduleCycle, cycle * 1000 - 60));
      } else {
        this.timers.push(
          setTimeout(() => {
            if (this.onEnd) this.onEnd();
            this.stop();
          }, cycle * 1000 + 200)
        );
      }
    };
    scheduleCycle();
    return cycle;
  }

  stop() {
    this.playing = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this._osc) {
      this._osc.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      });
      this._osc = null;
    }
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      this.master = null;
      ctx.close().catch(() => {});
    }
  }
}
