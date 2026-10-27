/**
 * audio.js — zero-asset Web Audio: a quadcopter rotor bed whose pitch and
 * level track simulated RPM, plus short UI / mission sound effects.
 * Everything is created lazily on the first user gesture.
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.rpm = 0;
  }

  /** Must be called from a click / touch handler. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);

    // Rotor bed: two detuned oscillators through a sweeping low-pass…
    const rotorBus = this.ctx.createGain();
    rotorBus.gain.value = 0;
    this.rotorBus = rotorBus;
    this.rotorFilter = this.ctx.createBiquadFilter();
    this.rotorFilter.type = 'lowpass';
    this.rotorFilter.frequency.value = 420;
    rotorBus.connect(this.rotorFilter).connect(this.master);

    this.oscA = this.ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscA.frequency.value = 70;
    this.oscB = this.ctx.createOscillator();
    this.oscB.type = 'triangle';
    this.oscB.frequency.value = 104;
    const oscGain = this.ctx.createGain();
    oscGain.gain.value = 0.5;
    this.oscA.connect(oscGain);
    this.oscB.connect(oscGain);
    oscGain.connect(rotorBus);

    // …plus filtered noise for blade-wash air.
    const len = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    this.noiseFilter = this.ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 320;
    this.noiseFilter.Q.value = 0.6;
    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = 0.12;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(rotorBus);

    this.oscA.start();
    this.oscB.start();
    this.noise.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  /** Call each frame with the normalised 0…1 rotor speed. */
  updateRotor(rpmNorm, dt) {
    if (!this.ctx) return;
    this.rpm += (rpmNorm - this.rpm) * Math.min(1, 6 * dt);
    const t = this.ctx.currentTime;
    const f = 62 + this.rpm * 150;
    this.oscA.frequency.setTargetAtTime(f, t, 0.08);
    this.oscB.frequency.setTargetAtTime(f * 1.49, t, 0.08);
    this.rotorFilter.frequency.setTargetAtTime(300 + this.rpm * 900, t, 0.1);
    this.noiseFilter.frequency.setTargetAtTime(240 + this.rpm * 700, t, 0.1);
    this.rotorBus.gain.setTargetAtTime(0.04 + this.rpm * 0.16, t, 0.1);
  }

  _tone(freq, duration, type = 'sine', level = 0.18, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  blip() {
    this._tone(880, 0.08, 'square', 0.08);
  }

  lock() {
    this._tone(1175, 0.1, 'sine', 0.12);
  }

  scanTick() {
    this._tone(1568, 0.05, 'sine', 0.05);
  }

  success() {
    this._tone(660, 0.12, 'sine', 0.14, 0);
    this._tone(880, 0.12, 'sine', 0.14, 0.1);
    this._tone(1320, 0.22, 'sine', 0.16, 0.2);
  }

  gate() {
    this._tone(520, 0.1, 'triangle', 0.13, 0);
    this._tone(780, 0.16, 'triangle', 0.13, 0.08);
  }

  warn() {
    this._tone(392, 0.16, 'square', 0.1, 0);
    this._tone(392, 0.16, 'square', 0.1, 0.22);
  }

  crash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.4;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  }
}
