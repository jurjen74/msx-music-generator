// MML -> Web Audio playback, approximating the PSG (AY-3-8910) square-wave channels.
// Supports the subset our generator emits: notes a-g (#/+ sharp, - flat), o1-o8,
// > < octave shift, lengths 1/2/4/8/16 with dots, r rests, & ties, v1-v15, [..]N loops, l default length.

const NOTE_SEMITONE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

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
      else events.push({ midi, dur, vol });
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
    } else {
      i++; // skip whitespace / unknown
    }
  }
  return events;
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

  _scheduleNote(midi, vol, start, dur) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;

    const peak = Math.max(0.02, (vol / 15) * 0.16);
    const a = 0.005; // tiny attack/release to avoid PSG-unfriendly clicks
    const end = start + dur;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + a);
    gain.gain.setValueAtTime(peak, Math.max(start + a, end - a));
    gain.gain.linearRampToValueAtTime(0, end);

    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  // channels: { A, B, C } raw MML strings; bpm number; loop boolean
  play(channels, bpm, loop = true) {
    this.stop();
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.playing = true;

    const parsed = ["A", "B", "C"].map((k) => parseChannel(channels[k], bpm));
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

    const scheduleCycle = (base) => {
      for (const ev of parsed) {
        let t = base;
        for (const n of ev) {
          if (n.midi != null) this._scheduleNote(n.midi, n.vol, t, n.dur);
          t += n.dur;
        }
      }
    };

    const startAt = this.ctx.currentTime + 0.08;
    let cyclesScheduled = 0;
    const scheduleNext = () => {
      if (!this.playing) return;
      scheduleCycle(startAt + cyclesScheduled * cycle);
      cyclesScheduled++;
      if (loop) {
        if (cyclesScheduled > 1 && this.onLoop) this.onLoop(cyclesScheduled);
        const ms = cycle * 1000;
        this.timers.push(setTimeout(scheduleNext, ms - 60));
      } else {
        this.timers.push(
          setTimeout(() => {
            if (this.onEnd) this.onEnd();
            this.stop();
          }, cycle * 1000 + 200)
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
