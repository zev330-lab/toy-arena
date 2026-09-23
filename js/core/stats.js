// Pure game data: powers, fun names, deterministic stats, XP/levels.

export const POWERS = [
  { id: 'claws', label: 'Claws', emoji: '🐾', color: '#c9d3e0', fx: 'slash' },
  { id: 'strength', label: 'Super Strength', short: 'Strong', emoji: '💪', color: '#ff7a1a', fx: 'quake' },
  { id: 'laser', label: 'Laser Eyes', short: 'Laser', emoji: '👀', color: '#ff2d55', fx: 'beam' },
  { id: 'fire', label: 'Fire', emoji: '🔥', color: '#ff5a1f', fx: 'fireball' },
  { id: 'ice', label: 'Ice', emoji: '❄️', color: '#5fd3ff', fx: 'freeze' },
  { id: 'lightning', label: 'Lightning', emoji: '⚡', color: '#ffe02e', fx: 'bolt' },
  { id: 'speed', label: 'Speed', emoji: '💨', color: '#39e27d', fx: 'dash' },
  { id: 'shield', label: 'Shield', emoji: '🛡️', color: '#3d8bff', fx: 'bash' },
  { id: 'magic', label: 'Magic', emoji: '✨', color: '#b36bff', fx: 'stars' },
  { id: 'ninja', label: 'Ninja', emoji: '🥷', color: '#556070', fx: 'stars4' },
];
export const powerById = (id) => POWERS.find(p => p.id === id) || POWERS[1];

const FIRST = ['Captain', 'Super', 'Mega', 'Turbo', 'Mighty', 'Ultra', 'Rocket', 'Thunder', 'Iron', 'Shadow', 'Blaze',
  'Frost', 'Ninja', 'Robo', 'Atomic', 'Cosmic', 'Hyper', 'Dino', 'Laser', 'Titan', 'Sonic', 'Galaxy', 'Stealth', 'Power'];
const SECOND = ['Claw', 'Crusher', 'Thunder', 'Tiger', 'Punch', 'Storm', 'Blaster', 'Knight', 'Fang', 'Rex', 'Bolt',
  'Smasher', 'Hawk', 'Viper', 'Titan', 'Buster', 'Wolf', 'Dragon', 'Kong', 'Striker', 'Ranger', 'Comet', 'Bear', 'Shark'];
const SPECIAL = ['Claw Crusher', 'Captain Thunder', 'Mega Max', 'Turbo Tornado', 'Sir Smash-a-Lot', 'Rocket Raccoon Jr',
  'Doctor Boom', 'The Mighty Mo', 'Lava Larry', 'Zap Attack', 'Iron Ike', 'Big Bad Biff'];

/** Small seeded PRNG (mulberry32). */
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomName(rng = Math.random, avoid = '') {
  for (let tries = 0; tries < 10; tries++) {
    let name;
    if (rng() < 0.2) name = SPECIAL[Math.floor(rng() * SPECIAL.length)];
    else {
      const a = FIRST[Math.floor(rng() * FIRST.length)];
      let b = SECOND[Math.floor(rng() * SECOND.length)];
      if (b === a) b = SECOND[(SECOND.indexOf(b) + 1) % SECOND.length];
      name = `${a} ${b}`;
    }
    if (name !== avoid) return name;
  }
  return 'Captain Awesome';
}

/** FNV-1a 32-bit over bytes (sampled). */
export function hashBytes(bytes, stride = 1) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += stride) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Colour features of the opaque part of an RGBA image. */
export function imageFeatures(rgba, w, h) {
  let n = 0, r = 0, g = 0, b = 0, sat = 0, bright = 0, fill = 0;
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
  for (let y = 0; y < h; y += stride) for (let x = 0; x < w; x += stride) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] < 128) continue;
    const R = rgba[i], G = rgba[i + 1], B = rgba[i + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    r += R; g += G; b += B;
    sat += mx ? (mx - mn) / mx : 0;
    bright += mx / 255;
    n++;
  }
  const total = Math.ceil(h / stride) * Math.ceil(w / stride);
  fill = n / Math.max(1, total);
  if (!n) return { r: 128, g: 128, b: 128, sat: 0, bright: 0.5, fill: 0, aspect: h / Math.max(1, w) };
  return { r: r / n, g: g / n, b: b / n, sat: sat / n, bright: bright / n, fill, aspect: h / Math.max(1, w) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Deterministic Power / Speed / Defense (35–95) from image features + hash.
 * Same photo → same stats, always.
 */
export function deriveStats(features, hash) {
  const j = (k) => (((hash >>> (k * 8)) & 0xff) / 255 - 0.5) * 22; // ±11 jitter from the hash
  const { r, g, b, sat, bright, fill, aspect } = features;
  const warm = (r - b) / 255;           // red/orange toys hit harder
  const cool = (b - r) / 255;           // blue/dark toys are tougher
  let power = 62 + warm * 25 + sat * 14 + j(0);
  let speed = 60 + (bright - 0.5) * 30 + (0.5 - fill) * 30 + (g - (r + b) / 2) / 255 * 20 + j(1);
  let defense = 60 + cool * 22 + (fill - 0.4) * 35 + (0.5 - bright) * 16 + Math.min(1, aspect / 3) * 4 + j(2);
  return {
    power: Math.round(clamp(power, 35, 95)),
    speed: Math.round(clamp(speed, 35, 95)),
    defense: Math.round(clamp(defense, 35, 95)),
  };
}

export const XP_PER_LEVEL = 100;
export function levelFromXp(xp = 0) { return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1; }
export function starsForLevel(level) { return clamp(level, 1, 5); }

/** XP after a match. Winners get more, everybody gets something. */
export function awardXp(toy, won) {
  const before = levelFromXp(toy.xp || 0);
  const xp = (toy.xp || 0) + (won ? 40 : 15);
  const level = levelFromXp(xp);
  return { xp, level, leveledUp: level > before, wins: (toy.wins || 0) + (won ? 1 : 0), losses: (toy.losses || 0) + (won ? 0 : 1) };
}
