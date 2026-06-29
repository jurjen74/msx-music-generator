// MML -> Web Audio playback, approximating the PSG (AY-3-8910) square-wave channels.
// Supports the subset our generator emits: notes a-g (#/+ sharp, - flat), o1-o8,
// > < octave shift, lengths 1/2/4/8/16 with dots, r rests, & ties, v1-v15, [..]N loops, l default length.

const NOTE_SEMITONE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Vibrato (the "~" command): pitch wobble shared by preview and exporters.
export const VIB_RATE = 6; // Hz
export const VIB_DEPTH = 0.018; // ±1.8% of the pitch (~⅓ semitone)

// Expand [pattern]N loops by resolving the innermost bracket first (handles nesting).
function expandLoops(s) {
  const re = /\[([^\[\]]*)\](\d*)/;
  let m;
  let guard = 0;
  while ((m = s.match(re)) && guard++ < 1000) {
    const count = m[2] ? parseInt(m[2], 10) : 2;
    s = s.slice(0, m.index) + m[1].repeat(count) + s.slice(m.index + m[0].length);
  }
  return s.replace(/[\[\]]/g, ""); // drop any stray brackets
}

// Parse one channel's MML into a list of { midi|null, dur(seconds), vol } events.
function parseChannel(mml, bpm) {
  const s = expandLoops((mml || "").toLowerCase());
  const quarter = 60 / bpm; // seconds per quarter note
  const events = [];
  let octave = 4;
  let defLen = 4;
  let vol = 11;
  let tieNext = false;
  let vib = false; // vibrato on/off for following notes ("~")
  let i = 0;

  const readInt = () => {
    let n = "";
    while (i < s.length && s[i] >= "0" && s[i] <= "9") n += s[i++];
    return n ? parseInt(n, 10) : null;
  };
  const readLength = () => {
    const len = readInt() ?? defLen;
    let factor = 1;
    let add = 0.5;
    while (s[i] === ".") {
      factor += add;
      add /= 2;
      i++;
    }
    return (4 / len) * quarter * factor;
  };

  while (i < s.length) {
    const c = s[i];
    if (c in NOTE_SEMITONE) {
      i++;
      let semi = NOTE_SEMITONE[c];
      while (s[i] === "#" || s[i] === "+") (semi++, i++);
      while (s[i] === "-") (semi--, i++);
      const dur = readLength();
      const midi = (octave + 1) * 12 + semi; // o4 c = MIDI 60 = C4
      const last = events[events.length - 1];
      if (tieNext && last && last.midi === midi) last.dur += dur;
      else events.push({ midi, dur, vol, vib });
      tieNext = false;
    } else if (c === "r") {
      i++;
      events.push({ midi: null, dur: readLength(), vol });
    } else if (c === "o") {
      i++;
      octave = readInt() ?? octave;
    } else if (c === ">") {
      i++;
      octave++;
    } else if (c === "<") {
      i++;
      octave--;
    } else if (c === "l") {
      i++;
      defLen = readInt() ?? defLen;
    } else if (c === "v") {
      i++;
      vol = readInt() ?? vol;
    } else if (c === "t") {
      i++;
      readInt(); // tempo is handled globally; skip inline t
    } else if (c === "&") {
      i++;
      tieNext = true;
    } else if (c === "~") {
      i++;
      const n = readInt();
      vib = n === null ? true : n > 0; // ~ or ~1+ = on, ~0 = off
    } else if (c === "/") {
      i++;
      events.push({ midi: null, dur: 0, loop: true }); // loop-start marker
    } else {
      i++; // skip whitespace / unknown
    }
  }
  return events;
}

// Seconds from the start to the loop marker "/" (intro length), or 0 if none.
// Uses the first channel that has a marker (A, then B, then C).
export function loopPointSeconds(channels, bpm) {
  for (const k of ["A", "B", "C"]) {
    const evs = parseChannel(channels[k] || "", bpm);
    let t = 0;
    for (const n of evs) {
      if (n.loop) return t;
      t += n.dur;
    }
  }
  return 0;
}

// Drum channel: bitmask matches the YM2413 rhythm register (0x0E) trigger bits.
export const DRUM_BITS = { k: 0x10, s: 0x08, t: 0x04, c: 0x02, h: 0x01 }; // kick snare tom cymbal hi-hat

// Parse a drum pattern into events { bits, dur }. Letters can be grouped for
// simultaneous hits (e.g. "kh8" = kick+hi-hat); "r" is a rest; "l" sets the
// default length; "[..]N" loops. bits === 0 means a rest.
export function parseDrumChannel(mml, bpm) {
  const s = expandLoops((mml || "").toLowerCase());
  const quarter = 60 / bpm;
  const events = [];
  let defLen = 8;
  let i = 0;
  const readLen = () => {
    let n = "";
    while (i < s.length && s[i] >= "0" && s[i] <= "9") n += s[i++];
    const len = n ? parseInt(n, 10) : defLen;
    let f = 1, add = 0.5;
    while (s[i] === ".") { f += add; add /= 2; i++; }
    return (4 / len) * quarter * f;
  };
  while (i < s.length) {
    const c = s[i];
    if (c in DRUM_BITS) {
      let bits = 0;
      while (i < s.length && s[i] in DRUM_BITS) { bits |= DRUM_BITS[s[i]]; i++; }
      events.push({ bits, dur: readLen() });
    } else if (c === "r") {
      i++;
      events.push({ bits: 0, dur: readLen() });
    } else if (c === "l") {
      i++;
      let n = "";
      while (i < s.length && s[i] >= "0" && s[i] <= "9") n += s[i++];
      if (n) defLen = parseInt(n, 10);
    } else {
      i++;
    }
  }
  return events;
}

// Drum onsets (bitmask per frame) over `frameCount` frames at `rate` fps,
// for driving the YM2413 rhythm register. Trimmed/looped to the given length.
export function drumOnsets(mml, bpm, frameCount, rate) {
  const events = parseDrumChannel(mml, bpm);
  const onsets = new Array(frameCount).fill(0);
  let t = 0;
  for (const ev of events) {
    const f = Math.round(t * rate);
    if (ev.bits && f < frameCount) onsets[f] |= ev.bits;
    t += ev.dur;
  }
  return onsets;
}

// Parse all three channels and trim them to a common length so the piece loops
// cleanly. Long AI generations often give the channels slightly different total
// durations; without this the loop runs to the longest channel and the shorter
// ones fall silent before it repeats. We trim to the shortest non-empty channel.
// Returns { A, B, C } event arrays. (Empty channels are left empty.)
export function parseAlignedChannels(channels, bpm) {
  const evs = {
    A: parseChannel(channels.A, bpm),
    B: parseChannel(channels.B, bpm),
    C: parseChannel(channels.C, bpm),
  };
  const total = (ev) => ev.reduce((s, n) => s + n.dur, 0);
  const totals = { A: total(evs.A), B: total(evs.B), C: total(evs.C) };
  const positive = Object.values(totals).filter((t) => t > 1e-6);
  if (positive.length === 0) return evs;
  const target = Math.min(...positive);

  for (const k of ["A", "B", "C"]) {
    if (totals[k] <= target + 1e-6) continue; // empty or already shortest
    const trimmed = [];
    let acc = 0;
    for (const n of evs[k]) {
      const remaining = target - acc;
      if (remaining <= 1e-6) break;
      if (n.dur <= remaining + 1e-6) { trimmed.push(n); acc += n.dur; }
      else { trimmed.push({ ...n, dur: remaining }); break; }
    }
    evs[k] = trimmed;
  }
  return evs;
}

export class MMLPlayer {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.timers = [];
    this.playing = false;
    this.onEnd = null;
    this.onLoop = null;
  }

  _scheduleNote(midi, vol, start, dur, vib = false) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;

    // Vibrato: a small pitch LFO that fades in shortly after the attack.
    if (vib && dur > 0.12) {
      const lfo = this.ctx.createOscillator();
      const ld = this.ctx.createGain();
      lfo.frequency.value = VIB_RATE;
      ld.gain.value = freq * VIB_DEPTH;
      lfo.connect(ld).connect(osc.frequency);
      lfo.start(start + 0.06);
      lfo.stop(start + dur + 0.02);
    }

    const peak = Math.max(0.02, (vol / 15) * 0.16);
    const a = 0.005; // tiny attack to avoid clicks
    const end = start + dur;
    // Decay to a sustain (~half) over ~0.13s so notes pluck instead of droning.
    const sustain = Math.max(0.0001, peak * 0.5);
    const decayEnd = Math.min(start + a + 0.13, end - 0.004);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + a);
    if (decayEnd > start + a) gain.gain.exponentialRampToValueAtTime(sustain, decayEnd);
    gain.gain.linearRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  _noise() {
    if (!this._noiseBuf) {
      const len = this.ctx.sampleRate * 0.4;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    return src;
  }

  // Approximate the YM2413 rhythm drums for preview. bits matches DRUM_BITS.
  _scheduleDrum(bits, t) {
    const env = (node, peak, dur) => {
      node.gain.setValueAtTime(peak, t);
      node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    };
    const tone = (f0, f1, peak, dur) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      env(g, peak, dur); o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    };
    const noise = (type, freq, peak, dur) => {
      const n = this._noise(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      f.type = type; f.frequency.value = freq;
      env(g, peak, dur); n.connect(f).connect(g).connect(this.master); n.start(t); n.stop(t + dur + 0.02);
    };
    if (bits & 0x10) tone(140, 50, 0.9, 0.18);       // kick
    if (bits & 0x08) { noise("bandpass", 1800, 0.5, 0.12); tone(330, 180, 0.2, 0.08); } // snare
    if (bits & 0x01) noise("highpass", 8000, 0.22, 0.04);  // hi-hat
    if (bits & 0x04) tone(220, 110, 0.6, 0.16);      // tom
    if (bits & 0x02) noise("highpass", 6000, 0.25, 0.4);   // cymbal
  }

  // channels: { A, B, C, D? } raw MML strings; bpm number; loop boolean
  play(channels, bpm, loop = true) {
    this.stop();
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.playing = true;

    const aligned = parseAlignedChannels(channels, bpm);
    const parsed = [aligned.A, aligned.B, aligned.C];
    let cycle = 0;
    for (const ev of parsed) {
      let t = 0;
      for (const n of ev) t += n.dur;
      cycle = Math.max(cycle, t);
    }
    if (cycle <= 0) {
      this.stop();
      return 0;
    }

    // Flatten notes to absolute start times within the cycle.
    const notes = [];
    for (const ev of parsed) {
      let t = 0;
      for (const n of ev) {
        if (n.midi != null) notes.push({ start: t, midi: n.midi, vol: n.vol, dur: n.dur, vib: n.vib });
        t += n.dur;
      }
    }
    // Drums (Channel D): onset times within the cycle.
    const drumHits = [];
    if (channels.D) {
      let t = 0;
      for (const e of parseDrumChannel(channels.D, bpm)) {
        if (e.bits && t < cycle - 1e-6) drumHits.push({ t, bits: e.bits });
        t += e.dur;
      }
    }

    // Optional loop point: intro (0..loopTime) plays once, then loop the body.
    const loopTime = Math.min(cycle, loopPointSeconds(channels, bpm));
    const bodyLen = Math.max(0.05, cycle - loopTime);

    const scheduleSegment = (base, fromTime) => {
      for (const n of notes)
        if (n.start >= fromTime - 1e-6) this._scheduleNote(n.midi, n.vol, base + (n.start - fromTime), n.dur, n.vib);
      for (const d of drumHits)
        if (d.t >= fromTime - 1e-6) this._scheduleDrum(d.bits, base + (d.t - fromTime));
    };

    let nextBase = this.ctx.currentTime + 0.08;
    let first = true;
    const scheduleNext = () => {
      if (!this.playing) return;
      const fromTime = first ? 0 : loopTime;
      const segLen = first ? cycle : bodyLen;
      scheduleSegment(nextBase, fromTime);
      nextBase += segLen;
      first = false;
      if (loop) {
        this.timers.push(setTimeout(scheduleNext, segLen * 1000 - 60));
      } else {
        this.timers.push(
          setTimeout(() => {
            if (this.onEnd) this.onEnd();
            this.stop();
          }, segLen * 1000 + 200)
        );
      }
    };
    scheduleNext();
    return cycle;
  }

  stop() {
    this.playing = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      this.master = null;
      ctx.close().catch(() => {});
    }
  }
}

export { parseChannel, expandLoops };
