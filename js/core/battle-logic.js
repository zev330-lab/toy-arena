// Pure battle rules: damage, blocking, special meter, combos, rounds, CPU brain.
// Time is passed in explicitly (seconds) so the rules are testable without a clock.

export const MOVES = {
  punch: { base: 5, windup: 0.14, cooldown: 0.5, meter: 20, knock: 0.35, words: ['POW!', 'BAM!', 'WHAM!', 'BOP!'] },
  kick: { base: 8, windup: 0.24, cooldown: 0.75, meter: 25, knock: 0.6, words: ['BOOM!', 'THWACK!', 'KAPOW!', 'WHACK!'] },
  special: { base: 18, windup: 0.5, cooldown: 1.2, meter: 0, knock: 1.2, words: ['KA-BOOM!', 'ZAP!', 'SUPER!', 'WHOOSH!'] },
};
export const BLOCK_TIME = 0.9;
export const MAX_HP = 100;
export const COMBO_WINDOW = 1.6;

export const DIFFICULTY = {
  easy: { cpuDamage: 0.7, playerDamage: 1.15, think: [1.0, 1.7], block: 0.12, attack: 0.7, kick: 0.3, special: 0.5 },
  hard: { cpuDamage: 1.25, playerDamage: 0.9, think: [0.25, 0.5], block: 0.5, attack: 0.95, kick: 0.45, special: 0.95 },
};

export function createFighter(toy, { isCpu = false } = {}) {
  const stats = toy.stats || { power: 60, speed: 60, defense: 60 };
  return {
    id: toy.id, name: toy.name, power: toy.power, stats, isCpu,
    hp: MAX_HP, meter: 0, roundWins: 0,
    busyUntil: 0, blockUntil: -1, combo: 0, lastHitAt: -99,
  };
}

/** Faster toys recover sooner (speed 35..95 → ×1.12..×0.82). */
export function cooldownFor(f, moveId) {
  return MOVES[moveId].cooldown * (1.3 - f.stats.speed / 200);
}

export function canAct(f, now) { return f.hp > 0 && now >= f.busyUntil; }
export function isBlocking(f, now) { return now < f.blockUntil; }
export function specialReady(f) { return f.meter >= 100; }

export function startBlock(f, now) {
  if (!canAct(f, now)) return false;
  f.blockUntil = now + BLOCK_TIME;
  f.busyUntil = now + BLOCK_TIME * 0.55; // can counter-attack before the shield drops
  return true;
}

/** Begin an attack; returns false if not allowed. The hit lands later via resolveAttack. */
export function startAttack(f, moveId, now) {
  if (!canAct(f, now)) return false;
  if (moveId === 'special' && !specialReady(f)) return false;
  f.blockUntil = -1;
  f.busyUntil = now + MOVES[moveId].windup + cooldownFor(f, moveId);
  if (moveId === 'special') f.meter = 0;
  return true;
}

export function computeDamage(att, def, moveId, { blocked = false, roll = 0.5, scale = 1 } = {}) {
  const m = MOVES[moveId];
  let dmg = m.base * (0.75 + att.stats.power / 200) * (1.15 - def.stats.defense / 300);
  dmg *= 0.9 + roll * 0.2;
  dmg *= scale;
  if (blocked) dmg *= moveId === 'special' ? 0.5 : 0.2;
  return Math.max(1, Math.round(dmg));
}

/**
 * Resolve an attack at impact time. Mutates both fighters.
 * Returns { damage, blocked, ko, combo, word }.
 */
export function resolveAttack(att, def, moveId, { now, rng = Math.random, scale = 1 } = {}) {
  const blocked = isBlocking(def, now) && moveId !== 'special' ? true : (isBlocking(def, now) && rng() < 0.5);
  const damage = computeDamage(att, def, moveId, { blocked, roll: rng(), scale });
  def.hp = Math.max(0, def.hp - damage);
  if (!blocked) {
    att.combo = now - att.lastHitAt <= COMBO_WINDOW ? att.combo + 1 : 1;
    att.lastHitAt = now;
    def.combo = 0;
    def.busyUntil = Math.max(def.busyUntil, now + 0.18 + MOVES[moveId].knock * 0.25); // hit-stun
    def.blockUntil = -1;
  }
  if (moveId !== 'special') att.meter = Math.min(100, att.meter + MOVES[moveId].meter * (blocked ? 0.4 : 1));
  def.meter = Math.min(100, def.meter + (blocked ? 4 : 8));
  const words = MOVES[moveId].words;
  return { damage, blocked, ko: def.hp <= 0, combo: blocked ? 0 : att.combo, word: blocked ? 'BLOCK!' : words[Math.floor(rng() * words.length)] };
}

export function createMatch(a, b, { bestOf = 3 } = {}) {
  return { round: 1, bestOf, winsNeeded: Math.ceil(bestOf / 2), fighters: [a, b], over: false, winner: null };
}

export function startRound(match) {
  for (const f of match.fighters) {
    f.hp = MAX_HP; f.busyUntil = 0; f.blockUntil = -1; f.combo = 0; f.lastHitAt = -99;
    f.meter = Math.min(f.meter, 50); // keep a little charge between rounds
  }
}

/** Record a round winner. Returns { matchOver, winnerIdx }. */
export function finishRound(match, winnerIdx) {
  const f = match.fighters[winnerIdx];
  f.roundWins++;
  if (f.roundWins >= match.winsNeeded) {
    match.over = true;
    match.winner = winnerIdx;
    return { matchOver: true, winnerIdx };
  }
  match.round++;
  return { matchOver: false, winnerIdx };
}

export function cpuThinkDelay(difficulty = 'easy', rng = Math.random) {
  const [lo, hi] = (DIFFICULTY[difficulty] || DIFFICULTY.easy).think;
  return lo + rng() * (hi - lo);
}

/**
 * CPU brain. `opponentAttacking` = the human is winding up right now.
 * Returns 'punch' | 'kick' | 'special' | 'block' | 'wait'.
 */
export function cpuDecide(cpu, opponent, { difficulty = 'easy', rng = Math.random, now = 0, opponentAttacking = false } = {}) {
  const d = DIFFICULTY[difficulty] || DIFFICULTY.easy;
  if (!canAct(cpu, now)) return 'wait';
  if (opponentAttacking && rng() < d.block) return 'block';
  if (specialReady(cpu) && rng() < d.special) return 'special';
  // on easy, go gentle when the kid is losing badly
  let attack = d.attack;
  if (difficulty === 'easy' && opponent.hp < 35 && cpu.hp > opponent.hp) attack *= 0.6;
  if (rng() > attack) return 'wait';
  return rng() < d.kick ? 'kick' : 'punch';
}

export function damageScaleFor(attacker, difficulty = 'easy') {
  const d = DIFFICULTY[difficulty] || DIFFICULTY.easy;
  return attacker.isCpu ? d.cpuDamage : d.playerDamage;
}
