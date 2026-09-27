// Battle mode: best-of-3, 1 player vs CPU or 2 players on one phone.

import * as THREE from 'three';
import { h, btn, modal, confetti, sleep, UrlBag } from './ui.js';
import { go, back as navBack, possessive, ownerName } from './app.js';
import * as db from './db.js';
import { Arena } from './arena.js';
import { powBubble, comboText, banner } from './hud.js';
import { sfx, startMusic, stopMusic, buzz } from './audio.js';
import { powerById, awardXp } from './core/stats.js';
import {
  MOVES, BLOCK_TIME, createFighter, createMatch, startRound, finishRound, startAttack, startBlock,
  resolveAttack, cpuDecide, cpuThinkDelay, damageScaleFor, specialReady, canAct, startJump, canJump, JUMP_TIME,
} from './core/battle-logic.js';

export async function battleScreen(el, { ids, players = '1p', stage }) {
  el.classList.add('arena');
  const bag = new UrlBag();
  const toys = await Promise.all(ids.slice(0, 2).map(id => db.getToy(id)));
  if (toys.some(t => !t)) { go('home', {}, { reset: true }); return null; }
  const two = players === '2p';
  const difficulty = db.settings().difficulty || 'easy';
  const view = h('div', { class: 'viewport' });
  const hud = h('div', { class: `hud${two ? ' two' : ''}` });
  const fxLayer = h('div', { class: 'fullbleed', style: { pointerEvents: 'none', zIndex: 12 } });
  el.append(view, fxLayer, hud);
  el.dataset.state = 'loading';

  const arena = new Arena(view, stage);
  arena.framing = { lookY: 0.95, extraSpan: 1.9, minSpan: 2.8, height: 0.26, bias: 0 };
  const portrait = view.clientHeight > view.clientWidth;
  const X = portrait ? 0.85 : 1.45;
  let figs;
  try { figs = [await arena.addToy(toys[0], -X, 0), await arena.addToy(toys[1], X, 0)]; } catch (e) { arena.dispose(); throw e; }
  figs[0].face(X); figs[1].face(-X);
  arena.framing.extraSpan = Math.max(...figs.map(f => f.built.width)) + 0.3;
  const F = [0, 1].map(i => ({ i, toy: toys[i], fig: figs[i], st: createFighter(toys[i], { isCpu: !two && i === 1 }), windUntil: 0 }));
  const match = createMatch(F[0].st, F[1].st);

  let alive = true;
  let fighting = false;
  let paused = false;
  let clock = 0;
  let cpuNext = 1.2;
  const timers = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); };

  // ---------- HUD ----------
  const hpBox = (f, side) => {
    const hpI = h('i'), hpB = h('b');
    const meterI = h('i');
    const box = h('div', { class: `hpbox ${side}` },
      h('div', { class: 'face' }, h('img', { src: bag.url(f.toy.thumbBlob), alt: '' })),
      h('div', { class: 'col' },
        h('div', { class: 'nm' }, f.toy.name),
        h('div', { class: 'hp', role: 'progressbar', 'aria-label': `${f.toy.name} health` }, hpB, hpI),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, meterI)));
    f.ui = { box, hpI, hpB, meterI, hp: box.querySelector('.hp'), meter: box.querySelector('.meter') };
    return box;
  };
  const dots = [h('div', { class: 'rounds' }), h('div', { class: 'rounds' })];
  const roundLabel = h('div', { class: 'rlabel' }, 'R1');
  const mid = h('div', { class: 'round-mid' }, roundLabel, h('div', { class: 'row', style: { gap: '6px' } }, dots[0], dots[1]));
  const renderDots = () => {
    dots.forEach((d, i) => { d.replaceChildren(...[0, 1].map(k => h('span', { class: k < F[i].st.roundWins ? 'won' : '' }))); });
    roundLabel.textContent = `R${match.round}`;
  };
  const pauseBtn = btn({ emoji: '⏸️', cls: 'icon white small', aria: 'Pause', onClick: () => pause() });
  // one layout for both modes: health bars across the top; two players sit side by side, each with
  // their own buttons on their side and the arena the right way up for both (no upside-down player)
  hud.append(h('div', { class: 'bars' }, hpBox(F[0], 'l'), mid, hpBox(F[1], 'r')), h('div', { class: 'hud-top-btns' }, pauseBtn));

  const controlPad = (f, cls) => {
    const pad = h('div', { class: `controls ${cls}` });
    const mk = (move, emoji, label, color) => {
      const b = btn({ emoji, label, cls: `${color} ${move}`, aria: label });
      b.dataset.move = move;
      const act = () => (move === 'block' ? doBlock(f.i) : move === 'jump' ? doJump(f.i) : doAttack(f.i, move));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('pressed');
        setTimeout(() => b.classList.remove('pressed'), 120);
        act();
      });
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
      return b;
    };
    const sp = mk('special', powerById(f.toy.power).emoji, 'Super', 'yellow');
    const jb = mk('jump', '🦘', 'Jump', 'orange');
    f.ui.jump = jb;
    sp.append(h('span', { class: 'fill' }));
    const punch = mk('punch', '👊', 'Punch', 'red'), kick = mk('kick', '🦶', 'Kick', 'blue'), block = mk('block', '🛡️', 'Block', 'green');
    // one player: a row with Jump in the middle; two players: 2 x 2 pad with a wide Jump underneath
    pad.append(...(two ? [punch, kick, block, sp, jb] : [punch, kick, jb, block, sp]));
    f.ui.special = sp;
    return pad;
  };
  if (two) {
    hud.append(controlPad(F[0], 'p1'), controlPad(F[1], 'p2'));
    // on a phone held upright, suggest turning it sideways (more room for two)
    if (view.clientHeight > view.clientWidth && Math.min(innerWidth, innerHeight) < 600) {
      const hint = h('div', { class: 'rotate-hint', 'aria-hidden': 'true' }, '📱', h('span', {}, '↻'));
      hud.append(hint);
      later(5000, () => hint.remove());
    }
  } else {
    const pad = controlPad(F[0], 'p1');
    pad.classList.add('solo'); // one player: all five buttons in a row along the bottom
    hud.append(pad);
  }

  const updateHud = () => {
    for (const f of F) {
      const hp = f.st.hp / 100;
      f.ui.hpI.style.transform = `scaleX(${hp})`;
      f.ui.hpB.style.transform = `scaleX(${hp})`;
      f.ui.hp.classList.toggle('low', hp < 0.3);
      f.ui.hp.setAttribute('aria-valuenow', String(f.st.hp));
      f.ui.meterI.style.width = `${f.st.meter}%`;
      f.ui.meter.classList.toggle('full', specialReady(f.st));
      if (f.ui.special) {
        f.ui.special.style.setProperty('--m', f.st.meter / 100);
        f.ui.special.classList.toggle('ready', specialReady(f.st));
      }
    }
    el.dataset.hp = `${F[0].st.hp},${F[1].st.hp}`;
  };

  // ---------- actions ----------
  function doBlock(i) {
    if (!fighting || paused) return;
    const f = F[i];
    if (!startBlock(f.st, clock)) return;
    f.fig.blockFor(BLOCK_TIME, 0x5fd3ff);
    sfx.whoosh();
  }

  function doJump(i) {
    if (!fighting || paused) return;
    const f = F[i];
    if (!startJump(f.st, clock)) {
      if (canAct(f.st, clock)) f.ui.jump?.animate([{ transform: 'translateY(-6px)' }, { transform: 'none' }], { duration: 200 }); // still cooling down
      return;
    }
    sfx.jump();
    f.fig.shieldUntil = 0; // jumping ends a block (the rules already did)
    f.fig.jump(1.05, { dur: JUMP_TIME + 0.12, flip: Math.random() < 0.3, onLand: () => { sfx.land(); arena.fx.dust(f.fig.root.position, 6); } });
  }

  function doAttack(i, move) {
    if (!fighting || paused) return;
    const me = F[i], them = F[1 - i];
    if (move === 'special' && !specialReady(me.st)) { me.ui.special?.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 200 }); return; }
    if (!startAttack(me.st, move, clock)) return;
    me.windUntil = clock + MOVES[move].windup;
    updateHud();
    if (move === 'special') { special(me, them); return; }
    sfx.whoosh();
    me.fig.lunge(them.fig.home.x, { windup: MOVES[move].windup, strike: 0.09, recover: 0.28, kind: move, onImpact: () => land(me, them, move) });
  }

  function land(me, them, move) {
    if (!fighting || them.st.hp <= 0) return;
    const r = resolveAttack(me.st, them.st, move, { now: clock, scale: damageScaleFor(me.st, difficulty) });
    const at = them.fig.chestPos;
    const color = powerById(me.toy.power).color;
    if (r.missed) { // jumped right over it
      sfx.whoosh();
      powBubble(fxLayer, arena, at, 'MISS!', { color: '#ffffff' });
      el.dataset.misses = String(Number(el.dataset.misses || 0) + 1);
      updateHud();
      return;
    }
    if (r.blocked) {
      sfx.block();
      arena.fx.hitSparks(at, 0x9be8ff);
      them.fig.knockback(0.3, { blocked: true });
      powBubble(fxLayer, arena, at, 'BLOCK!', { color: '#9be8ff' });
    } else {
      const big = move !== 'punch' || r.flying;
      sfx.hit(move === 'special' ? 1.6 : move === 'kick' || r.flying ? 1.2 : 0.9);
      arena.fx.hitSparks(at, move === 'special' ? new THREE.Color(color).getHex() : 0xffe066, big);
      arena.fx.stars(at, big ? 5 : 3);
      arena.shake(move === 'special' ? 0.35 : big ? 0.2 : 0.12);
      arena.zoomPunch(move === 'special' ? 1 : 0.5);
      them.fig.knockback(MOVES[move].knock * (r.flying ? 1.4 : 1));
      powBubble(fxLayer, arena, at, r.word, { big: move === 'special' || r.flying });
      if (r.combo >= 2) comboText(fxLayer, arena, me.fig.headPos, r.combo);
      buzz(move === 'special' ? [40, 30, 60] : 25);
    }
    updateHud();
    if (r.ko) ko(me.i);
  }

  function special(me, them) {
    const p = powerById(me.toy.power);
    const col = new THREE.Color(p.color).getHex();
    me.fig.glowFor(0.7, col);
    sfx.charge();
    powBubble(fxLayer, arena, me.fig.headPos, `${p.emoji} ${(p.short || p.label).toUpperCase()}!`, { color: p.color });
    const hit = () => land(me, them, 'special');
    const from = () => me.fig.chestPos.clone().add(new THREE.Vector3(0.3 * me.fig.dir, 0.1, 0));
    const to = () => them.fig.chestPos;
    later(450, () => {
      sfx.special(p.fx);
      switch (p.fx) {
        case 'slash':
          me.fig.lunge(them.fig.home.x, { windup: 0.05, strike: 0.08, recover: 0.4, reach: 0.7, onImpact: () => { arena.fx.slash(to(), me.fig.dir, 0xe6f0ff); hit(); } });
          break;
        case 'quake': // leap up, fists first, pound the ground
          me.fig.jump(1.6, { dur: 0.75, onLand: () => { arena.fx.shockwave(me.fig.root.position, col); arena.fx.dust(me.fig.root.position, 12); arena.shake(0.5); hit(); } });
          break;
        case 'beam':
          me.fig.castForward(0.9);
          arena.fx.beam(me.fig.headPos.clone().add(new THREE.Vector3(0.2 * me.fig.dir, -0.35, 0.1)), to(), col, 0.6);
          later(300, hit);
          break;
        case 'fireball': // wind up and throw it
          me.fig.throwMove({ onRelease: () => arena.fx.projectile(from(), to(), { color: 0xff7a1a, trailColor: 0xffd23f, size: 0.7, dur: 0.45, onHit: () => { arena.fx.burst(to(), { count: 24, color: 0xff5a1f, speed: 4, size: 0.4, tex: 'glow' }); hit(); } }) });
          break;
        case 'freeze':
          me.fig.castForward(0.8);
          arena.fx.projectile(from(), to(), { tex: 'flake', color: 0xffffff, trailColor: 0x9be8ff, size: 0.45, dur: 0.45, spin: 8, onHit: () => { arena.fx.crystals(them.fig.root.position.clone(), 0x9be8ff); hit(); } });
          break;
        case 'bolt': // call lightning down
          me.fig.castUp(0.8);
          arena.fx.bolt(to().clone().add(new THREE.Vector3(0, 5, 0)), to(), 0xffe02e, 0.5);
          arena.fx.bolt(from(), to(), 0xfff6a0, 0.4);
          later(150, hit);
          break;
        case 'dash':
          me.fig.spinAttack(them.fig.home.x, { onImpact: () => { arena.fx.dust(them.fig.root.position, 10); hit(); } });
          break;
        case 'bash':
          me.fig.blockFor(0.8, col);
          me.fig.lunge(them.fig.home.x, { windup: 0.05, strike: 0.12, recover: 0.4, reach: 0.65, onImpact: () => { arena.fx.shockwave(them.fig.root.position, col); hit(); } });
          break;
        case 'stars4':
          me.fig.throwMove({ dur: 0.45 });
          for (let k = 0; k < 3; k++) later(k * 110 + 150, () => arena.fx.projectile(from().add(new THREE.Vector3(0, (k - 1) * 0.3, 0)), to(), { tex: 'shuriken', color: 0xffffff, size: 0.4, dur: 0.35, spin: 20, arc: 0.1, trail: 'spark', trailColor: 0xc9d3e0, onHit: k === 2 ? hit : null }));
          break;
        default: // magic stars
          me.fig.castForward(0.9);
          arena.fx.projectile(from(), to(), { tex: 'star', color: 0xffffff, size: 0.55, dur: 0.5, spin: 10, arc: 0.6, trail: 'spark', trailColor: col, onHit: () => { arena.fx.stars(to(), 10); hit(); } });
      }
    });
  }

  // ---------- rounds ----------
  async function roundIntro() {
    renderDots();
    el.dataset.state = 'intro';
    sfx.bell();
    await banner(hud, match.round === 3 ? 'FINAL ROUND' : `ROUND ${match.round}`, { ms: 1000, small: match.round === 3 });
    if (!alive) return;
    sfx.countdown(true);
    await banner(hud, 'FIGHT!', { ms: 650, color: '#ff3d3d' });
    if (!alive) return;
    fighting = true;
    for (const f of F) f.fig.stance = true;
    el.dataset.state = 'fighting';
    cpuNext = clock + 0.8;
  }

  async function ko(winnerIdx) {
    fighting = false;
    el.dataset.state = 'ko';
    const w = F[winnerIdx], l = F[1 - winnerIdx];
    l.fig.stance = false;
    arena.slowmo(0.22, 0.9);
    arena.zoomPunch(1.2);
    const fromY = l.fig.airNow || 0; // KO'd in mid-air: fall from there instead of snapping down
    l.fig.stopAll();
    // the flop runs in slowed game time and can outlast the banner: wait for it to land, or
    // getUp() would read an upright pose and the toy would stay lying down afterwards
    const down = l.fig.flop({ fromY });
    l.fig.dizzy(3);
    arena.fx.dust(l.fig.root.position, 12);
    sfx.ko();
    await banner(hud, 'K.O.!', { ms: 1300, color: '#ff3d3d' });
    if (!alive) return;
    await down;
    if (!alive) return;
    const res = finishRound(match, winnerIdx);
    renderDots();
    if (!res.matchOver) {
      await banner(hud, `${w.toy.name.toUpperCase()} WINS THE ROUND!`, { ms: 1100, small: true });
      if (!alive) return;
      await l.fig.getUp();
      if (!alive) return;
      l.fig.dizzyUntil = 0;
      startRound(match);
      updateHud();
      await roundIntro();
    } else {
      await endMatch(winnerIdx);
    }
  }

  async function endMatch(winnerIdx) {
    el.dataset.state = 'over';
    stopMusic();
    const w = F[winnerIdx], l = F[1 - winnerIdx];
    for (const f of F) f.fig.stance = false;
    sfx.fanfare(); sfx.cheer();
    confetti(el, 80);
    arena.fx.confetti(w.fig.root.position, 60);
    arena.focusOverride = [w.fig.root.position.clone().add(new THREE.Vector3(-0.6, 0, 0)), w.fig.root.position.clone().add(new THREE.Vector3(0.6, 0, 0))];
    w.fig.victory().then(() => alive && w.fig.victory());
    l.fig.getUp().then(() => { l.fig.dizzyUntil = 0; return sleep(600); }).then(() => alive && l.fig.bow());
    const owner = !two && winnerIdx === 0 ? possessive(ownerName()) : '';
    const text = `${owner ? `${owner} ` : ''}${w.toy.name.toUpperCase()} WINS!`;
    el.dataset.winner = w.toy.id;
    hud.append(h('div', { class: 'banner small', style: { top: '24%' } }, text));
    // XP + wins for both toys
    let leveled = false;
    for (const f of F) {
      const upd = awardXp(f.toy, f.i === winnerIdx);
      leveled = leveled || (upd.leveledUp && f.i === winnerIdx);
      try { await db.updateToy(f.toy.id, { xp: upd.xp, wins: upd.wins, losses: upd.losses }); } catch (e) { console.warn('[toy-arena] xp save', e); }
    }
    if (!alive) return;
    const gain = h('div', { class: 'xpgain' }, leveled ? '🎉 LEVEL UP! ⭐⭐' : `⭐ +40 for ${w.toy.name}`);
    if (leveled) later(900, () => sfx.levelUp());
    hud.append(gain,
      h('div', { class: 'results' },
        btn({ emoji: '🔁', label: 'Again!', cls: 'green', id: 'again', onClick: () => go('battle', { ids, players, stage }, { replace: true }) }),
        btn({ emoji: '🧸', label: 'New Toys', cls: 'blue', onClick: () => go('pick', { mode: 'battle', players }, { replace: true }) }),
        btn({ emoji: '🏠', label: 'Home', cls: 'white', onClick: () => go('home', {}, { reset: true }) })));
    hud.querySelectorAll('.controls').forEach(c => { c.style.display = 'none'; });
  }

  async function pause() {
    if (paused) return;
    paused = true;
    const saved = arena.timeScale;
    arena.timeScale = 0;
    const v = await modal({ emoji: '⏸️', title: 'Paused', actions: [
      { emoji: '🏠', label: 'Quit', cls: 'white', value: 'quit' },
      { emoji: '▶️', label: 'Play', cls: 'green', value: 'play' }] });
    if (!alive) return;
    // a KO slow-mo may have ended while paused: only restore it if it's still running
    arena.timeScale = arena.slowUntil ? saved || 1 : 1;
    paused = false;
    if (v === 'quit') navBack();
  }

  // ---------- frame loop ----------
  arena.onFrame = (dt) => {
    if (paused) return;
    if (fighting) clock += dt;
    for (const f of F) f.ui.jump?.classList.toggle('cooling', fighting && clock < f.st.jumpReadyAt); // dim only while it recharges
    if (fighting && !two && clock >= cpuNext) {
      const cpu = F[1], kid = F[0];
      const d = cpuDecide(cpu.st, kid.st, { difficulty, now: clock, opponentAttacking: clock < kid.windUntil + 0.2 });
      if (d === 'block') doBlock(1);
      else if (d === 'jump') doJump(1);
      else if (d !== 'wait') doAttack(1, d);
      cpuNext = clock + cpuThinkDelay(difficulty);
    }
    // keep toys facing each other after any sidestep
    figs[0].face(figs[1].root.position.x);
    figs[1].face(figs[0].root.position.x);
  };

  // test hook: lets automated tests drive the fight without timing flakiness
  el.__battle = { F, match, doAttack, doBlock, doJump, canAct: (i) => fighting && canAct(F[i].st, clock), canJump: (i) => fighting && canJump(F[i].st, clock), state: () => el.dataset.state,
    unfreeze() { arena.timeScale = 1; },
    lying: () => F.map(f => Math.abs(f.fig.hold.lean) > 0.1 || !!f.fig.hold.limbs),
    // deterministic stepping for screenshots on slow machines: freeze real time, advance by hand
    freeze() { arena.timeScale = 0; },
    advance(sec, step = 1 / 60) { for (let t = 0; t < sec; t += step) { for (const f of figs) f.update(step); arena.fx.update(step); arena.onFrame?.(step, step); } },
    special: (i) => { F[i].st.meter = 100; doAttack(i, 'special'); } };

  updateHud();
  startMusic('battle');
  // intro: toys walk in from the sides (legless toys hop)
  figs[0].setHome(-X - 2.2, 0); figs[1].setHome(X + 2.2, 0);
  figs[0].hopTo(-X, 0, { onLand: () => sfx.step() });
  await figs[1].hopTo(X, 0, { onLand: () => sfx.step() });
  if (!alive) return () => {};
  roundIntro();

  return () => {
    alive = false;
    fighting = false;
    for (const t of timers) clearTimeout(t);
    stopMusic();
    arena.dispose();
    bag.revoke();
  };
}
