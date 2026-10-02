// Board rules: game state, movement, luminance cycle, spells, victory.
import { SIZE, TYPES, SETUP, POWER_POINTS, SQUARE_KIND, LUM_MAX, ELEMENTALS, isPowerPoint } from './data.js';

export const opp = (side) => (side === 'light' ? 'dark' : 'light');
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const inBounds = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

export function createGame() {
  const pieces = [];
  let id = 0;
  for (const side of ['light', 'dark']) {
    for (const col of SETUP[side]) {
      col.types.forEach((type, y) => {
        pieces.push({ id: id++, type, side, x: col.x, y, hp: TYPES[type].hp, alive: true, imprisoned: false });
      });
    }
  }
  return {
    pieces,
    turn: 'light',
    round: 1,
    lumPhase: 3,
    lumDir: -1,
    spellsUsed: { light: [], dark: [] },
    winner: null,
  };
}

export const maxHp = (p) => TYPES[p.type].hp;

export function pieceAt(g, x, y) {
  for (const p of g.pieces) if (p.alive && p.x === x && p.y === y) return p;
  return null;
}

function occupancy(g) {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (const p of g.pieces) if (p.alive) grid[p.y][p.x] = p;
  return grid;
}

// 0 = darkest, LUM_MAX = brightest.
export function squareLum(g, x, y) {
  const k = SQUARE_KIND[y][x];
  return k === 'L' ? LUM_MAX : k === 'D' ? 0 : g.lumPhase;
}

// Extra combat hit points a side gets from the luminance of the battle square.
export function lumBonus(side, lum) {
  return Math.round((side === 'light' ? lum : LUM_MAX - lum) * 0.8);
}

export function legalMoves(g, p) {
  if (!p.alive || p.imprisoned) return [];
  const t = TYPES[p.type];
  const grid = occupancy(g);
  const out = [];
  if (t.mode === 'ground') {
    const seen = new Set([p.y * SIZE + p.x]);
    let frontier = [[p.x, p.y]];
    for (let step = 1; step <= t.move; step++) {
      const next = [];
      for (const [cx, cy] of frontier) {
        for (const [dx, dy] of ORTHO) {
          const nx = cx + dx, ny = cy + dy;
          if (!inBounds(nx, ny) || seen.has(ny * SIZE + nx)) continue;
          seen.add(ny * SIZE + nx);
          const o = grid[ny][nx];
          if (!o) { out.push({ x: nx, y: ny, attack: false }); next.push([nx, ny]); }
          else if (o.side !== p.side) out.push({ x: nx, y: ny, attack: true });
        }
      }
      frontier = next;
    }
  } else {
    for (let dy = -t.move; dy <= t.move; dy++) {
      for (let dx = -t.move; dx <= t.move; dx++) {
        if (!dx && !dy) continue;
        const nx = p.x + dx, ny = p.y + dy;
        if (!inBounds(nx, ny)) continue;
        const o = grid[ny][nx];
        if (o && o.side === p.side) continue;
        out.push({ x: nx, y: ny, attack: !!o });
      }
    }
  }
  return out;
}

export function activeMage(g, side) {
  return g.pieces.find((p) => p.alive && p.side === side && TYPES[p.type].caster && !p.imprisoned) || null;
}

// Number of round advances until the cycle reaches the extreme favoring `side`.
export function roundsUntilRelease(g, side) {
  const target = side === 'light' ? LUM_MAX : 0;
  let phase = g.lumPhase, dir = g.lumDir;
  for (let i = 0; i <= 2 * LUM_MAX + 1; i++) {
    if (phase === target) return i;
    [phase, dir] = stepLum(phase, dir);
  }
  return Infinity;
}

function stepLum(phase, dir) {
  phase += dir;
  if (phase > LUM_MAX) { phase = LUM_MAX - 1; dir = -1; }
  if (phase < 0) { phase = 1; dir = 1; }
  return [phase, dir];
}

const notOnPP = (p) => !isPowerPoint(p.x, p.y);
const alivePieces = (g) => g.pieces.filter((p) => p.alive);
const xy = (p) => ({ x: p.x, y: p.y });

export function reviveCandidates(g, side) {
  const seen = new Set();
  return g.pieces.filter((p) => {
    if (p.alive || p.side !== side || TYPES[p.type].caster || seen.has(p.type)) return false;
    seen.add(p.type);
    return true;
  });
}

export function reviveSquares(g, side) {
  const mage = activeMage(g, side);
  if (!mage) return [];
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = mage.x + dx, y = mage.y + dy;
    if ((dx || dy) && inBounds(x, y) && !pieceAt(g, x, y)) out.push({ x, y });
  }
  return out;
}

// Valid target squares for a spell at a given step. Pieces on power points are immune to spells.
export function spellTargets(g, side, spell, step = 0, data = {}) {
  const all = alivePieces(g);
  const mine = all.filter((p) => p.side === side);
  const foes = all.filter((p) => p.side !== side);
  switch (spell) {
    case 'teleport':
      if (step === 0) return mine.filter((p) => notOnPP(p) && !p.imprisoned).map(xy);
      {
        const out = [];
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
          const o = pieceAt(g, x, y);
          if (!o || (o.side !== side && !isPowerPoint(x, y))) out.push({ x, y });
        }
        return out;
      }
    case 'heal':
      return mine.filter((p) => notOnPP(p) && p.hp < maxHp(p)).map(xy);
    case 'exchange':
      if (step === 0) return all.filter(notOnPP).map(xy);
      return all.filter((p) => notOnPP(p) && p !== data.a).map(xy);
    case 'summon':
      return foes.filter(notOnPP).map(xy);
    case 'imprison':
      return foes.filter((p) => notOnPP(p) && !p.imprisoned && roundsUntilRelease(g, p.side) > 0).map(xy);
    case 'revive':
      return reviveSquares(g, side);
    default:
      return [];
  }
}

export function availableSpells(g, side) {
  if (!activeMage(g, side)) return [];
  const used = g.spellsUsed[side];
  return ['teleport', 'heal', 'shift', 'exchange', 'summon', 'revive', 'imprison'].filter((s) => {
    if (used.includes(s)) return false;
    if (s === 'shift') return true;
    if (s === 'revive') return reviveCandidates(g, side).length > 0 && reviveSquares(g, side).length > 0;
    if (s === 'exchange') return spellTargets(g, side, s).length >= 2;
    return spellTargets(g, side, s).length > 0;
  });
}

export function shiftTime(g) {
  g.lumDir *= -1;
}

export function randomElemental() {
  return ELEMENTALS[Math.floor(Math.random() * ELEMENTALS.length)];
}

export function hasAnyAction(g, side) {
  if (availableSpells(g, side).length) return true;
  return g.pieces.some((p) => p.alive && p.side === side && legalMoves(g, p).length > 0);
}

export function ppOwners(g) {
  return POWER_POINTS.map(([x, y]) => pieceAt(g, x, y)?.side || null);
}

export function checkWinner(g) {
  const light = g.pieces.some((p) => p.alive && p.side === 'light');
  const dark = g.pieces.some((p) => p.alive && p.side === 'dark');
  if (!light && !dark) return 'draw';
  if (!light) return 'dark';
  if (!dark) return 'light';
  const owners = ppOwners(g);
  if (owners.every((s) => s === 'light')) return 'light';
  if (owners.every((s) => s === 'dark')) return 'dark';
  return null;
}

// Pass the turn. Returns a list of log messages.
export function endTurn(g) {
  const events = [];
  g.turn = opp(g.turn);
  if (g.turn === 'light') {
    g.round++;
    [g.lumPhase, g.lumDir] = stepLum(g.lumPhase, g.lumDir);
    for (const p of g.pieces) {
      if (!p.alive || !p.imprisoned) continue;
      if ((p.side === 'light' && g.lumPhase === LUM_MAX) || (p.side === 'dark' && g.lumPhase === 0)) {
        p.imprisoned = false;
        events.push(`${TYPES[p.type].name} breaks free of its prison.`);
      }
    }
  }
  // Wounds heal slowly over time, and instantly on power points.
  for (const p of g.pieces) {
    if (!p.alive || p.side !== g.turn || p.hp >= maxHp(p)) continue;
    if (isPowerPoint(p.x, p.y)) p.hp = maxHp(p);
    else if (g.round % 2 === 0) p.hp++;
  }
  return events;
}
