// "Pieces" tab of How to play: one piece at a time, with a live arena preview of its attack,
// a description and its board reach. Everything is generated from TYPES.
import { TYPES, MODE_LABEL } from './data.js';
import { iconSVG } from './icons.js';
import { ArenaDemo } from './combat.js';

const COLOR = { light: '#ffd166', dark: '#a979ff' };

export function traitNotes(t) {
  const w = t.weapon, notes = [];
  if (w.returns) notes.push('Spear returns to her hand');
  if (w.stomp) notes.push('Stomps foes underfoot');
  if (t.shield) notes.push('Shield halves frontal shots');
  if (t.regen) notes.push('Regenerates in battle');
  if (w.slow) notes.push('Wail slows enemies');
  if (w.drain) notes.push('Drains life on hit');
  if (w.over) notes.push('Dives over pillars');
  if (w.invuln) notes.push('Invulnerable while burning');
  if (t.phase) notes.push('Drifts through pillars');
  if (w.pierce) notes.push('Shots pass through pillars');
  if (t.mimic) notes.push('Becomes a copy of its opponent');
  if (t.caster) notes.push('Spellcaster');
  return notes;
}

// How far an attack reaches in arena pixels, measured from the attacker's edge.
function reach(t) {
  const w = t.weapon;
  if (w.kind === 'melee') return w.range;
  if (w.kind === 'aura') return w.radius - t.r;
  if (w.kind === 'charge') return w.dash * w.dur;
  return w.speed * w.life;
}

function rangeWord(px) {
  if (px <= 90) return 'close';
  if (px <= 260) return 'short';
  if (px <= 480) return 'medium';
  return 'long';
}

function describe(t) {
  const w = t.weapon;
  if (t.mimic) return 'Takes on the form, health and attack of whatever it fights.';
  const r = rangeWord(reach(t));
  switch (w.kind) {
    case 'melee':
      return `<b>${w.name}</b> — ${w.arc < 0.3 ? 'wide sweeping' : 'quick'} ${r}-range swing for ${w.dmg} damage, every ${w.cd}s.`;
    case 'charge':
      return `<b>${w.name}</b> — a ${r}-range dash forward that strikes on contact for ${w.dmg} damage. Recharges in ${w.cd}s.`;
    case 'aura':
      return `<b>${w.name}</b> — a ${w.dur}s blast around itself dealing ${w.dmg} damage every ${w.tick}s to anything inside. Recharges in ${w.cd}s.`;
    default: {
      const n = w.count || 1;
      const what = n > 1 ? `a ${n}-shot spread, ${w.dmg} damage each` : `${w.dmg} damage`;
      const stomp = w.stomp ? ` Up close it stomps instead: ${w.stomp.dmg} damage and a knockback.` : '';
      const reload = w.returns ? 'thrown again once it flies back' : `reload ${w.cd}s`;
      return `<b>${w.name}</b> — ${r}-range ${w.returns ? 'throw' : 'shot'}, ${what}, ${reload}.${stomp}`;
    }
  }
}

// 11×11 grid showing which squares the piece can reach from the middle of an open board.
function boardReach(t, side) {
  if (!t.mode) return '';
  const N = 11, c = 5, cell = 9;
  let cells = '';
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = Math.abs(x - c), dy = Math.abs(y - c);
      const reachable = t.mode === 'ground' ? dx + dy <= t.move : Math.max(dx, dy) <= t.move;
      const fill = x === c && y === c ? COLOR[side] : reachable ? `${COLOR[side]}66` : 'rgba(255,255,255,0.05)';
      cells += `<rect x="${x * cell + 0.5}" y="${y * cell + 0.5}" width="${cell - 1}" height="${cell - 1}" rx="1.5" fill="${fill}"/>`;
    }
  }
  const s = N * cell;
  return `<figure><svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">${cells}</svg>
    <figcaption>${MODE_LABEL[t.mode]} ${t.move}${t.mode === 'ground' ? ' · blocked by pieces' : ''}</figcaption></figure>`;
}

const KEYS = Object.keys(TYPES);
const ORDER = [
  ...KEYS.filter((k) => TYPES[k].side === 'light'),
  ...KEYS.filter((k) => TYPES[k].side === 'dark'),
  ...KEYS.filter((k) => TYPES[k].elemental),
];
const sideOf = (k) => TYPES[k].side || (k === 'wraith' ? 'dark' : 'light');
const groupOf = (k) => (TYPES[k].elemental ? 'Summoned' : TYPES[k].side === 'light' ? 'Light' : 'Dark');

let index = 0;
let demo = null;
let built = false;

function info(key, formDef = null) {
  const t = TYPES[key], side = sideOf(key), w = t.weapon;
  const tags = traitNotes(t).map((n) => `<span class="tag">${n}</span>`).join('');
  const stats = t.mode ? `${t.hp} HP · ${MODE_LABEL[t.mode]} ${t.move}` : `${t.hp} HP · summoned for one battle`;
  const reload = t.mimic ? 'matches its copy' : w.returns ? 'when the spear returns'
    : `${w.kind === 'aura' || w.kind === 'charge' ? +(w.cd + w.dur).toFixed(2) : w.cd}s`;
  const copying = formDef ? `<p class="viewer-form">Now copying: <b>${formDef.name}</b></p>` : '';
  return `<header class="info-head ${side}"><span class="info-icon">${iconSVG(t.icon)}</span>
      <div><div class="info-name">${t.name}</div><div class="info-side">${groupOf(key)} · ${stats}</div></div></header>
    <div class="viewer-body"><p>${describe(t)}</p>${copying}
    <dl class="stats">
      <dt>Arena speed</dt><dd>${t.speed >= 190 ? 'Fast' : t.speed <= 120 ? 'Slow' : 'Average'}</dd>
      <dt>Range</dt><dd>${t.mimic ? 'Varies' : rangeWord(reach(t)).replace(/^./, (c) => c.toUpperCase())}</dd>
      <dt>Reload</dt><dd>${reload}</dd>
    </dl>
    ${tags ? `<div class="tags">${tags}</div>` : ''}</div>
    <div class="viewer-reach">${boardReach(t, side)}</div>`;
}

function show(i) {
  index = (i + ORDER.length) % ORDER.length;
  const key = ORDER[index];
  const side = sideOf(key);
  demo?.stop();
  const forms = TYPES[key].mimic ? KEYS.filter((k) => TYPES[k].side === 'light') : [];
  const panel = document.getElementById('viewer-info');
  panel.innerHTML = info(key);
  demo = new ArenaDemo(document.getElementById('viewer-canvas'), key, side, {
    forms, onForm: (def) => { panel.innerHTML = info(key, def); },
  }).start();
  document.getElementById('viewer-count').textContent = `${groupOf(key)} · ${index + 1} / ${ORDER.length}`;
  document.querySelectorAll('#viewer-strip button').forEach((b, j) => {
    b.classList.toggle('on', j === index);
    b.setAttribute('aria-selected', j === index);
  });
  document.querySelector('#viewer-strip button.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function startGuide() {
  if (!built) {
    built = true;
    const strip = document.getElementById('viewer-strip');
    strip.innerHTML = ORDER.map((k, i) => {
      const gap = i > 0 && groupOf(k) !== groupOf(ORDER[i - 1]) ? ' gap' : '';
      return `<button class="chip ${sideOf(k)}${gap}" role="tab" title="${TYPES[k].name}">${iconSVG(TYPES[k].icon)}</button>`;
    }).join('');
    strip.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => show(i)));
    document.getElementById('viewer-prev').addEventListener('click', () => show(index - 1));
    document.getElementById('viewer-next').addEventListener('click', () => show(index + 1));
    window.addEventListener('keydown', (e) => {
      if (!demo?.running) return;
      if (e.key === 'ArrowLeft') { show(index - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { show(index + 1); e.preventDefault(); }
    });
  }
  show(index);
}

export function stopGuide() {
  demo?.stop();
}
