// UI controller: board rendering, turn flow, human input, spells, AI turns.
import { TYPES, SPELLS, SIZE, SQUARE_KIND, LUM_MAX, MODE_LABEL, isPowerPoint, spellInfo } from './data.js';
import { iconSVG } from './icons.js';
import { startGuide, stopGuide, traitNotes } from './guide.js';
import * as R from './rules.js';
import { chooseBoardAction } from './ai.js';
import { runCombat } from './combat.js';
import { sfx, isMuted, setMuted } from './audio.js';

// Working title — change it here and everywhere updates.
const GAME_TITLE = 'Equinox';

const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SIDE_NAME = { light: 'Light', dark: 'Dark' };

const S = {
  game: null,
  players: { light: 'human', dark: 'ai' },
  difficulty: 'normal',
  ui: freshUI(),
  busy: false,
  hover: null,
  lastMode: 'light',
};

function freshUI() {
  return { mode: 'idle', selected: null, moves: [], spell: null, step: 0, data: {}, targets: [] };
}

// ---------------------------------------------------------------------------
// Board DOM
// ---------------------------------------------------------------------------

const boardEl = $('#board');
const squareEls = [];
const pieceEls = new Map();
let pieceLayer;

function buildBoard() {
  boardEl.innerHTML = '';
  squareEls.length = 0;
  pieceEls.clear();
  for (let y = 0; y < SIZE; y++) {
    const row = [];
    for (let x = 0; x < SIZE; x++) {
      const el = document.createElement('div');
      el.className = `sq kind-${SQUARE_KIND[y][x]}`;
      el.dataset.x = x;
      el.dataset.y = y;
      if (isPowerPoint(x, y)) {
        el.classList.add('pp');
        el.innerHTML = '<span class="rune"></span>';
      }
      boardEl.append(el);
      row.push(el);
    }
    squareEls.push(row);
  }
  pieceLayer = document.createElement('div');
  pieceLayer.className = 'pieces';
  boardEl.append(pieceLayer);
}

function lumColor(lum) {
  const t = lum / LUM_MAX;
  const dark = [30, 27, 62], light = [206, 214, 240];
  const c = dark.map((d, i) => Math.round(d + (light[i] - d) * t));
  return `rgb(${c.join(',')})`;
}

function renderSquares() {
  const g = S.game;
  const ui = S.ui;
  const moveSet = new Map(ui.moves.map((m) => [m.y * SIZE + m.x, m]));
  const targetSet = new Set(ui.targets.map((t) => t.y * SIZE + t.x));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const el = squareEls[y][x];
    const lum = R.squareLum(g, x, y);
    el.style.setProperty('--sq', lumColor(lum));
    el.style.setProperty('--lum', lum / LUM_MAX);
    const m = moveSet.get(y * SIZE + x);
    el.classList.toggle('can-move', !!m && !m.attack);
    el.classList.toggle('can-attack', !!m && m.attack);
    el.classList.toggle('spell-target', targetSet.has(y * SIZE + x));
    el.classList.toggle('selected', !!ui.selected && ui.selected.x === x && ui.selected.y === y);
  }
}

function renderPieces() {
  for (const p of S.game.pieces) {
    let el = pieceEls.get(p.id);
    if (!p.alive) {
      if (el) {
        pieceEls.delete(p.id);
        el.classList.add('dying');
        setTimeout(() => el.remove(), 600);
      }
      continue;
    }
    const t = TYPES[p.type];
    if (!el) {
      el = document.createElement('div');
      el.className = `piece ${p.side}`;
      el.innerHTML = `${iconSVG(t.icon, 'icon')}<span class="hp"><i></i></span>${iconSVG('imprison', 'chain')}`;
      pieceLayer.append(el);
      pieceEls.set(p.id, el);
      el.classList.add('spawn');
      setTimeout(() => el.classList.remove('spawn'), 500);
    }
    el.style.setProperty('--x', p.x);
    el.style.setProperty('--y', p.y);
    const frac = p.hp / t.hp;
    el.querySelector('.hp i').style.width = `${frac * 100}%`;
    el.classList.toggle('wounded', frac < 1);
    el.classList.toggle('imprisoned', p.imprisoned);
    el.classList.toggle('selected', S.ui.selected === p);
    el.classList.toggle('flying', t.mode !== 'ground');
    el.title = t.name;
  }
}

function renderPanels() {
  const g = S.game;
  const side = g.turn;
  const human = S.players[side] === 'human';
  $('#turn-orb').className = `turn-orb ${side}`;
  $('#turn-label').textContent = g.winner ? 'Game over' : `${SIDE_NAME[side]} to move`;
  $('#turn-sub').textContent = `Round ${g.round} · ${human ? 'your turn' : 'computer thinking…'}`;
  if (S.players.light === 'human' && S.players.dark === 'human') $('#turn-sub').textContent = `Round ${g.round}`;

  // Luminance meter
  const meter = $('#lum-meter');
  meter.innerHTML = '';
  for (let i = 0; i <= LUM_MAX; i++) {
    const cell = document.createElement('span');
    cell.style.background = lumColor(i);
    if (i === g.lumPhase) cell.className = 'on';
    meter.append(cell);
  }
  const toward = g.lumDir > 0 ? 'Light' : 'Dark';
  $('#lum-text').innerHTML = `Shifting squares are ${phaseWord(g.lumPhase)} — waxing toward <b class="${g.lumDir > 0 ? 'lt' : 'dk'}">${toward}</b>.`;

  // Balance
  const count = (s) => g.pieces.filter((p) => p.alive && p.side === s).length;
  $('#cnt-light').textContent = count('light');
  $('#cnt-dark').textContent = count('dark');
  const owners = R.ppOwners(g);
  $('#pp-row').innerHTML = owners.map((o) => `<span class="pp-dot ${o || ''}"></span>`).join('') + '<small>power points</small>';

  renderSpells();
}

function phaseWord(p) {
  return ['pitch dark', 'dusky', 'dim', 'twilit', 'bright', 'radiant'][p];
}

function renderSpells() {
  const g = S.game;
  const side = g.turn;
  const human = S.players[side] === 'human' && !g.winner;
  const mage = g.pieces.find((p) => p.side === side && TYPES[p.type].caster);
  const active = R.activeMage(g, side);
  const avail = new Set(R.availableSpells(g, side));
  $('#spell-title').textContent = `${mage ? TYPES[mage.type].name : 'Spellcaster'}'s spells`;
  const list = $('#spell-list');
  list.innerHTML = '';
  for (const key of Object.keys(SPELLS)) {
    const sp = spellInfo(key, side);
    const used = g.spellsUsed[side].includes(key);
    const b = document.createElement('button');
    b.className = 'spell';
    b.innerHTML = `${iconSVG(sp.icon, 'sp-icon')}<span class="sp-name">${sp.name}</span>`;
    b.title = sp.desc;
    b.disabled = !human || S.busy || !avail.has(key);
    b.classList.toggle('used', used);
    b.classList.toggle('active', S.ui.spell === key);
    b.addEventListener('click', () => beginSpell(key));
    b.addEventListener('mouseenter', () => showSpellInfo(key));
    b.addEventListener('mouseleave', () => renderInfo());
    list.append(b);
  }
  const prompt = $('#spell-prompt');
  if (!active && mage) {
    prompt.hidden = false;
    prompt.innerHTML = mage.alive ? 'Your spellcaster is imprisoned.' : 'Your spellcaster has fallen. No more spells.';
  } else if (S.ui.mode === 'spell') {
    prompt.hidden = false;
    prompt.innerHTML = `${spellPromptText()} <button class="btn ghost small" id="spell-cancel">Cancel</button>`;
    $('#spell-cancel').addEventListener('click', cancelSpell);
  } else if (S.ui.mode === 'revive-pick') {
    prompt.hidden = false;
    const cands = R.reviveCandidates(g, side);
    prompt.innerHTML = 'Choose a fallen piece:<div class="revive-list">' +
      cands.map((p) => `<button class="btn ghost small" data-id="${p.id}">${iconSVG(TYPES[p.type].icon, 'inline-icon')} ${TYPES[p.type].name}</button>`).join('') +
      '</div><button class="btn ghost small" id="spell-cancel">Cancel</button>';
    prompt.querySelectorAll('[data-id]').forEach((btn) => btn.addEventListener('click', () => pickRevive(+btn.dataset.id)));
    $('#spell-cancel').addEventListener('click', cancelSpell);
  } else {
    prompt.hidden = true;
  }
}

function spellPromptText() {
  const { spell, step } = S.ui;
  const prompts = {
    teleport: ['Choose one of your pieces to teleport.', 'Choose a destination (an enemy square starts a battle).'],
    heal: ['Choose a wounded piece to heal.'],
    exchange: ['Choose the first piece to swap.', 'Choose the second piece.'],
    summon: [`Choose an enemy for the ${S.game.turn === 'dark' ? 'wraith' : 'elemental'} to attack.`],
    imprison: ['Choose an enemy piece to imprison.'],
    revive: ['', 'Choose a square beside your spellcaster.'],
  };
  return prompts[spell]?.[step] || '';
}

function render() {
  renderSquares();
  renderPieces();
  renderPanels();
  renderInfo();
}

// ---------------------------------------------------------------------------
// Info panel & log
// ---------------------------------------------------------------------------

function weaponText(w) {
  if (w.kind === 'melee') return `${w.name} · close combat · ${w.dmg} dmg`;
  if (w.kind === 'charge') return `${w.name} · charging strike${w.over ? ' that sails over pillars' : ''} · ${w.dmg} dmg`;
  if (w.kind === 'aura') return `${w.name} · area burst${w.invuln ? ', invulnerable while active' : ''} · ${w.dmg} dmg/tick`;
  return `${w.name} · ranged${w.count ? ` ×${w.count}` : ''} · ${w.dmg} dmg`;
}

const INFO_EMPTY = `<div class="info-empty">${iconSVG('equinox')}<p>Select or hover over a piece for information</p></div>`;

function pieceInfoHTML(p) {
  const t = TYPES[p.type];
  const lum = R.squareLum(S.game, p.x, p.y);
  const bonus = R.lumBonus(p.side, lum);
  const status = [];
  if (p.imprisoned) status.push(`<span class="tag warn">Imprisoned · ${R.roundsUntilRelease(S.game, p.side)} rounds</span>`);
  if (isPowerPoint(p.x, p.y)) status.push('<span class="tag pp">On power point · spell immune</span>');
  for (const note of traitNotes(t)) status.push(`<span class="tag">${note}</span>`);
  return `
    <div class="info-head ${p.side}">
      <span class="info-icon">${iconSVG(t.icon)}</span>
      <div><div class="info-name">${t.name}</div><div class="info-side">${SIDE_NAME[p.side]}</div></div>
    </div>
    <div class="info-hp"><i style="width:${(p.hp / t.hp) * 100}%"></i><span>${p.hp} / ${t.hp} HP</span></div>
    <dl class="stats">
      <dt>Movement</dt><dd>${MODE_LABEL[t.mode]} · ${t.move}</dd>
      <dt>Attack</dt><dd>${weaponText(t.weapon)}</dd>
      <dt>Square</dt><dd>${bonus ? `+${bonus} HP bonus in battle here` : 'No bonus here'}</dd>
    </dl>
    <div class="tags">${status.join('')}</div>`;
}

function spellInfoHTML(key, side) {
  const sp = spellInfo(key, side);
  const used = S.game.spellsUsed[side].includes(key);
  return `
    <div class="info-head"><span class="info-icon">${iconSVG(sp.icon)}</span>
    <div><div class="info-name">${sp.name}</div><div class="info-side">${used ? 'Already cast' : 'Once per game'}</div></div></div>
    <p>${sp.desc}</p>`;
}

function setInfo(html, empty = false) {
  const el = $('#info');
  el.innerHTML = html;
  el.classList.toggle('empty', empty);
}

// Lock the info card to the height of its wordiest content so it never jumps around.
// Every piece is measured in both of its wordiest states (imprisoned, or standing on a power point —
// the rules never allow both), along with every spell description. Re-measured when fonts load or
// the width changes.
function sizeInfoCard() {
  const el = $('#info');
  const saved = el.innerHTML, savedEmpty = el.classList.contains('empty');
  el.style.height = 'auto';
  let max = 0;
  const measure = (html, empty = false) => {
    setInfo(html, empty);
    max = Math.max(max, el.offsetHeight);
  };
  for (const [type, t] of Object.entries(TYPES)) {
    if (!t.mode) continue;
    measure(pieceInfoHTML({ type, side: t.side, hp: t.hp, x: 2, y: 2, imprisoned: true }));
    measure(pieceInfoHTML({ type, side: t.side, hp: t.hp, x: 0, y: 4, imprisoned: false }));
  }
  for (const key of Object.keys(SPELLS)) for (const side of ['light', 'dark']) measure(spellInfoHTML(key, side));
  measure(INFO_EMPTY, true);
  el.style.height = `${Math.ceil(max)}px`;
  setInfo(saved, savedEmpty);
}

let sizeTimer;
window.addEventListener('resize', () => { clearTimeout(sizeTimer); sizeTimer = setTimeout(sizeInfoCard, 150); });
document.fonts?.ready.then(() => S.game && sizeInfoCard());

function renderInfo() {
  const p = S.hover || S.ui.selected;
  if (!p || !p.alive) setInfo(INFO_EMPTY, true);
  else setInfo(pieceInfoHTML(p));
}

function showSpellInfo(key) {
  setInfo(spellInfoHTML(key, S.game.turn));
}

function log(msg, cls = '') {
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = msg;
  const ol = $('#log');
  ol.prepend(li);
  while (ol.children.length > 80) ol.lastChild.remove();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

const nameOf = (p) => `<b class="${p.side === 'light' ? 'lt' : 'dk'}">${TYPES[p.type].name}</b>`;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

boardEl.addEventListener('click', (e) => {
  const sq = e.target.closest('.sq');
  if (!sq) return;
  onSquare(+sq.dataset.x, +sq.dataset.y);
});

boardEl.addEventListener('mousemove', (e) => {
  const sq = e.target.closest('.sq');
  const p = sq ? R.pieceAt(S.game, +sq.dataset.x, +sq.dataset.y) : null;
  if (p !== S.hover) { S.hover = p; renderInfo(); }
});
boardEl.addEventListener('mouseleave', () => { S.hover = null; renderInfo(); });
boardEl.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelSelection(); });

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#combat').classList.contains('hidden')) return;
  if (e.key === 'Escape') {
    if (!$('#help').classList.contains('hidden')) closeHelp();
    else cancelSelection();
  }
});

function humanTurn() {
  return S.game && !S.game.winner && !S.busy && S.players[S.game.turn] === 'human';
}

function cancelSelection() {
  if (!S.game) return;
  S.ui = freshUI();
  render();
}

function onSquare(x, y) {
  if (!humanTurn()) return;
  const g = S.game;
  const ui = S.ui;
  const side = g.turn;
  const p = R.pieceAt(g, x, y);

  if (ui.mode === 'spell') return onSpellSquare(x, y);
  if (ui.mode === 'revive-pick') return;

  if (ui.selected) {
    const m = ui.moves.find((mv) => mv.x === x && mv.y === y);
    if (m) {
      const piece = ui.selected;
      S.ui = freshUI();
      act(() => performMove(piece, x, y));
      return;
    }
  }
  if (p && p.side === side) {
    if (p.imprisoned) { sfx.deny(); toast(`${TYPES[p.type].name} is imprisoned.`); return; }
    const moves = R.legalMoves(g, p);
    if (!moves.length) { sfx.deny(); toast(`${TYPES[p.type].name} has no moves.`); }
    S.ui = { ...freshUI(), mode: 'selected', selected: p, moves };
    sfx.select();
    render();
    return;
  }
  cancelSelection();
}

// Spells -------------------------------------------------------------------

function beginSpell(key) {
  if (!humanTurn()) return;
  const g = S.game, side = g.turn;
  sfx.select();
  if (key === 'shift') {
    act(() => castSpell(side, { spell: 'shift' }));
    return;
  }
  if (key === 'revive') {
    S.ui = { ...freshUI(), mode: 'revive-pick', spell: 'revive', step: 0 };
    render();
    return;
  }
  S.ui = { ...freshUI(), mode: 'spell', spell: key, step: 0, targets: R.spellTargets(g, side, key, 0) };
  render();
}

function pickRevive(id) {
  const g = S.game;
  S.ui = { ...freshUI(), mode: 'spell', spell: 'revive', step: 1, data: { reviveId: id }, targets: R.reviveSquares(g, g.turn) };
  render();
}

function cancelSpell() {
  S.ui = freshUI();
  render();
}

function onSpellSquare(x, y) {
  const g = S.game, side = g.turn, ui = S.ui;
  if (!ui.targets.some((t) => t.x === x && t.y === y)) { sfx.deny(); return; }
  const p = R.pieceAt(g, x, y);
  const { spell, step, data } = ui;
  const go = (a) => { S.ui = freshUI(); act(() => castSpell(side, { spell, ...a })); };
  switch (spell) {
    case 'teleport':
      if (step === 0) {
        S.ui = { ...ui, step: 1, selected: p, data: { piece: p }, targets: R.spellTargets(g, side, spell, 1).filter((t) => t.x !== p.x || t.y !== p.y) };
        sfx.select();
        render();
      } else go({ target: data.piece, x, y });
      break;
    case 'exchange':
      if (step === 0) {
        S.ui = { ...ui, step: 1, selected: p, data: { a: p }, targets: R.spellTargets(g, side, spell, 1, { a: p }) };
        sfx.select();
        render();
      } else go({ target: data.a, target2: p });
      break;
    case 'revive':
      go({ reviveId: data.reviveId, x, y });
      break;
    default:
      go({ target: p });
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function act(fn) {
  S.busy = true;
  render();
  try {
    await fn();
  } finally {
    await finishTurn();
  }
}

async function performMove(p, x, y) {
  const g = S.game;
  const target = R.pieceAt(g, x, y);
  if (!target) {
    p.x = x; p.y = y;
    sfx.move();
    log(`${nameOf(p)} moves to ${coord(x, y)}.`);
    render();
    await wait(380);
    return;
  }
  await battle(p, target, x, y);
}

// Attacker moves onto the defender's square and they duel.
async function battle(att, def, x, y) {
  log(`${nameOf(att)} challenges ${nameOf(def)} at ${coord(x, y)}.`, 'battle');
  sfx.challenge();
  const el = pieceEls.get(att.id);
  if (el) {
    el.style.setProperty('--x', att.x + (x - att.x) * 0.6);
    el.style.setProperty('--y', att.y + (y - att.y) * 0.6);
    el.classList.add('lunge');
  }
  await wait(450);
  const r = await fight(att, def, x, y);
  el?.classList.remove('lunge');
  if (!r.dAlive) def.alive = false;
  if (!r.aAlive) att.alive = false;
  if (r.aAlive) { att.hp = r.aHp; att.x = x; att.y = y; }
  if (r.dAlive) def.hp = r.dHp;
  if (!r.aAlive && !r.dAlive) log(`${nameOf(att)} and ${nameOf(def)} destroy each other.`);
  else if (r.aAlive) log(`${nameOf(att)} defeats ${nameOf(def)}.`);
  else log(`${nameOf(def)} repels ${nameOf(att)}.`);
  render();
  await wait(350);
}

function combatantSpec(p, foe, lum) {
  const bonus = R.lumBonus(p.side, lum);
  const t = TYPES[p.type];
  let form = p.type, base = t.hp, hp = p.hp;
  if (t.mimic && !TYPES[foe.type].mimic) {
    form = foe.type;
    base = TYPES[form].hp;
    hp = Math.max(1, Math.round((p.hp / t.hp) * base));
  }
  const both = S.players.light === 'human' && S.players.dark === 'human';
  return {
    type: p.type, form, side: p.side, bonus, base,
    hp: hp + bonus, maxHp: base + bonus,
    control: S.players[p.side] === 'human' ? 'human' : 'ai',
    keys: both ? p.side : 'all',
  };
}

function hpAfter(p, spec, remaining) {
  if (remaining <= 0) return 0;
  const max = TYPES[p.type].hp;
  const ratio = (remaining - spec.bonus) / spec.base;
  return Math.max(1, Math.min(max, Math.round(ratio * max)));
}

async function fight(att, def, x, y) {
  const lum = R.squareLum(S.game, x, y);
  const A = combatantSpec(att, def, lum);
  const D = combatantSpec(def, att, lum);
  const res = await runCombat({ a: A, b: D, lum, difficulty: S.difficulty });
  return {
    aAlive: res.a > 0, dAlive: res.b > 0,
    aHp: hpAfter(att, A, res.a), dHp: hpAfter(def, D, res.b),
  };
}

async function castSpell(side, a) {
  const g = S.game;
  const mage = R.activeMage(g, side);
  const sp = spellInfo(a.spell, side);
  g.spellsUsed[side].push(a.spell);
  sfx.spell();
  toast(`${iconSVG(sp.icon, 'inline-icon')} ${TYPES[mage.type].name} casts <b>${sp.name}</b>`);
  log(`${nameOf(mage)} casts <b>${sp.name}</b>.`, 'spell');
  boardEl.classList.add(`cast-${side}`);
  setTimeout(() => boardEl.classList.remove(`cast-${side}`), 900);
  await wait(500);
  switch (a.spell) {
    case 'teleport': {
      const t = R.pieceAt(g, a.x, a.y);
      if (t) await battle(a.target, t, a.x, a.y);
      else {
        const el = pieceEls.get(a.target.id);
        el?.classList.add('blink');
        await wait(250);
        a.target.x = a.x; a.target.y = a.y;
        render();
        await wait(300);
        el?.classList.remove('blink');
        log(`${nameOf(a.target)} appears at ${coord(a.x, a.y)}.`);
      }
      break;
    }
    case 'heal':
      a.target.hp = R.maxHp(a.target);
      log(`${nameOf(a.target)} is restored to full strength.`);
      break;
    case 'shift':
      R.shiftTime(g);
      log(`The luminance cycle reverses toward ${g.lumDir > 0 ? 'Light' : 'Dark'}.`);
      break;
    case 'exchange': {
      const p1 = a.target, p2 = a.target2;
      [p1.x, p2.x] = [p2.x, p1.x];
      [p1.y, p2.y] = [p2.y, p1.y];
      log(`${nameOf(p1)} and ${nameOf(p2)} trade places.`);
      break;
    }
    case 'summon': {
      const type = side === 'dark' ? 'wraith' : R.randomElemental();
      const el = { id: -1, type, side, hp: TYPES[type].hp, alive: true };
      const summoned = TYPES[type].name;
      log(`${/^[AEIOU]/.test(summoned) ? 'An' : 'A'} <b>${summoned}</b> rises against ${nameOf(a.target)}!`, 'battle');
      render();
      await wait(300);
      const r = await fight(el, a.target, a.target.x, a.target.y);
      if (!r.dAlive) { a.target.alive = false; log(`${nameOf(a.target)} is destroyed by the ${summoned}.`); }
      else { a.target.hp = r.dHp; log(`${nameOf(a.target)} survives the ${summoned}.`); }
      break;
    }
    case 'revive': {
      const p = g.pieces.find((q) => q.id === a.reviveId);
      Object.assign(p, { alive: true, hp: R.maxHp(p), imprisoned: false, x: a.x, y: a.y });
      log(`${nameOf(p)} returns from beyond.`);
      break;
    }
    case 'imprison':
      a.target.imprisoned = true;
      log(`${nameOf(a.target)} is imprisoned for ${R.roundsUntilRelease(g, a.target.side)} rounds.`);
      break;
  }
  render();
  await wait(300);
}

const coord = (x, y) => `${'ABCDEFGHI'[x]}${y + 1}`;

async function finishTurn() {
  const g = S.game;
  S.ui = freshUI();
  const w = R.checkWinner(g);
  if (w) return gameOver(w);
  for (let i = 0; i < 2; i++) {
    R.endTurn(g).forEach((m) => log(m));
    if (R.hasAnyAction(g, g.turn)) break;
    log(`${SIDE_NAME[g.turn]} has no legal action and passes.`);
    if (i === 1) return gameOver('draw');
  }
  S.busy = false;
  render();
  saveGame();
  scheduleAI(700);
}

function scheduleAI(delay) {
  const g = S.game;
  if (S.players[g.turn] !== 'ai' || g.winner) return;
  S.busy = true;
  renderPanels();
  setTimeout(() => S.game === g && aiTurn(), delay);
}

// ---------------------------------------------------------------------------
// Saving — the game is stored at the end of every turn.
// ---------------------------------------------------------------------------

const SAVE_KEY = 'equinox-save';

function saveGame() {
  if (S.game?.winner) return; // a finished game has nothing to continue
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, game: S.game, players: S.players, difficulty: S.difficulty, lastMode: S.lastMode,
      log: $('#log').innerHTML, savedAt: Date.now(),
    }));
  } catch { /* storage unavailable or full */ }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s?.v === 1 && Array.isArray(s.game?.pieces) && !s.game.winner) return s;
  } catch { /* corrupt or unavailable */ }
  return null;
}

function setDifficulty(d) {
  S.difficulty = d;
  document.querySelectorAll('#difficulty button').forEach((x) => x.classList.toggle('on', x.dataset.diff === d));
}

function resumeGame(save) {
  S.game = save.game;
  S.players = save.players;
  S.lastMode = save.lastMode;
  S.ui = freshUI();
  S.busy = false;
  S.hover = null;
  buildBoard();
  $('#log').innerHTML = save.log || '';
  log('Game resumed.');
  stopGuide();
  ['menu', 'gameover', 'help'].forEach((id) => $(`#${id}`).classList.add('hidden'));
  render();
  scheduleAI(900);
}

// Every way of opening the menu goes through here so Continue always reflects the current save.
function showMenu() {
  syncContinue();
  $('#menu').classList.remove('hidden');
}

function syncContinue() {
  const save = loadSave();
  $('#continue-wrap').hidden = !save;
  if (save) {
    const mode = { light: 'Playing Light', dark: 'Playing Dark', duo: 'Two players' }[save.lastMode] || '';
    $('#continue-info').textContent = `${mode} · round ${save.game.round} · ${SIDE_NAME[save.game.turn]} to move`;
  }
  return save;
}

async function aiTurn() {
  const g = S.game;
  if (!g || g.winner) return;
  const side = g.turn;
  const a = chooseBoardAction(g, side, S.difficulty);
  if (!a) { await finishTurn(); return; }
  if (a.kind === 'move') {
    S.ui = { ...freshUI(), mode: 'selected', selected: a.piece, moves: R.legalMoves(g, a.piece) };
    render();
    await wait(550);
    S.ui = freshUI();
    await act(() => performMove(a.piece, a.x, a.y));
  } else {
    await act(() => castSpell(side, a));
  }
}

function gameOver(w) {
  const g = S.game;
  g.winner = w;
  clearSave();
  S.busy = false;
  render();
  const humanSides = Object.keys(S.players).filter((s) => S.players[s] === 'human');
  let title, sub;
  if (w === 'draw') { title = 'Stalemate'; sub = 'Neither Light nor Dark prevails.'; }
  else {
    title = `${SIDE_NAME[w]} triumphs`;
    const pp = R.ppOwners(g).every((s) => s === w);
    sub = pp ? 'All five power points are held.' : `Every ${SIDE_NAME[R.opp(w)]} piece has been destroyed.`;
    if (humanSides.length === 1) sub = (humanSides[0] === w ? 'Victory! ' : 'Defeat. ') + sub;
  }
  log(`<b>${title}.</b> ${sub}`, 'spell');
  sfx.win();
  setTimeout(() => {
    $('#go-title').textContent = title;
    $('#go-sub').textContent = sub;
    $('#gameover').classList.remove('hidden');
  }, 600);
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function newGame(mode) {
  S.lastMode = mode;
  S.players = mode === 'duo' ? { light: 'human', dark: 'human' }
    : mode === 'light' ? { light: 'human', dark: 'ai' } : { light: 'ai', dark: 'human' };
  S.game = R.createGame();
  S.ui = freshUI();
  S.busy = false;
  S.hover = null;
  $('#log').innerHTML = '';
  buildBoard();
  boardEl.classList.toggle('flip', false);
  log('The armies of Light and Dark take the field.');
  stopGuide();
  ['menu', 'gameover', 'help'].forEach((id) => $(`#${id}`).classList.add('hidden'));
  render();
  saveGame();
  scheduleAI(900);
}

document.querySelectorAll('[data-title]').forEach((el) => { el.textContent = GAME_TITLE; });
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = iconSVG(el.dataset.icon); });
document.title = GAME_TITLE;

document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => {
  sfx.unlock();
  newGame(b.dataset.mode);
}));
document.querySelectorAll('#difficulty button').forEach((b) => b.addEventListener('click', () => {
  setDifficulty(b.dataset.diff);
  if (S.game && !S.game.winner && loadSave()) saveGame();
}));
$('#btn-continue').addEventListener('click', () => {
  sfx.unlock();
  const save = loadSave();
  if (save) resumeGame(save);
});
$('#btn-menu').addEventListener('click', () => {
  if (S.busy && !S.game?.winner) return;
  showMenu();
});
function openHelp(tab = 'rules') {
  showHelpTab(tab);
  $('#help').classList.remove('hidden');
}
function showHelpTab(tab) {
  if (tab === 'pieces') startGuide(); else stopGuide();
  document.querySelectorAll('.help-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.help-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
}
document.querySelectorAll('.help-tabs button').forEach((b) => b.addEventListener('click', () => showHelpTab(b.dataset.tab)));
$('#btn-help').addEventListener('click', () => openHelp());
$('#menu-help').addEventListener('click', () => openHelp());
function closeHelp() {
  stopGuide();
  $('#help').classList.add('hidden');
}
$('#help-close').addEventListener('click', closeHelp);
$('#go-again').addEventListener('click', () => newGame(S.lastMode));
$('#go-menu').addEventListener('click', () => { $('#gameover').classList.add('hidden'); showMenu(); });
const soundBtn = $('#btn-sound');
const syncSound = () => { soundBtn.innerHTML = iconSVG(isMuted() ? 'mute' : 'sound', 'btn-icon'); };
soundBtn.addEventListener('click', () => { setMuted(!isMuted()); syncSound(); });
syncSound();

// Behind the menu, show the saved game if there is one, otherwise a fresh board.
const saved = syncContinue();
if (saved) {
  setDifficulty(saved.difficulty || 'normal');
  S.game = saved.game;
  S.players = saved.players;
  S.lastMode = saved.lastMode;
} else {
  S.game = R.createGame();
}
buildBoard();
render();
sizeInfoCard();

// Exposed for debugging in the console.
window.__game = S;
