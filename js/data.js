// Static game data: board geometry, piece types, spells.

export const SIZE = 9;

// The five power points: both spellcasters' home squares, top, bottom and center.
export const POWER_POINTS = [[0, 4], [4, 0], [4, 4], [4, 8], [8, 4]];
export const isPowerPoint = (x, y) => POWER_POINTS.some(([px, py]) => px === x && py === y);

// Square kinds: 'L' always light, 'D' always dark, 'C' cycles with the luminance cycle.
// The light half is a checkerboard; the dark half mirrors it with colors flipped;
// the center column and a diamond around the middle cycle.
export const SQUARE_KIND = (() => {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = [];
    for (let x = 0; x < SIZE; x++) {
      const mx = Math.min(x, SIZE - 1 - x);
      const d = Math.abs(x - 4) + Math.abs(y - 4);
      if (x === 4 || (d <= 3 && (mx + y) % 2 === 1)) row.push('C');
      else if (x < 4) row.push((mx + y) % 2 === 0 ? 'L' : 'D');
      else row.push((mx + y) % 2 === 0 ? 'D' : 'L');
    }
    rows.push(row);
  }
  return rows;
})();

export const LUM_MAX = 5;

// mode: ground (orthogonal steps, blocked by pieces), fly (any direction, over pieces),
// teleport (any square within range).
// icon: glyph name in icons.js.
// power: combat rating used by the AI to estimate fights, fitted to simulated duels.
// weapon kinds: melee (short arc), shot (projectile), aura (field around the caster),
// charge (dash that hits on contact).
export const TYPES = {
  // ---- Light ----
  knight: {
    name: 'Knight', side: 'light', icon: 'knight', hp: 5, move: 3, mode: 'ground', speed: 200, r: 20, power: 2.9,
    weapon: { kind: 'melee', name: 'Sword', dmg: 5, cd: 0.4, range: 38, arc: 0.45, color: '#ffe9a8' },
  },
  archer: {
    name: 'Archer', side: 'light', icon: 'archer', hp: 5, move: 3, mode: 'ground', speed: 160, r: 20, power: 5.1,
    weapon: { kind: 'shot', name: 'Longbow', dmg: 5, cd: 0.95, speed: 430, r: 5, life: 1.8, style: 'arrow', color: '#fff3c4' },
  },
  valkyrie: {
    name: 'Valkyrie', side: 'light', icon: 'valkyrie', hp: 8, move: 3, mode: 'fly', speed: 175, r: 21, power: 7.4,
    weapon: { kind: 'shot', name: 'Returning Spear', dmg: 6, cd: 0.25, speed: 400, r: 7, life: 0.75, style: 'spear', color: '#bfefff', returns: true },
  },
  giant: {
    name: 'Giant', side: 'light', icon: 'giant', hp: 15, move: 3, mode: 'ground', speed: 100, r: 28, power: 9.1,
    weapon: { kind: 'shot', name: 'Boulder & Stomp', dmg: 10, cd: 1.7, speed: 230, r: 13, life: 3, style: 'boulder', color: '#d9c7a3', stomp: { range: 34, dmg: 5, push: 90 } },
  },
  cavalier: {
    name: 'Cavalier', side: 'light', icon: 'cavalier', hp: 9, move: 4, mode: 'ground', speed: 180, r: 23, power: 6.7, shield: 0.5,
    weapon: { kind: 'charge', name: 'Lance Charge', dmg: 7, cd: 1.1, dash: 560, dur: 0.32, color: '#fff1c9' },
  },
  griffin: {
    name: 'Griffin', side: 'light', icon: 'griffin', hp: 11, move: 4, mode: 'fly', speed: 210, r: 23, power: 7.8,
    weapon: { kind: 'charge', name: 'Diving Talons', dmg: 6, cd: 0.9, dash: 620, dur: 0.34, color: '#ffe3a1', over: true },
  },
  phoenix: {
    name: 'Phoenix', side: 'light', icon: 'phoenix', hp: 15, move: 5, mode: 'fly', speed: 165, r: 23, power: 8.8,
    weapon: { kind: 'aura', name: 'Fire Burst', dmg: 2, tick: 0.16, radius: 105, dur: 1.2, cd: 2.2, invuln: true, color: '#ff8a2a' },
  },
  archmage: {
    name: 'Archmage', side: 'light', icon: 'archmage', hp: 10, move: 3, mode: 'teleport', speed: 170, r: 21, power: 8.8, caster: true,
    weapon: { kind: 'shot', name: 'Fireball', dmg: 10, cd: 1.5, speed: 340, r: 10, life: 2.2, style: 'fireball', color: '#ffb347' },
  },

  // ---- Dark ----
  orc: {
    name: 'Orc', side: 'dark', icon: 'orc', hp: 8, move: 3, mode: 'ground', speed: 185, r: 21, power: 3.3,
    weapon: { kind: 'melee', name: 'Cleaver', dmg: 4, cd: 0.45, range: 36, arc: 0.1, color: '#d6a2ff' },
  },
  goblin: {
    name: 'Goblin', side: 'dark', icon: 'goblin', hp: 6, move: 3, mode: 'ground', speed: 215, r: 18, power: 5.8,
    weapon: { kind: 'shot', name: 'Javelins', dmg: 3, cd: 0.45, speed: 520, r: 4, life: 0.62, style: 'javelin', color: '#ffd0a8' },
  },
  troll: {
    name: 'Troll', side: 'dark', icon: 'troll', hp: 14, move: 3, mode: 'ground', speed: 105, r: 27, power: 8, regen: 0.6,
    weapon: { kind: 'shot', name: 'Boulder', dmg: 10, cd: 1.7, speed: 230, r: 13, life: 3, style: 'boulder', color: '#9aa383' },
  },
  banshee: {
    name: 'Banshee', side: 'dark', icon: 'banshee', hp: 8, move: 3, mode: 'fly', speed: 205, r: 21, power: 7.1,
    weapon: { kind: 'aura', name: 'Wail', dmg: 1, tick: 0.11, radius: 110, dur: 1.8, cd: 1.7, slow: 0.55, color: '#c9d2ff' },
  },
  manticore: {
    name: 'Manticore', side: 'dark', icon: 'manticore', hp: 9, move: 3, mode: 'ground', speed: 165, r: 22, power: 7.4,
    weapon: { kind: 'shot', name: 'Tail Spikes', dmg: 4, cd: 1.15, speed: 420, r: 5, life: 1.6, style: 'spike', color: '#ff6b7d', count: 3, spread: 0.3 },
  },
  doppelganger: {
    name: 'Doppelgänger', side: 'dark', icon: 'doppelganger', hp: 10, move: 5, mode: 'fly', speed: 170, r: 22, power: 7, mimic: true,
    weapon: { kind: 'melee', name: 'Mimicry', dmg: 5, cd: 0.45, range: 30, arc: 0.45, color: '#e0b3ff' },
  },
  dragon: {
    name: 'Dragon', side: 'dark', icon: 'dragon', hp: 16, move: 4, mode: 'fly', speed: 135, r: 28, power: 8.4,
    weapon: { kind: 'shot', name: 'Fire Breath', dmg: 3, cd: 1.5, speed: 430, r: 9, life: 0.45, style: 'flame', color: '#ff5a36', count: 5, spread: 0.17 },
  },
  necromancer: {
    name: 'Necromancer', side: 'dark', icon: 'necromancer', hp: 10, move: 3, mode: 'teleport', speed: 170, r: 21, power: 8.2, caster: true,
    weapon: { kind: 'shot', name: 'Soul Bolt', dmg: 8, cd: 1.3, speed: 600, r: 7, life: 1.4, style: 'lightning', color: '#9effc4', drain: 2 },
  },

  // ---- Summoned (side assigned at summon time) ----
  elem_air: {
    name: 'Air Elemental', icon: 'elem_air', hp: 12, speed: 200, r: 23, power: 7, elemental: true,
    weapon: { kind: 'shot', name: 'Gale', dmg: 5, cd: 0.9, speed: 300, r: 14, life: 2.4, style: 'whirl', color: '#d8f6ff' },
  },
  elem_earth: {
    name: 'Earth Elemental', icon: 'elem_earth', hp: 17, speed: 110, r: 28, power: 8, elemental: true,
    weapon: { kind: 'shot', name: 'Rockslide', dmg: 9, cd: 1.5, speed: 240, r: 14, life: 3, style: 'boulder', color: '#b59b74' },
  },
  elem_fire: {
    name: 'Fire Elemental', icon: 'elem_fire', hp: 10, speed: 190, r: 23, power: 8, elemental: true,
    weapon: { kind: 'shot', name: 'Flame', dmg: 8, cd: 1.1, speed: 360, r: 11, life: 2, style: 'fireball', color: '#ff7a2a' },
  },
  elem_water: {
    name: 'Water Elemental', icon: 'elem_water', hp: 14, speed: 160, r: 25, power: 8, elemental: true,
    weapon: { kind: 'shot', name: 'Tidal Wave', dmg: 6, cd: 1.0, speed: 360, r: 12, life: 2.2, style: 'wave', color: '#5cc8ff' },
  },
  wraith: {
    name: 'Wraith', icon: 'wraith', hp: 12, speed: 185, r: 22, power: 8, elemental: true, phase: true,
    weapon: { kind: 'shot', name: 'Soul Shards', dmg: 6, cd: 0.95, speed: 380, r: 7, life: 1.8, style: 'shard', color: '#bfffdc', pierce: true },
  },
};

export const ELEMENTALS = ['elem_air', 'elem_earth', 'elem_fire', 'elem_water'];

export const SETUP = {
  light: [
    { x: 0, types: ['valkyrie', 'giant', 'cavalier', 'griffin', 'archmage', 'phoenix', 'cavalier', 'giant', 'valkyrie'] },
    { x: 1, types: ['archer', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'archer'] },
  ],
  dark: [
    { x: 8, types: ['manticore', 'troll', 'banshee', 'doppelganger', 'necromancer', 'dragon', 'banshee', 'troll', 'manticore'] },
    { x: 7, types: ['goblin', 'orc', 'orc', 'orc', 'orc', 'orc', 'orc', 'orc', 'goblin'] },
  ],
};

// `dark` overrides the name/description for the Dark side's version of a spell.
export const SPELLS = {
  teleport: { name: 'Teleport', icon: 'teleport', desc: 'Move one of your pieces to any square — onto an enemy to start a battle.' },
  heal: { name: 'Heal', icon: 'heal', desc: 'Restore one of your pieces to full strength.' },
  shift: { name: 'Shift Time', icon: 'shift', desc: 'Reverse the direction of the luminance cycle.' },
  exchange: { name: 'Exchange', icon: 'exchange', desc: 'Swap the positions of any two pieces.' },
  summon: {
    name: 'Summon Elemental', icon: 'summon', desc: 'Call an elemental to battle an enemy piece. It vanishes afterward.',
    dark: { name: 'Raise Wraith', desc: 'Raise a wraith that drifts through walls to battle an enemy piece. It fades afterward.' },
  },
  revive: { name: 'Revive', icon: 'revive', desc: 'Return a fallen piece to a square beside your spellcaster.' },
  imprison: { name: 'Imprison', icon: 'imprison', desc: 'Freeze an enemy piece until the luminance cycle turns in its favor.' },
};

export function spellInfo(key, side) {
  const s = SPELLS[key];
  return { ...s, ...(s[side] || {}) };
}

export const MODE_LABEL = { ground: 'Ground', fly: 'Flying', teleport: 'Teleport' };
