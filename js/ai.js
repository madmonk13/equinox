// Computer opponent: strategic board decisions and real-time combat control.
import { TYPES, POWER_POINTS, isPowerPoint } from './data.js';
import * as R from './rules.js';

// ---------------------------------------------------------------------------
// Board AI
// ---------------------------------------------------------------------------

const NOISE = { easy: 2.6, normal: 0.9, hard: 0.2 };

function value(p) {
  const t = TYPES[p.type];
  return t.power + (t.caster ? 8 : 0);
}

// Probability that piece A beats piece B in the arena.
export function fightOdds(aType, aHp, aBonus, bType, bHp, bBonus) {
  const strength = (type, hp, bonus, foeType) => {
    let t = TYPES[type];
    let frac = hp / t.hp;
    if (t.mimic && foeType && !TYPES[foeType].mimic) t = TYPES[foeType];
    return t.power * (frac * t.hp + bonus) / t.hp;
  };
  const sa = strength(aType, aHp, aBonus, bType);
  const sb = strength(bType, bHp, bBonus, aType);
  return 1 / (1 + Math.exp(-(sa - sb) / 1.6));
}

function oddsAt(g, a, b, x, y) {
  const lum = R.squareLum(g, x, y);
  return fightOdds(a.type, a.hp, R.lumBonus(a.side, lum), b.type, b.hp, R.lumBonus(b.side, lum));
}

// How much `p` stands to lose if it sits at (x, y) for the enemy's next turn.
function riskAt(g, p, x, y, captured = null) {
  const ox = p.x, oy = p.y;
  p.x = x; p.y = y;
  if (captured) captured.alive = false;
  let risk = 0;
  for (const e of g.pieces) {
    if (!e.alive || e.side === p.side || e.imprisoned) continue;
    if (!R.legalMoves(g, e).some((m) => m.x === x && m.y === y)) continue;
    const pe = oddsAt(g, e, p, x, y);
    risk = Math.max(risk, pe * value(p) - (1 - pe) * value(e) * 0.5);
  }
  p.x = ox; p.y = oy;
  if (captured) captured.alive = true;
  return Math.max(0, risk);
}

function ppCount(g, side) {
  return R.ppOwners(g).filter((s) => s === side).length;
}

function distToFreePP(g, side, x, y) {
  let best = 9;
  for (const [px, py] of POWER_POINTS) {
    if (R.pieceAt(g, px, py)?.side === side) continue;
    best = Math.min(best, Math.max(Math.abs(px - x), Math.abs(py - y)));
  }
  return best;
}

function scoreMove(g, p, m, side) {
  const target = R.pieceAt(g, m.x, m.y);
  const destPP = isPowerPoint(m.x, m.y);
  const fromPP = isPowerPoint(p.x, p.y);
  const myPP = ppCount(g, side) - (fromPP ? 1 : 0) + (destPP ? 1 : 0);
  const caster = TYPES[p.type].caster;
  let s = 0;
  if (target) {
    const pw = oddsAt(g, p, target, m.x, m.y);
    s += pw * value(target) - (1 - pw) * value(p);
    if (destPP) s += pw * 4;
    if (destPP && myPP === 5) s += pw * 300;
    if (isPowerPoint(m.x, m.y) && ppCount(g, R.opp(side)) >= 4) s += pw * 25;
    s -= 0.8;
    s -= pw * 0.5 * riskAt(g, p, m.x, m.y, target);
  } else {
    if (destPP) s += 5 + (myPP === 5 ? 1000 : 0);
    if (fromPP) s -= 5.5;
    s += riskAt(g, p, p.x, p.y) - riskAt(g, p, m.x, m.y);
    s += 0.25 * (R.lumBonus(side, R.squareLum(g, m.x, m.y)) - R.lumBonus(side, R.squareLum(g, p.x, p.y)));
    if (caster) s -= 0.6;
    else s += 0.35 * (distToFreePP(g, side, p.x, p.y) - distToFreePP(g, side, m.x, m.y));
  }
  return s;
}

function spellActions(g, side) {
  const out = [];
  const avail = R.availableSpells(g, side);
  const mine = g.pieces.filter((p) => p.alive && p.side === side);
  const at = (t) => R.pieceAt(g, t.x, t.y);

  for (const spell of avail) {
    if (spell === 'heal') {
      for (const t of R.spellTargets(g, side, 'heal')) {
        const p = at(t);
        const frac = p.hp / R.maxHp(p);
        if (frac < 0.5) out.push({ kind: 'spell', spell, target: p, score: (1 - frac) * value(p) * 0.9 - 3 });
      }
    } else if (spell === 'imprison') {
      for (const t of R.spellTargets(g, side, 'imprison')) {
        const p = at(t);
        const rounds = Math.min(R.roundsUntilRelease(g, p.side), 6);
        const threat = mine.some((m) => R.legalMoves(g, p).some((mv) => mv.x === m.x && mv.y === m.y)) ? 2 : 0;
        out.push({ kind: 'spell', spell, target: p, score: value(p) * (rounds / 6) * 0.8 + threat - 3.5 });
      }
    } else if (spell === 'summon') {
      for (const t of R.spellTargets(g, side, 'summon')) {
        const p = at(t);
        const lum = R.squareLum(g, p.x, p.y);
        const pw = fightOdds('elem_earth', 14, 0, p.type, p.hp, R.lumBonus(p.side, lum));
        out.push({ kind: 'spell', spell, target: p, score: pw * value(p) - 3.5 });
      }
    } else if (spell === 'revive') {
      const best = R.reviveCandidates(g, side).sort((a, b) => value(b) - value(a))[0];
      const sq = R.reviveSquares(g, side)[0];
      if (best && sq) out.push({ kind: 'spell', spell, reviveId: best.id, x: sq.x, y: sq.y, score: value(best) - 4 });
    } else if (spell === 'shift') {
      const unfavorable = side === 'light' ? g.lumDir < 0 && g.lumPhase <= 3 : g.lumDir > 0 && g.lumPhase >= 2;
      if (unfavorable) out.push({ kind: 'spell', spell, score: 1.2 });
    } else if (spell === 'teleport') {
      // Snatch the final power point if one is open.
      if (ppCount(g, side) === 4) {
        const free = POWER_POINTS.find(([x, y]) => !R.pieceAt(g, x, y));
        const mover = R.spellTargets(g, side, 'teleport').map(at).find((p) => !p.imprisoned);
        if (free && mover) out.push({ kind: 'spell', spell, target: mover, x: free[0], y: free[1], score: 900 });
      }
    }
  }
  return out;
}

export function chooseBoardAction(g, side, difficulty = 'normal') {
  const noise = NOISE[difficulty] ?? 1;
  let best = null;
  const consider = (a) => {
    a.score += (Math.random() - 0.5) * 2 * noise;
    if (!best || a.score > best.score) best = a;
  };
  for (const p of g.pieces) {
    if (!p.alive || p.side !== side) continue;
    for (const m of R.legalMoves(g, p)) {
      consider({ kind: 'move', piece: p, x: m.x, y: m.y, score: scoreMove(g, p, m, side) });
    }
  }
  if (difficulty !== 'easy' || Math.random() < 0.5) spellActions(g, side).forEach(consider);
  return best;
}

// ---------------------------------------------------------------------------
// Combat AI
// ---------------------------------------------------------------------------

const LEVEL = {
  easy: { react: 0.32, tol: 0.22, lead: 0, dodge: 0.25, hesitate: 0.35 },
  normal: { react: 0.17, tol: 0.14, lead: 0.6, dodge: 0.6, hesitate: 0.12 },
  hard: { react: 0.07, tol: 0.09, lead: 1, dodge: 0.92, hesitate: 0 },
};

const TAU = Math.PI * 2;
const snapAngle = (a) => Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return Math.abs(d); };

// Direction toward the nearest open spot on one of the foe's 8 compass lines, ~`want` px away.
function lineUp(me, foe, arena, want, pad, needLOS) {
  let best = null, bestS = Infinity;
  for (const rad of [want, want * 0.7, want * 1.3, 140]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const cx = foe.x - Math.cos(a) * rad, cy = foe.y - Math.sin(a) * rad;
      if (arena.blocked(cx, cy, me.r + 4)) continue;
      let s = Math.hypot(cx - me.x, cy - me.y) + Math.abs(rad - want) * 0.5;
      if (needLOS && !arena.clearShot(cx, cy, foe.x, foe.y, pad)) s += 400;
      if (s < bestS) { bestS = s; best = [cx, cy]; }
    }
  }
  if (!best) {
    const d = Math.hypot(foe.x - me.x, foe.y - me.y) || 1;
    return [(foe.x - me.x) / d, (foe.y - me.y) / d];
  }
  const mx = best[0] - me.x, my = best[1] - me.y, md = Math.hypot(mx, my);
  return md > 8 ? [mx / md, my / md] : [0, 0];
}

// Sets me.input = { x, y, fire, face } based on the arena state.
export function combatAI(me, foe, arena, dt, difficulty = 'normal') {
  const L = LEVEL[difficulty] || LEVEL.normal;
  const ai = me.ai;
  ai.t -= dt;
  if (ai.t > 0) return;
  ai.t = L.react * (0.6 + Math.random() * 0.8);

  const w = me.def.weapon;
  const dx = foe.x - me.x, dy = foe.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  let gx = 0, gy = 0; // desired movement
  let fire = false, face = null;

  // Dodge incoming projectiles.
  let ddx = 0, ddy = 0;
  if (Math.random() < L.dodge) {
    for (const p of arena.projectiles) {
      if (p.owner === me) continue;
      const rx = me.x - p.x, ry = me.y - p.y;
      const sp2 = p.vx * p.vx + p.vy * p.vy;
      const tca = (rx * p.vx + ry * p.vy) / sp2;
      if (tca < 0 || tca > 0.8) continue;
      const cx = p.x + p.vx * tca - me.x, cy = p.y + p.vy * tca - me.y;
      if (Math.hypot(cx, cy) > me.r + p.r + 14) continue;
      let px = -p.vy, py = p.vx;
      const n = Math.hypot(px, py);
      px /= n; py /= n;
      if (px * -cx + py * -cy < 0) { px = -px; py = -py; }
      ddx += px * (1.5 - tca);
      ddy += py * (1.5 - tca);
    }
  }

  // Get away from an active enemy aura (unless we're invulnerable ourselves).
  const fw = foe.def.weapon;
  if (fw.kind === 'aura' && foe.auraT > 0 && dist < fw.radius + 70 && !(me.auraT > 0 && w.invuln)) {
    gx -= (dx / dist) * 2; gy -= (dy / dist) * 2;
  }

  if (w.kind === 'melee') {
    const reach = me.r + foe.r + w.range;
    gx += dx / dist; gy += dy / dist;
    if (dist < reach - 2) {
      const a = Math.atan2(dy, dx);
      face = snapAngle(a);
      fire = me.cd <= 0;
      gx *= 0.3; gy *= 0.3;
    }
  } else if (w.kind === 'aura') {
    if (me.auraT > 0) { gx += dx / dist; gy += dy / dist; }
    else if (me.cd <= 0) {
      gx += dx / dist; gy += dy / dist;
      if (dist < w.radius * 0.8 + foe.r) fire = true;
    } else if (dist < 260) { gx -= dx / dist; gy -= dy / dist; }
  } else if (w.kind === 'charge') {
    // Charge: line up on a compass line within dash range, then lunge.
    const reach = w.dash * w.dur + me.r + foe.r;
    const aim = Math.atan2(dy, dx);
    const snapped = snapAngle(aim);
    const lane = w.over || arena.clearShot(me.x, me.y, foe.x, foe.y, me.r * 0.6);
    if (me.cd <= 0 && dist < reach * 0.95 && angDiff(aim, snapped) < L.tol * 1.4 && lane) {
      fire = true;
      face = snapped;
    }
    const [mx, my] = lineUp(me, foe, arena, reach * 0.65, me.r * 0.6, !w.over);
    gx += mx; gy += my;
    if (me.cd > 0.3 && dist < 110) { gx -= dx / dist; gy -= dy / dist; }
  } else {
    // Ranged: get onto one of the 8 firing lines at a comfortable distance.
    const tLead = (dist / w.speed) * L.lead;
    const tx = foe.x + foe.vx * tLead, ty = foe.y + foe.vy * tLead;
    const aim = Math.atan2(ty - me.y, tx - me.x);
    const snapped = snapAngle(aim);
    const range = w.speed * w.life * (w.returns ? 1 : 0.9);
    const clear = w.pierce || arena.clearShot(me.x, me.y, tx, ty, w.r);
    if (angDiff(aim, snapped) < L.tol + (w.count ? 0.08 : 0) && me.cd <= 0 && clear && dist < range + foe.r) {
      fire = true;
      face = snapped;
    }
    if (w.stomp && me.cd <= 0 && dist <= me.r + foe.r + w.stomp.range) {
      fire = true;
      face = snapped;
    }
    const want = Math.min(Math.max(dist, 170), 300, range * 0.8);
    const [mx, my] = lineUp(me, foe, arena, want, w.r, !w.pierce);
    gx += mx; gy += my;
    // Keep clear of melee brutes while reloading.
    if ((fw.kind === 'melee' || fw.kind === 'charge') && dist < 140 && me.cd > 0.2) { gx -= (dx / dist) * 1.5; gy -= (dy / dist) * 1.5; }
  }

  // Break stalemates: if we haven't attacked in a while, close in.
  ai.idle = (ai.idle || 0) + (ai.lastThink ? arena.t - ai.lastThink : 0);
  ai.lastThink = arena.t;
  if (ai.idle > 3.5) { gx += (dx / dist) * 1.2; gy += (dy / dist) * 1.2; }

  gx += ddx * 1.6; gy += ddy * 1.6;
  if (fire && Math.random() < L.hesitate) fire = false;
  if (fire) ai.idle = 0;

  // Steer around obstacles: pick the open direction closest to the desired one.
  let mx = 0, my = 0;
  const gl = Math.hypot(gx, gy);
  if (gl > 0.05) {
    const want = Math.atan2(gy, gx);
    let bestA = null, bestScore = -Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k * TAU) / 16;
      const score = Math.cos(a - want) - (!me.def.phase && arena.blocked(me.x + Math.cos(a) * 34, me.y + Math.sin(a) * 34, me.r) ? 3 : 0);
      if (score > bestScore) { bestScore = score; bestA = a; }
    }
    mx = Math.cos(bestA); my = Math.sin(bestA);
  }
  me.input = { x: mx, y: my, fire, face };
}
