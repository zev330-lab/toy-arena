// All sound is synthesised with Web Audio — no audio files.

let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
let muted = false;
let music = null;

function ensure() {
  if (ctx) return ctx;
  // Automated test browsers (navigator.webdriver) and ?mute=1 never make sound: headless WebKit
  // plays through the host Mac's speakers and has no mute switch.
  if (navigator.webdriver || new URLSearchParams(location.search).has('mute')) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Call from the first user gesture (iOS needs this). */
export function unlockAudio() {
  const c = ensure();
  if (!c) return;
  if (c.state !== 'running') c.resume().catch(() => {}); // iOS also uses 'interrupted' after calls/camera
  // Play through the iPhone's silent switch like a game (Safari 16.4+).
  try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b; s.connect(c.destination); s.start(0);
}
export function installAudioUnlock() {
  const once = () => { unlockAudio(); };
  for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, once, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend?.().catch(() => {});
    else ctx.resume?.().catch(() => {});
  });
}

export function setMuted(m) {
  muted = !!m;
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
}
export const isMuted = () => muted;

// ---------- building blocks ----------
function env(g, t, a, peak, dcy, end = 0.0001) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + dcy);
}
function tone({ type = 'sine', f0 = 440, f1 = null, t = 0, dur = 0.2, vol = 0.3, attack = 0.005, bus = null, curve = 'exp', detune = 0 }) {
  const c = ensure(); if (!c) return;
  bus = bus || sfxBus; // default resolved after ensure(): the bus doesn't exist before the first sound
  const now = c.currentTime + t;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f0, now);
  if (f1 != null) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
    else o.frequency.linearRampToValueAtTime(f1, now + dur);
  }
  env(g, now, attack, vol, dur);
  o.connect(g).connect(bus);
  o.start(now); o.stop(now + attack + dur + 0.05);
}
function noise({ t = 0, dur = 0.2, vol = 0.3, type = 'lowpass', f0 = 1200, f1 = null, q = 1, attack = 0.003, bus = null }) {
  const c = ensure(); if (!c) return;
  bus = bus || sfxBus;
  const now = c.currentTime + t;
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, now);
  if (f1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
  const g = c.createGain();
  env(g, now, attack, vol, dur);
  s.connect(f).connect(g).connect(bus);
  s.start(now, Math.random() * 0.5); s.stop(now + attack + dur + 0.05);
}
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// ---------- sound effects ----------
export const sfx = {
  pop() { tone({ type: 'sine', f0: 520, f1: 980, dur: 0.09, vol: 0.25 }); },
  tap() { tone({ type: 'triangle', f0: 700, f1: 1100, dur: 0.06, vol: 0.18 }); },
  back() { tone({ type: 'triangle', f0: 700, f1: 380, dur: 0.1, vol: 0.18 }); },
  hit(strength = 1) {
    noise({ dur: 0.12 + strength * 0.06, vol: 0.5 * strength + 0.2, f0: 2400, f1: 300, type: 'lowpass' });
    tone({ type: 'sine', f0: 160, f1: 45, dur: 0.18, vol: 0.7 });
    tone({ type: 'square', f0: 90, f1: 40, dur: 0.08, vol: 0.12 });
  },
  whoosh() { noise({ dur: 0.22, vol: 0.28, type: 'bandpass', f0: 500, f1: 2600, q: 1.4, attack: 0.04 }); },
  block() {
    tone({ type: 'square', f0: 620, dur: 0.18, vol: 0.12 });
    tone({ type: 'square', f0: 930, dur: 0.14, vol: 0.08 });
    noise({ dur: 0.08, vol: 0.2, type: 'highpass', f0: 3000 });
  },
  step() { tone({ type: 'sine', f0: 220, f1: 110, dur: 0.06, vol: 0.12 }); },
  boing() { tone({ type: 'sine', f0: 180, f1: 620, dur: 0.18, vol: 0.3, curve: 'lin' }); tone({ type: 'sine', t: 0.16, f0: 620, f1: 260, dur: 0.2, vol: 0.2 }); },
  jump() { tone({ type: 'square', f0: 300, f1: 900, dur: 0.16, vol: 0.12 }); },
  land() { tone({ type: 'sine', f0: 140, f1: 60, dur: 0.1, vol: 0.35 }); noise({ dur: 0.08, vol: 0.12, f0: 800 }); },
  sparkle() { [0, 0.06, 0.12, 0.18].forEach((t, i) => tone({ type: 'sine', t, f0: midi(84 + [0, 4, 7, 12][i]), dur: 0.25, vol: 0.12 })); },
  clap() { [0, 0.035, 0.07].forEach(t => noise({ t, dur: 0.07, vol: 0.45, type: 'bandpass', f0: 1400, q: 0.8 })); },
  giggle() { [0, 0.13, 0.26, 0.39].forEach((t, i) => tone({ type: 'sine', t, f0: 820 - i * 40, f1: 620 - i * 40, dur: 0.1, vol: 0.18 })); },
  kiss() { tone({ type: 'sine', f0: 1200, f1: 500, dur: 0.12, vol: 0.2 }); },
  kickBall() { tone({ type: 'sine', f0: 240, f1: 80, dur: 0.1, vol: 0.45 }); noise({ dur: 0.05, vol: 0.2, f0: 1500 }); },
  ko() { [0, 0.28, 0.56].forEach((t, i) => tone({ type: 'square', t, f0: 330 - i * 60, f1: 250 - i * 60, dur: 0.26, vol: 0.12 })); tone({ type: 'sawtooth', t: 0.84, f0: 190, f1: 70, dur: 0.6, vol: 0.12 }); },
  bell() { [1, 2.76, 5.4].forEach((m, i) => tone({ type: 'sine', f0: 660 * m, dur: 1.2 / (i + 1), vol: 0.15 / (i + 1) })); },
  countdown(final = false) { tone({ type: 'square', f0: final ? 1046 : 523, dur: final ? 0.4 : 0.14, vol: 0.14 }); },
  fanfare() {
    [[72, 0], [76, 0.14], [79, 0.28], [84, 0.42], [79, 0.64], [84, 0.78]].forEach(([n, t], i) => {
      tone({ type: 'square', t, f0: midi(n), dur: i === 5 ? 0.7 : 0.16, vol: 0.12 });
      tone({ type: 'triangle', t, f0: midi(n - 12), dur: i === 5 ? 0.7 : 0.16, vol: 0.18 });
    });
  },
  cheer() {
    const c = ensure(); if (!c) return;
    for (let i = 0; i < 6; i++) noise({ t: i * 0.12, dur: 1.4 - i * 0.12, vol: 0.12, type: 'bandpass', f0: 900 + Math.random() * 1600, q: 1.8, attack: 0.25 });
    [0.2, 0.5, 0.9].forEach(t => tone({ type: 'sine', t, f0: 1400 + Math.random() * 400, f1: 2000, dur: 0.3, vol: 0.05 }));
  },
  levelUp() { [0, 4, 7, 12, 16].forEach((n, i) => tone({ type: 'square', t: i * 0.08, f0: midi(72 + n), dur: 0.12, vol: 0.1 })); },
  special(kind) {
    switch (kind) {
      case 'slash': [0, 0.09, 0.18].forEach(t => { noise({ t, dur: 0.12, vol: 0.35, type: 'highpass', f0: 2500, f1: 7000 }); tone({ type: 'sawtooth', t, f0: 2400, f1: 1200, dur: 0.1, vol: 0.05 }); }); break;
      case 'quake': tone({ type: 'sine', f0: 90, f1: 30, dur: 0.9, vol: 0.8 }); noise({ dur: 0.9, vol: 0.5, f0: 400, f1: 60 }); break;
      case 'beam': for (let i = 0; i < 4; i++) tone({ type: 'sawtooth', t: i * 0.1, f0: 1800, f1: 400, dur: 0.12, vol: 0.1 }); tone({ type: 'square', f0: 220, f1: 240, dur: 0.6, vol: 0.06 }); break;
      case 'fireball': noise({ dur: 0.8, vol: 0.5, f0: 300, f1: 2400, attack: 0.1 }); tone({ type: 'sawtooth', f0: 80, f1: 50, dur: 0.8, vol: 0.12 }); break;
      case 'freeze': [0, 0.07, 0.14, 0.21, 0.28].forEach((t, i) => tone({ type: 'sine', t, f0: midi(88 + (i % 3) * 3), dur: 0.35, vol: 0.12 })); noise({ dur: 0.5, vol: 0.12, type: 'highpass', f0: 6000 }); break;
      case 'bolt': for (let i = 0; i < 6; i++) noise({ t: i * 0.05 + Math.random() * 0.03, dur: 0.06, vol: 0.5, type: 'highpass', f0: 1200 }); tone({ type: 'sawtooth', f0: 110, f1: 55, dur: 0.6, vol: 0.2 }); break;
      case 'dash': noise({ dur: 0.3, vol: 0.4, type: 'bandpass', f0: 300, f1: 5000, q: 2 }); break;
      case 'bash': this.block(); tone({ type: 'sine', f0: 120, f1: 40, dur: 0.4, vol: 0.6 }); break;
      case 'stars': this.sparkle(); tone({ type: 'triangle', t: 0.2, f0: midi(79), f1: midi(91), dur: 0.4, vol: 0.12 }); break;
      case 'stars4': [0, 0.08, 0.16, 0.24].forEach(t => noise({ t, dur: 0.1, vol: 0.3, type: 'bandpass', f0: 4000, q: 3 })); break;
      default: this.hit(1.2);
    }
  },
  charge() { tone({ type: 'sawtooth', f0: 200, f1: 1200, dur: 0.45, vol: 0.08 }); },
};

// ---------- music: tiny step sequencer ----------
const SONGS = {
  battle: {
    bpm: 144, steps: 16,
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    hat: [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
    bass: [45, 0, 45, 57, 0, 45, 0, 43, 41, 0, 41, 53, 0, 43, 0, 44],
    lead: [[69, 72, 76, 0, 74, 0, 72, 0, 69, 0, 67, 69, 0, 72, 0, 0], [65, 69, 72, 0, 71, 0, 69, 0, 67, 0, 64, 67, 0, 71, 0, 0]],
  },
  dance: {
    bpm: 120, steps: 16,
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
    bass: [36, 48, 36, 48, 36, 48, 36, 48, 41, 53, 41, 53, 43, 55, 43, 55],
    lead: [[72, 0, 76, 79, 0, 76, 0, 72, 77, 0, 81, 0, 79, 0, 76, 0], [72, 0, 76, 79, 0, 84, 0, 79, 77, 0, 76, 74, 72, 0, 0, 0]],
  },
};

export function startMusic(name) {
  const c = ensure(); if (!c) return;
  if (music?.name === name) return;
  stopMusic();
  const song = SONGS[name];
  const stepDur = 60 / song.bpm / 4;
  let step = 0, bar = 0, next = c.currentTime + 0.1;
  const bus = c.createGain(); bus.gain.value = 1; bus.connect(musicBus);
  const play = (t) => {
    const at = t - c.currentTime;
    if (song.kick[step]) tone({ type: 'sine', t: at, f0: 150, f1: 42, dur: 0.14, vol: 0.9, bus });
    if (song.snare[step]) { noise({ t: at, dur: 0.12, vol: 0.4, type: 'highpass', f0: 1500, bus }); tone({ type: 'triangle', t: at, f0: 200, f1: 150, dur: 0.08, vol: 0.2, bus }); }
    if (song.hat[step]) noise({ t: at, dur: 0.03, vol: 0.12, type: 'highpass', f0: 8000, bus });
    const b = song.bass[step];
    if (b) tone({ type: 'triangle', t: at, f0: midi(b), dur: stepDur * 1.6, vol: 0.42, bus });
    const l = song.lead[bar % song.lead.length][step];
    if (l) { tone({ type: 'square', t: at, f0: midi(l), dur: stepDur * 1.4, vol: 0.07, bus }); tone({ type: 'square', t: at, f0: midi(l), dur: stepDur * 1.4, vol: 0.04, bus, detune: 12 }); }
  };
  const timer = setInterval(() => {
    while (next < c.currentTime + 0.12) {
      play(next);
      next += stepDur;
      step = (step + 1) % song.steps;
      if (step === 0) bar++;
    }
  }, 25);
  music = { name, timer, bus, beat: () => ({ step, bar, stepDur }) };
}
export function stopMusic() {
  if (!music) return;
  clearInterval(music.timer);
  const { bus } = music;
  try { bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => bus.disconnect(), 400); } catch { /* ignore */ }
  music = null;
}

export function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* iOS: no-op */ }
}
