import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFighter, computeDamage, resolveAttack, startAttack, startBlock, canAct, createMatch, startRound,
  finishRound, cpuDecide, cpuThinkDelay, damageScaleFor, MOVES, cooldownFor,
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
