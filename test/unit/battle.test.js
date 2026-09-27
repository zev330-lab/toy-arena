import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFighter, computeDamage, resolveAttack, startAttack, startBlock, canAct, createMatch, startRound,
  finishRound, cpuDecide, cpuThinkDelay, damageScaleFor, MOVES, cooldownFor, startJump, canJump, isAirborne, JUMP_TIME, JUMP_COOLDOWN,
} from '../../js/core/battle-logic.js';
import { makeRng } from '../../js/core/stats.js';

const toy = (id, s) => ({ id, name: id, power: 'fire', stats: s });

test('stronger attacker and weaker defender → more damage; kick > punch', () => {
  const strong = createFighter(toy('a', { power: 95, speed: 50, defense: 50 }));
  const weak = createFighter(toy('b', { power: 35, speed: 50, defense: 35 }));
  const tank = createFighter(toy('c', { power: 50, speed: 50, defense: 95 }));
  assert.ok(computeDamage(strong, weak, 'punch') > computeDamage(weak, strong, 'punch'));
  assert.ok(computeDamage(strong, weak, 'punch') > computeDamage(strong, tank, 'punch'));
  assert.ok(computeDamage(strong, weak, 'kick') > computeDamage(strong, weak, 'punch'));
  assert.ok(computeDamage(strong, weak, 'special') > computeDamage(strong, weak, 'kick'));
});

test('blocking cuts damage hard and does not build a combo', () => {
  const a = createFighter(toy('a', { power: 70, speed: 60, defense: 60 }));
  const b = createFighter(toy('b', { power: 70, speed: 60, defense: 60 }));
  startBlock(b, 0);
  const r = resolveAttack(a, b, 'kick', { now: 0.2, rng: () => 0.5 });
  assert.equal(r.blocked, true);
  assert.equal(r.word, 'BLOCK!');
  assert.ok(r.damage <= 3);
  assert.equal(r.combo, 0);
});

test('special needs a full meter, empties it', () => {
  const a = createFighter(toy('a', { power: 60, speed: 60, defense: 60 }));
  assert.equal(startAttack(a, 'special', 0), false);
  a.meter = 100;
  assert.equal(startAttack(a, 'special', 0), true);
  assert.equal(a.meter, 0);
});

test('cooldown gates actions; faster toys recover sooner', () => {
  const fast = createFighter(toy('f', { power: 60, speed: 95, defense: 60 }));
  const slow = createFighter(toy('s', { power: 60, speed: 35, defense: 60 }));
  assert.ok(cooldownFor(fast, 'punch') < cooldownFor(slow, 'punch'));
  startAttack(fast, 'punch', 0);
  assert.equal(canAct(fast, 0.1), false);
  assert.equal(canAct(fast, MOVES.punch.windup + cooldownFor(fast, 'punch') + 0.01), true);
});

test('hits build combos and the special meter', () => {
  const a = createFighter(toy('a', { power: 60, speed: 60, defense: 60 }));
  const b = createFighter(toy('b', { power: 60, speed: 60, defense: 60 }));
  let r;
  for (let i = 0; i < 5; i++) r = resolveAttack(a, b, 'punch', { now: i * 0.6, rng: () => 0.5 });
  assert.equal(r.combo, 5);
  assert.equal(a.meter, 100);
});

test('best-of-3 match: first to 2 round wins', () => {
  const m = createMatch(createFighter(toy('a', { power: 60, speed: 60, defense: 60 })), createFighter(toy('b', { power: 60, speed: 60, defense: 60 })));
  assert.deepEqual(finishRound(m, 0), { matchOver: false, winnerIdx: 0 });
  startRound(m);
  assert.equal(m.fighters[0].hp, 100);
  assert.deepEqual(finishRound(m, 1), { matchOver: false, winnerIdx: 1 });
  assert.deepEqual(finishRound(m, 0), { matchOver: true, winnerIdx: 0 });
  assert.equal(m.winner, 0);
});

// Full simulated fights: a mashing kid vs. the easy CPU should usually win, and every match must end.
function simulate(seed, difficulty) {
  const rng = makeRng(seed);
  const kid = createFighter(toy('kid', { power: 60, speed: 60, defense: 60 }));
  const cpu = createFighter(toy('cpu', { power: 60, speed: 60, defense: 60 }), { isCpu: true });
  const m = createMatch(kid, cpu);
  let t = 0, cpuNext = cpuThinkDelay(difficulty, rng);
  const pending = [];
  while (!m.over && t < 600) {
    t += 0.05;
    // kid mashes punch (sometimes kick) whenever possible
    if (canAct(kid, t)) { const mv = kid.meter >= 100 ? 'special' : rng() < 0.3 ? 'kick' : 'punch'; if (startAttack(kid, mv, t)) pending.push({ at: t + MOVES[mv].windup, a: kid, d: cpu, mv }); }
    if (t >= cpuNext) {
      const mv = cpuDecide(cpu, kid, { difficulty, rng, now: t, opponentAttacking: pending.some(p => p.a === kid) });
      if (mv === 'block') startBlock(cpu, t);
      else if (mv === 'jump') startJump(cpu, t);
      else if (mv !== 'wait' && startAttack(cpu, mv, t)) pending.push({ at: t + MOVES[mv].windup, a: cpu, d: kid, mv });
      cpuNext = t + cpuThinkDelay(difficulty, rng);
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (t < p.at) continue;
      pending.splice(i, 1);
      if (p.a.hp <= 0 || p.d.hp <= 0) continue;
      const r = resolveAttack(p.a, p.d, p.mv, { now: t, rng, scale: damageScaleFor(p.a, difficulty) });
      if (r.ko) { finishRound(m, m.fighters.indexOf(p.a)); if (!m.over) startRound(m); pending.length = 0; break; }
    }
  }
  return m;
}

test('every simulated match ends with a winner', () => {
  for (let s = 1; s <= 30; s++) {
    const m = simulate(s, s % 2 ? 'easy' : 'hard');
    assert.equal(m.over, true, `seed ${s}`);
    assert.equal(m.fighters[m.winner].roundWins, 2);
  }
});

test('easy CPU is beatable by button mashing (kid wins most matches)', () => {
  let wins = 0;
  for (let s = 1; s <= 40; s++) if (simulate(s, 'easy').winner === 0) wins++;
  assert.ok(wins >= 30, `kid won ${wins}/40`);
});

test('jumping makes punches and kicks miss; supers still land', () => {
  const a = createFighter(toy('a', { power: 70, speed: 60, defense: 60 }));
  const b = createFighter(toy('b', { power: 70, speed: 60, defense: 60 }));
  assert.equal(startJump(b, 0), true);
  assert.ok(isAirborne(b, 0.3) && !isAirborne(b, JUMP_TIME + 0.01));
  const r = resolveAttack(a, b, 'punch', { now: 0.3, rng: () => 0.5 });
  assert.equal(r.missed, true); assert.equal(r.damage, 0); assert.equal(r.word, 'MISS!');
  assert.equal(b.hp, 100);
  assert.equal(resolveAttack(a, b, 'kick', { now: 0.5, rng: () => 0.5 }).missed, true);
  a.meter = 100;
  const s = resolveAttack(a, b, 'special', { now: 0.6, rng: () => 0.5 });
  assert.equal(s.missed, false); assert.ok(b.hp < 100, 'super hits a jumper');
  assert.equal(resolveAttack(a, b, 'punch', { now: JUMP_TIME + 0.05, rng: () => 0.5 }).missed, false, 'back on the ground = hittable');
});

test('jump has a cooldown and needs a free fighter', () => {
  const f = createFighter(toy('f', { power: 60, speed: 60, defense: 60 }));
  assert.equal(startJump(f, 0), true);
  assert.equal(canJump(f, 0.5), false);
  assert.equal(startJump(f, JUMP_COOLDOWN - 0.01), false);
  assert.equal(startJump(f, JUMP_COOLDOWN + 0.01), true);
  const g = createFighter(toy('g', { power: 60, speed: 60, defense: 60 }));
  startAttack(g, 'kick', 0);
  assert.equal(startJump(g, 0.1), false, 'mid-kick');
});

test('a kick started in the air is a flying kick: more damage', () => {
  const mk = () => createFighter(toy('x', { power: 70, speed: 60, defense: 60 }));
  const ground = mk(), air = mk(), d1 = mk(), d2 = mk();
  startAttack(ground, 'kick', 0);
  const r1 = resolveAttack(ground, d1, 'kick', { now: 0.3, rng: () => 0.5 });
  startJump(air, 0);
  assert.equal(startAttack(air, 'kick', 0.3), true, 'can kick from the air');
  const r2 = resolveAttack(air, d2, 'kick', { now: 0.55, rng: () => 0.5 });
  assert.equal(r2.flying, true); assert.equal(r2.word, 'FLYING KICK!');
  assert.ok(r2.damage > r1.damage, `${r2.damage} > ${r1.damage}`);
});

test('the CPU sometimes jumps: dodges on hard, hops for fun', () => {
  const kid = createFighter(toy('k', { power: 60, speed: 60, defense: 60 }));
  let dodges = 0;
  for (let i = 0; i < 200; i++) {
    const cpu = createFighter(toy('c', { power: 60, speed: 60, defense: 60 }), { isCpu: true });
    if (cpuDecide(cpu, kid, { difficulty: 'hard', rng: makeRng(i + 7), now: 5, opponentAttacking: true }) === 'jump') dodges++;
  }
  assert.ok(dodges > 5 && dodges < 120, `hard CPU jumped ${dodges}/200`);
});

test('a new round starts on the ground, jump ready (the clock is paused between rounds)', () => {
  const a = createFighter(toy('a', { power: 60, speed: 60, defense: 60 }));
  const b = createFighter(toy('b', { power: 60, speed: 60, defense: 60 }));
  const m = createMatch(a, b);
  startJump(a, 10);
  a.airAttack = true;
  startRound(m);
  assert.equal(isAirborne(a, 10.1), false, 'still flying after the reset');
  assert.equal(canJump(a, 10.1), true);
  assert.equal(a.airAttack, false);
});
