// Real-time battle arena. Resolves with the remaining hit points of both combatants.
import { TYPES, LUM_MAX } from './data.js';
import { sfx } from './audio.js';
import { combatAI } from './ai.js';
import { drawIcon } from './icons.js';

const W = 960, H = 600;
const TAU = Math.PI * 2;
const COLORS = { light: '#ffd166', dark: '#a979ff' };
const ICON_INK = { light: '#2b1d05', dark: '#ece2ff' };

const KEYS = {
  light: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], fire: ['Space', 'KeyF'] },
  dark: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], fire: ['Enter', 'NumpadEnter', 'Slash', 'ShiftRight', 'Numpad0'] },
};
KEYS.all = Object.fromEntries(Object.keys(KEYS.light).map((k) => [k, [...KEYS.light[k], ...KEYS.dark[k]]]));
const GAME_KEYS = new Set(Object.values(KEYS.all).flat());

// Obstacle layouts, defined for the left half (plus center column) and mirrored.
const LAYOUTS = [
  { half: [[330, 160], [330, 440], [210, 300, true]], center: [[480, 300, true]] },
  { half: [[260, 120], [400, 230, true], [400, 370, true], [260, 480]], center: [] },
  { half: [[360, 300], [240, 170, true], [240, 430, true]], center: [[480, 110], [480, 490]] },
  { half: [[300, 220, true], [300, 380, true], [400, 120], [400, 480]], center: [[480, 300]] },
];

function buildObstacles() {
  const L = LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)];
  const s = 46;
  const mk = ([cx, cy, cyc], i) => ({ x: cx - s / 2, y: cy - s / 2, w: s, h: s, cyc: !!cyc, off: i * 1.3, alpha: 1 });
  const list = [];
  L.half.forEach((c, i) => { list.push(mk(c, i)); list.push(mk([W - c[0], c[1], c[2]], i)); });
  L.center.forEach((c, i) => list.push(mk(c, i + 5)));
  return list;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The simulation always advances in fixed 1/60 s steps (the rate the balance sims use). When frames
// are slow it runs several steps per frame, so a struggling machine gets choppier, not slow-motion.
const STEP = 1 / 60;
const MAX_STEPS = 15;

// Soft glows are pre-rendered once per colour and stamped as images. This replaces canvas shadowBlur,
// which is extremely slow in some browsers (notably Safari on high-DPI screens).
const glowCache = new Map();
function glowSprite(color) {
  let s = glowCache.get(color);
  if (!s) {
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, color + 'cc');
    gr.addColorStop(0.45, color + '55');
    gr.addColorStop(1, color + '00');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, s);
  }
  return s;
}
function drawGlow(c, color, x, y, radius, alpha = 1) {
  const prev = c.globalAlpha;
  c.globalAlpha = prev * alpha;
  c.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
  c.globalAlpha = prev;
}
// Icons face their own side's enemy; a Doppelgänger wearing the other side's form needs them mirrored.
const faceAway = (f) => !!f.def.side && f.def.side !== f.side;
const solid = (o) => !o.cyc || o.alpha > 0.45;

function circleRect(cx, cy, r, o) {
  const nx = clamp(cx, o.x, o.x + o.w), ny = clamp(cy, o.y, o.y + o.h);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r ? { dx, dy } : null;
}

function segRect(x1, y1, x2, y2, o, pad) {
  const minX = o.x - pad, maxX = o.x + o.w + pad, minY = o.y - pad, maxY = o.y + o.h + pad;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - minX], [dx, maxX - x1], [-dy, y1 - minY], [dy, maxY - y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

function makeFighter(spec, x, y) {
  const def = TYPES[spec.form || spec.type];
  return {
    spec, def, side: spec.side, x, y, vx: 0, vy: 0, r: def.r,
    hp: spec.hp, maxHp: spec.maxHp,
    fx: x < W / 2 ? 1 : -1, fy: 0,
    cd: 0.5, auraT: 0, tickT: 0, swing: 0, flash: 0,
    dashT: 0, dashHit: false, slowT: 0, slowF: 1, spearOut: null,
    input: { x: 0, y: 0, fire: false, face: null },
    control: spec.control, keys: KEYS[spec.keys] || KEYS.all,
    ai: { t: 0 },
  };
}

export function runCombat(opts) {
  return new Promise((resolve) => new Combat(opts, resolve).start());
}

export class Combat {
  constructor(opts, resolve) {
    this.opts = opts;
    this.resolve = resolve;
    this.overlay = document.getElementById('combat');
    this.canvas = opts.canvas || document.getElementById('arena');
    this.ctx = this.canvas.getContext('2d');
    this.autoBtn = document.getElementById('auto-fight');
    this.lum = opts.lum;
    this.obstacles = opts.demo ? [] : buildObstacles();
    const a = makeFighter(opts.a, 0, 0), b = makeFighter(opts.b, 0, 0);
    const [left, right] = a.side === 'light' ? [a, b] : [b, a];
    Object.assign(left, { x: 90, y: H / 2, fx: 1 });
    Object.assign(right, { x: W - 90, y: H / 2, fx: -1 });
    this.a = a; this.b = b;
    this.left = left; this.right = right;
    this.fighters = [a, b];
    this.projectiles = [];
    this.particles = [];
    this.rings = [];
    this.t = 0;
    this.phase = 'intro';
    this.introT = 2.4;
    this.lastCount = 4;
    this.endT = 0;
    this.fightT = 0;
    this.shake = 0;
    this.keys = new Set();
    this.onKeyDown = (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    this.onResize = () => this.resize();
    this.onAuto = () => {
      for (const f of this.fighters) if (f.control === 'human') { f.control = 'ai'; f.wasHuman = true; }
      this.autoBtn.disabled = true;
      this.autoBtn.textContent = 'AI is fighting…';
    };
  }

  start() {
    this.overlay.classList.remove('hidden');
    document.getElementById('combat-title').textContent = `${this.label(this.a)}  vs  ${this.label(this.b)}`;
    const humans = this.fighters.filter((f) => f.control === 'human');
    this.autoBtn.hidden = humans.length === 0;
    this.autoBtn.disabled = false;
    this.autoBtn.textContent = 'Let AI fight for me';
    document.getElementById('combat-hint').innerHTML = this.hintHTML();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    this.autoBtn.addEventListener('click', this.onAuto);
    this.resize();
    this.last = performance.now();
    this.acc = 0;
    const loop = (now) => {
      this.acc += Math.min((now - this.last) / 1000, STEP * MAX_STEPS);
      this.last = now;
      while (this.acc >= STEP && this.phase !== 'done') {
        this.step(STEP);
        this.acc -= STEP;
      }
      if (this.phase === 'done') return;
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  hintHTML() {
    const humans = this.fighters.filter((f) => f.control === 'human');
    if (!humans.length) return 'Computer vs computer';
    if (humans.length === 2) {
      return '<b class="lt">Light</b> W A S D move · Space/F attack &nbsp;&nbsp; <b class="dk">Dark</b> Arrows move · Enter or / attack';
    }
    return 'Move with <kbd>WASD</kbd> or <kbd>Arrows</kbd> · attack with <kbd>Space</kbd> · you fire in the direction you last moved';
  }

  label(f) {
    if (f.spec.form && f.spec.form !== f.spec.type) return `${TYPES[f.spec.type].name} (as ${f.def.name})`;
    return f.def.name;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.buildBackground(dpr);
  }

  // Floor, grid, border and the solid pillars never change during a fight, so they are drawn once
  // (glow included) into an off-screen canvas and copied each frame. Covers a 20px margin for shake.
  buildBackground(dpr) {
    const bg = document.createElement('canvas');
    bg.width = Math.ceil((W + 40) * dpr);
    bg.height = Math.ceil((H + 40) * dpr);
    const c = bg.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 20 * dpr, 20 * dpr);
    this.drawFloor(c);
    for (const o of this.obstacles) if (!o.cyc) this.drawObstacle(c, o, true);
    this.bg = bg;
  }

  finish() {
    this.phase = 'done';
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    this.autoBtn.removeEventListener('click', this.onAuto);
    this.overlay.classList.add('hidden');
    this.resolve({ a: Math.max(0, this.a.hp), b: Math.max(0, this.b.hp) });
  }

  sound(name, arg) {
    if (!this.opts.silent) sfx[name](arg);
  }

  // ---- arena queries used by the AI ----
  blocked(x, y, r) {
    if (x < r || y < r || x > W - r || y > H - r) return true;
    return this.obstacles.some((o) => solid(o) && circleRect(x, y, r, o));
  }

  clearShot(x1, y1, x2, y2, pad) {
    return !this.obstacles.some((o) => solid(o) && segRect(x1, y1, x2, y2, o, pad));
  }

  // ---- simulation ----
  step(dt) {
    this.t += dt;
    for (const o of this.obstacles) if (o.cyc) o.alpha = 0.5 + 0.5 * Math.sin(this.t * 1.4 + o.off);
    this.shake = Math.max(0, this.shake - dt * 30);

    if (this.phase === 'intro') {
      this.introT -= dt;
      const c = Math.ceil(this.introT);
      if (c < this.lastCount && c >= 1 && c <= 3) { this.lastCount = c; this.sound('count'); }
      if (this.introT <= 0) { this.phase = 'fight'; this.sound('go'); }
    } else if (this.phase === 'fight') {
      this.fightT += dt;
    } else if (this.phase === 'end') {
      this.endT -= dt;
      dt *= 0.35;
      if (this.endT <= 0) { this.finish(); return; }
    }

    const [a, b] = this.fighters;
    this.updateFighter(a, b, dt);
    this.updateFighter(b, a, dt);
    this.separate(a, b);
    this.updateProjectiles(dt);
    this.updateParticles(dt);

    if (this.phase === 'fight' && (a.hp <= 0 || b.hp <= 0)) {
      this.phase = 'end';
      this.endT = 1.6;
      this.sound('death');
      for (const f of this.fighters) if (f.hp <= 0) this.burst(f.x, f.y, COLORS[f.side], 60, 260);
      this.shake = 9;
    }
  }

  readInput(f, foe, dt) {
    if (f.control === 'ai') {
      combatAI(f, foe, this, dt, this.opts.difficulty);
      return;
    }
    const k = f.keys;
    const down = (list) => list.some((c) => this.keys.has(c));
    let x = (down(k.right) ? 1 : 0) - (down(k.left) ? 1 : 0);
    let y = (down(k.down) ? 1 : 0) - (down(k.up) ? 1 : 0);
    f.input = { x, y, fire: down(k.fire), face: null };
  }

  updateFighter(f, foe, dt) {
    f.cd -= dt; f.flash -= dt; f.swing -= dt; f.slowT -= dt;
    if (f.hp <= 0) { f.vx = f.vy = 0; f.dashT = 0; return; }
    const w = f.def.weapon;
    const active = this.phase === 'fight';
    if (active && f.def.regen) f.hp = Math.min(f.maxHp, f.hp + f.def.regen * dt);
    if (active) this.readInput(f, foe, dt);
    else f.input = { x: 0, y: 0, fire: false, face: null };

    if (f.dashT > 0) {
      this.updateDash(f, foe, dt);
      return;
    }

    let { x: ix, y: iy } = f.input;
    const il = Math.hypot(ix, iy);
    if (il > 0) {
      ix /= il; iy /= il;
      // Facing snaps to the 8 compass directions.
      const a = Math.round(Math.atan2(iy, ix) / (Math.PI / 4)) * (Math.PI / 4);
      f.fx = Math.cos(a); f.fy = Math.sin(a);
    }
    let speed = f.def.speed;
    if (f.auraT > 0) speed *= w.invuln ? 0.6 : 0.45;
    if (f.swing > 0) speed *= 0.5;
    if (f.slowT > 0) speed *= f.slowF;
    f.vx = ix * speed; f.vy = iy * speed;
    f.x += f.vx * dt; f.y += f.vy * dt;
    this.collide(f);

    if (active && f.input.fire && f.cd <= 0 && !f.spearOut) {
      if (f.input.face != null) { f.fx = Math.cos(f.input.face); f.fy = Math.sin(f.input.face); }
      this.attack(f, foe);
      if (f.control === 'ai') f.input.fire = false;
    }

    if (f.auraT > 0) {
      f.auraT -= dt;
      f.tickT -= dt;
      if (Math.random() < 0.6) {
        const a = Math.random() * TAU, d = Math.random() * w.radius;
        this.particles.push({ x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d, vx: 0, vy: -30, life: 0.5, max: 0.5, color: w.color, size: 3 });
      }
      if (f.tickT <= 0) {
        f.tickT = w.tick;
        if (Math.hypot(foe.x - f.x, foe.y - f.y) <= w.radius + foe.r) {
          this.damage(foe, w.dmg, f);
          if (w.slow) { foe.slowT = w.tick + 0.05; foe.slowF = w.slow; }
        }
      }
    }
  }

  // Charging attacks (Cavalier lance, Griffin dive): a fast dash that hits on contact.
  updateDash(f, foe, dt) {
    const w = f.def.weapon;
    f.dashT -= dt;
    f.vx = f.fx * w.dash; f.vy = f.fy * w.dash;
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (w.over) this.clampToArena(f);
    else if (this.collide(f)) f.dashT = 0; // a lance stops dead against a pillar
    if (!f.dashHit && Math.hypot(foe.x - f.x, foe.y - f.y) < f.r + foe.r + 6) {
      f.dashHit = true;
      f.dashT = 0;
      this.damage(foe, w.dmg, f);
      foe.x += f.fx * 34; foe.y += f.fy * 34;
      this.collide(foe);
    }
    if (f.dashT <= 0) this.collide(f); // a diving griffin lands clear of pillars
    this.particles.push({ x: f.x - f.fx * f.r, y: f.y - f.fy * f.r, vx: 0, vy: 0, life: 0.3, max: 0.3, color: w.color, size: f.r * 0.45 });
  }

  attack(f, foe) {
    const w = f.def.weapon;
    const dx = foe.x - f.x, dy = foe.y - f.y, d = Math.hypot(dx, dy) || 1;
    if (w.kind === 'melee') {
      f.cd = w.cd;
      f.swing = 0.18;
      this.sound('swing');
      const facing = (dx * f.fx + dy * f.fy) / d;
      if (d <= f.r + foe.r + w.range && facing > (w.arc ?? 0.45)) this.damage(foe, w.dmg, f);
    } else if (w.kind === 'charge') {
      f.dashT = w.dur;
      f.dashHit = false;
      f.cd = w.cd + w.dur;
      this.sound('swing');
    } else if (w.kind === 'aura') {
      f.auraT = w.dur;
      f.tickT = 0;
      f.cd = w.cd + w.dur;
      this.sound('aura');
    } else if (w.stomp && d <= f.r + foe.r + w.stomp.range) {
      // Giant: a foe underfoot gets stomped instead of having a boulder thrown at it.
      f.cd = w.cd * 0.6;
      this.rings.push({ x: f.x, y: f.y, r: f.r, max: f.r + w.stomp.range + 30, life: 0.35, color: w.color });
      this.damage(foe, w.stomp.dmg, f);
      foe.x += (dx / d) * w.stomp.push; foe.y += (dy / d) * w.stomp.push;
      this.collide(foe);
      this.kick(6);
      this.sound('shot', 'boulder');
    } else {
      f.cd = w.cd;
      const n = w.count || 1;
      const base = Math.atan2(f.fy, f.fx);
      for (let i = 0; i < n; i++) {
        const a = base + (n > 1 ? (i - (n - 1) / 2) * w.spread : 0);
        const cx = Math.cos(a), cy = Math.sin(a);
        const p = {
          x: f.x + cx * (f.r + w.r + 2), y: f.y + cy * (f.r + w.r + 2),
          vx: cx * w.speed, vy: cy * w.speed, r: w.r, dmg: w.dmg, owner: f,
          life: w.life, style: w.style, color: w.color, spin: 0,
          returns: !!w.returns, pierce: !!w.pierce, back: false, hit: false, dead: false,
        };
        this.projectiles.push(p);
        if (w.returns) f.spearOut = p;
      }
      this.sound('shot', w.style);
    }
  }

  damage(f, dmg, src, proj = null) {
    if (f.hp <= 0) return;
    if (f.auraT > 0 && f.def.weapon.invuln) return;
    if (proj && f.def.shield) {
      // Cavalier's shield softens shots that strike it from the front.
      const n = Math.hypot(proj.vx, proj.vy) || 1;
      if ((proj.vx * f.fx + proj.vy * f.fy) / n < -0.5) {
        dmg *= f.def.shield;
        this.burst(f.x + f.fx * f.r, f.y + f.fy * f.r, '#ffffff', 8, 120);
      }
    }
    f.hp -= dmg;
    f.flash = 0.15;
    // Only real impacts shake the arena; rapid small ticks (auras) would turn it into constant jitter.
    if (dmg >= 4) this.kick(dmg * 0.6);
    this.burst(f.x, f.y, src.def.weapon.color, 14, 160);
    const drain = src.def.weapon.drain;
    if (drain && src.hp > 0) src.hp = Math.min(src.maxHp, src.hp + drain);
    this.sound('hit');
  }

  // Screen shake: takes the stronger of the current and new shake rather than stacking them.
  kick(amount) {
    this.shake = Math.max(this.shake, Math.min(7, amount));
  }

  clampToArena(f) {
    f.x = clamp(f.x, f.r, W - f.r);
    f.y = clamp(f.y, f.r, H - f.r);
  }

  // Push a fighter out of solid pillars. Returns true if it hit one.
  collide(f) {
    let hit = false;
    if (!f.def.phase) {
      for (const o of this.obstacles) {
        if (!solid(o)) continue;
        const c = circleRect(f.x, f.y, f.r, o);
        if (!c) continue;
        hit = true;
        const d = Math.hypot(c.dx, c.dy);
        if (d === 0) {
          const opts = [[f.x - o.x, -1, 0], [o.x + o.w - f.x, 1, 0], [f.y - o.y, 0, -1], [o.y + o.h - f.y, 0, 1]];
          opts.sort((p, q) => p[0] - q[0]);
          const [, sx, sy] = opts[0];
          if (sx) f.x = sx < 0 ? o.x - f.r : o.x + o.w + f.r;
          else f.y = sy < 0 ? o.y - f.r : o.y + o.h + f.r;
        } else {
          const k = (f.r - d) / d;
          f.x += c.dx * k; f.y += c.dy * k;
        }
      }
    }
    this.clampToArena(f);
    return hit;
  }

  separate(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const overlap = a.r + b.r - d;
    if (overlap > 0) {
      a.x -= (dx / d) * overlap / 2; a.y -= (dy / d) * overlap / 2;
      b.x += (dx / d) * overlap / 2; b.y += (dy / d) * overlap / 2;
      this.collide(a); this.collide(b);
    }
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      const owner = p.owner;
      if (p.returns && (owner.hp <= 0 || p.life < -4)) { p.dead = true; continue; }
      if (p.back) {
        // Returning spear homes in on its thrower.
        const dx = owner.x - p.x, dy = owner.y - p.y, d = Math.hypot(dx, dy) || 1;
        const sp = owner.def.weapon.speed * 1.15;
        p.vx = (dx / d) * sp; p.vy = (dy / d) * sp;
        if (d < owner.r + p.r) { p.dead = true; owner.spearOut = null; continue; }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      p.spin += dt * 12;
      if (p.style === 'fireball' || p.style === 'flame') {
        this.particles.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.35, max: 0.35, color: p.color, size: p.r * 0.6 });
      }
      const turnBack = () => { p.back = true; p.hit = false; };
      if (p.returns && !p.back && p.life <= 0) turnBack();
      else if (!p.returns && p.life <= 0) { p.dead = true; continue; }
      if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) {
        if (p.returns) turnBack(); else { p.dead = true; continue; }
      }
      if (!p.pierce && !p.back) {
        for (const o of this.obstacles) {
          if (!solid(o) || !circleRect(p.x, p.y, p.r, o)) continue;
          this.burst(p.x, p.y, p.color, 8, 100);
          if (p.returns) turnBack(); else p.dead = true;
          break;
        }
      }
      if (p.dead) continue;
      for (const f of this.fighters) {
        if (f === owner || f.hp <= 0 || p.hit) continue;
        if (Math.hypot(f.x - p.x, f.y - p.y) < f.r + p.r) {
          this.damage(f, p.dmg, owner, p);
          if (p.returns) { if (!p.back) turnBack(); p.hit = true; } else p.dead = true;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.3 + Math.random());
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6, max: 0.6, color, size: 2 + Math.random() * 3 });
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  // ---- rendering ----
  draw() {
    const c = this.ctx;
    c.save();
    if (this.shake > 0) c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    c.drawImage(this.bg, -20, -20, W + 40, H + 40);
    for (const o of this.obstacles) if (o.cyc) this.drawObstacle(c, o);
    for (const f of this.fighters) this.drawAura(c, f);
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill();
    }
    for (const r of this.rings) {
      const k = 1 - r.life / 0.35;
      c.globalAlpha = Math.max(0, r.life / 0.35);
      c.strokeStyle = r.color;
      c.lineWidth = 6 * (1 - k) + 1;
      c.beginPath(); c.arc(r.x, r.y, r.r + (r.max - r.r) * k, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
    for (const p of this.projectiles) this.drawProjectile(c, p);
    for (const f of this.fighters) this.drawFighter(c, f);
    c.restore();
    this.drawHUD(c);
  }

  drawFloor(c) {
    const t = this.lum / LUM_MAX;
    const mix = (a, b) => Math.round(a + (b - a) * t);
    const top = `rgb(${mix(10, 58)},${mix(11, 66)},${mix(26, 104)})`;
    const bot = `rgb(${mix(4, 30)},${mix(5, 34)},${mix(14, 58)})`;
    const g = c.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    c.fillStyle = g;
    c.fillRect(-20, -20, W + 40, H + 40);
    c.strokeStyle = `rgba(200,210,255,${0.04 + 0.05 * t})`;
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= W; x += 48) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y <= H; y += 48) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.15)';
    c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, W - 3, H - 3);
  }

  // `cached` is true when drawing into the one-off background, where an expensive blur is fine.
  drawObstacle(c, o, cached = false) {
    const a = o.cyc ? 0.15 + 0.85 * o.alpha : 1;
    c.save();
    c.globalAlpha = a;
    if (cached) {
      c.shadowColor = '#c6b6ff';
      c.shadowBlur = 18;
    } else if (solid(o)) {
      drawGlow(c, '#7fd8ff', o.x + o.w / 2, o.y + o.h / 2, o.w * 1.05, 0.55);
    }
    const g = c.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
    g.addColorStop(0, o.cyc ? '#6ac9ff' : '#8f7dff');
    g.addColorStop(1, o.cyc ? '#204a7a' : '#2e2560');
    c.fillStyle = g;
    roundRect(c, o.x, o.y, o.w, o.h, 8);
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
  }

  drawAura(c, f) {
    if (f.auraT <= 0 || f.hp <= 0) return;
    const w = f.def.weapon;
    const pulse = 0.85 + 0.15 * Math.sin(this.t * 30);
    const g = c.createRadialGradient(f.x, f.y, f.r, f.x, f.y, w.radius * pulse);
    g.addColorStop(0, w.color + 'cc');
    g.addColorStop(0.7, w.color + '44');
    g.addColorStop(1, w.color + '00');
    c.fillStyle = g;
    c.beginPath(); c.arc(f.x, f.y, w.radius * pulse, 0, TAU); c.fill();
    c.strokeStyle = w.color + '99';
    c.lineWidth = 2;
    c.beginPath(); c.arc(f.x, f.y, w.radius, 0, TAU); c.stroke();
  }

  drawProjectile(c, p) {
    const a = Math.atan2(p.vy, p.vx);
    drawGlow(c, p.color, p.x, p.y, Math.max(14, p.r * 2.4), p.style === 'boulder' ? 0.3 : 0.7);
    c.save();
    c.translate(p.x, p.y);
    c.rotate(a);
    c.fillStyle = p.color;
    c.strokeStyle = p.color;
    switch (p.style) {
      case 'arrow':
        c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(-18, 0); c.lineTo(6, 0); c.stroke();
        c.beginPath(); c.moveTo(9, 0); c.lineTo(2, -4); c.lineTo(2, 4); c.fill();
        break;
      case 'spear':
        c.lineWidth = 3.5;
        c.beginPath(); c.moveTo(-26, 0); c.lineTo(8, 0); c.stroke();
        c.beginPath(); c.moveTo(14, 0); c.lineTo(4, -6); c.lineTo(4, 6); c.fill();
        break;
      case 'javelin':
        c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(-14, 0); c.lineTo(6, 0); c.stroke();
        c.beginPath(); c.moveTo(10, 0); c.lineTo(4, -3); c.lineTo(4, 3); c.fill();
        break;
      case 'shard':
        c.rotate(p.spin * 0.5);
        c.globalAlpha = 0.85;
        c.beginPath(); c.moveTo(p.r * 1.4, 0); c.lineTo(0, -p.r * 0.7); c.lineTo(-p.r * 1.4, 0); c.lineTo(0, p.r * 0.7); c.closePath(); c.fill();
        break;
      case 'spike':
        c.beginPath(); c.moveTo(8, 0); c.lineTo(-6, -4); c.lineTo(-6, 4); c.fill();
        break;
      case 'bolt': case 'gaze':
        c.lineWidth = p.r * 0.9;
        c.lineCap = 'round';
        c.beginPath(); c.moveTo(-28, 0); c.lineTo(4, 0); c.stroke();
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(2, 0, p.r * 0.5, 0, TAU); c.fill();
        break;
      case 'lightning':
        c.lineWidth = 3;
        c.beginPath(); c.moveTo(-30, 0);
        for (let i = 1; i <= 5; i++) c.lineTo(-30 + i * 7, (Math.random() - 0.5) * 12);
        c.stroke();
        break;
      case 'boulder':
        c.rotate(p.spin * 0.4);
        c.beginPath();
        for (let i = 0; i < 9; i++) {
          const aa = (i / 9) * TAU, rr = p.r * (0.82 + 0.18 * Math.sin(i * 2.7));
          c.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
        }
        c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2; c.stroke();
        break;
      case 'whirl':
        c.lineWidth = 2.5;
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.arc(0, 0, p.r * (0.4 + i * 0.3), p.spin + i * 2, p.spin + i * 2 + 4);
          c.stroke();
        }
        break;
      case 'wave':
        c.lineWidth = 5;
        c.lineCap = 'round';
        c.beginPath(); c.arc(-p.r, 0, p.r * 1.4, -0.9, 0.9); c.stroke();
        break;
      default: { // fireball, flame
        const g = c.createRadialGradient(0, 0, 1, 0, 0, p.r);
        g.addColorStop(0, '#fff6d0'); g.addColorStop(0.5, p.color); g.addColorStop(1, p.color + '00');
        c.fillStyle = g;
        c.beginPath(); c.arc(0, 0, p.r * 1.2, 0, TAU); c.fill();
      }
    }
    c.restore();
  }

  drawFighter(c, f) {
    if (f.hp <= 0 && this.phase === 'end') return;
    const col = COLORS[f.side];
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(f.x, f.y + f.r * 0.9, f.r * 0.9, f.r * 0.35, 0, 0, TAU); c.fill();

    const bob = f.def.mode === 'fly' || TYPES[f.spec.type].mode === 'fly' ? Math.sin(this.t * 4 + f.x) * 3 : 0;
    const y = f.y + bob;

    // facing chevron
    const fa = Math.atan2(f.fy, f.fx);
    c.save();
    c.translate(f.x, y); c.rotate(fa);
    c.fillStyle = col;
    c.beginPath(); c.moveTo(f.r + 10, 0); c.lineTo(f.r + 2, -6); c.lineTo(f.r + 2, 6); c.fill();
    if (f.swing > 0) {
      const w = f.def.weapon;
      const prog = 1 - f.swing / 0.18;
      const spread = Math.acos(w.arc ?? 0.45);
      c.strokeStyle = w.color;
      c.beginPath(); c.arc(0, 0, f.r + w.range * 0.8, -spread + prog * spread, -spread * 0.2 + prog * spread * 1.2);
      c.globalAlpha = 0.3; c.lineWidth = 12; c.stroke();
      c.globalAlpha = 1; c.lineWidth = 5; c.stroke();
    }
    if (f.def.shield && f.dashT <= 0) {
      c.strokeStyle = 'rgba(255,241,201,0.75)';
      c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, f.r + 4, -0.9, 0.9); c.stroke();
    }
    c.restore();
    if (f.slowT > 0) {
      c.strokeStyle = 'rgba(201,210,255,0.7)';
      c.lineWidth = 2;
      c.setLineDash([4, 4]);
      c.beginPath(); c.arc(f.x, y, f.r + 9, 0, TAU); c.stroke();
      c.setLineDash([]);
    }

    const g = c.createRadialGradient(f.x - f.r * 0.3, y - f.r * 0.3, 2, f.x, y, f.r);
    g.addColorStop(0, f.side === 'light' ? '#fff8e0' : '#4a2d7a');
    g.addColorStop(1, f.side === 'light' ? '#b8892c' : '#170d2e');
    drawGlow(c, col, f.x, y, f.r * 2.1, 0.75);
    c.fillStyle = g;
    c.beginPath(); c.arc(f.x, y, f.r, 0, TAU); c.fill();
    c.strokeStyle = col; c.lineWidth = 2.5; c.stroke();

    drawIcon(c, f.def.icon, f.x, y, f.r * 1.45, ICON_INK[f.side], faceAway(f));

    if (f.flash > 0) {
      c.globalAlpha = f.flash / 0.15 * 0.8;
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(f.x, y, f.r, 0, TAU); c.fill();
      c.globalAlpha = 1;
    }
    // reload ring
    const w = f.def.weapon;
    const total = w.kind === 'aura' || w.kind === 'charge' ? w.cd + w.dur : w.cd;
    if (f.cd > 0 && this.phase === 'fight') {
      c.strokeStyle = 'rgba(255,255,255,0.5)';
      c.lineWidth = 2;
      c.beginPath(); c.arc(f.x, y, f.r + 5, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - f.cd / total)); c.stroke();
    }
    c.restore();
  }

  drawHUD(c) {
    const bar = (f, x, alignRight) => {
      const bw = 320, bh = 14, y = 34;
      const col = COLORS[f.side];
      c.font = '600 15px Inter, system-ui, sans-serif';
      c.textBaseline = 'alphabetic';
      c.textAlign = alignRight ? 'right' : 'left';
      c.fillStyle = col;
      const bonus = f.spec.bonus ? `  +${f.spec.bonus} luminance` : '';
      c.fillText(`${this.label(f)}${bonus}`, alignRight ? x + bw - 22 : x + 22, y - 8);
      drawIcon(c, f.def.icon, alignRight ? x + bw - 8 : x + 8, y - 13, 18, col, faceAway(f));
      c.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(c, x, y, bw, bh, 7); c.fill();
      const frac = clamp(f.hp / f.maxHp, 0, 1);
      const fill = c.createLinearGradient(x, 0, x + bw, 0);
      fill.addColorStop(0, col); fill.addColorStop(1, '#ffffff');
      c.fillStyle = fill;
      const fw = bw * frac;
      roundRect(c, alignRight ? x + bw - fw : x, y, Math.max(fw, 0.01), bh, 7); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.lineWidth = 1;
      roundRect(c, x, y, bw, bh, 7); c.stroke();
      c.fillStyle = '#fff';
      c.font = '600 11px Inter, system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(`${Math.max(0, Math.ceil(f.hp))} / ${f.maxHp}`, x + bw / 2, y + 11);
    };
    bar(this.left, 20, false);
    bar(this.right, W - 340, true);

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (this.phase === 'intro') {
      const n = Math.ceil(this.introT);
      const text = n > 3 ? 'READY' : String(n);
      c.font = '900 64px Cinzel, Georgia, serif';
      drawGlow(c, '#9fd8ff', W / 2, H / 2, 120, 0.45);
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillText(text, W / 2, H / 2);
    }
    if (this.phase === 'fight' && this.fightT < 0.7) {
      c.font = '900 64px Cinzel, Georgia, serif';
      c.fillStyle = `rgba(255,255,255,${1 - this.fightT / 0.7})`;
      c.fillText('FIGHT', W / 2, H / 2);
    }
    if (this.phase === 'end') {
      const [a, b] = this.fighters;
      let text;
      if (a.hp <= 0 && b.hp <= 0) text = 'Both fall!';
      else text = `${this.label(a.hp > 0 ? a : b)} prevails`;
      c.font = '900 46px Cinzel, Georgia, serif';
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(0,0,0,0.75)';
      c.lineWidth = 8;
      c.strokeText(text, W / 2, H / 2);
      c.fillStyle = '#fff';
      c.fillText(text, W / 2, H / 2);
    }
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const DEMO_H = 340;

// A silent, endlessly looping showcase of one piece attacking — used by the Pieces guide.
// Uses the real arena simulation and renderer, minus obstacles, opponent and HUD.
export class ArenaDemo extends Combat {
  constructor(canvas, type, side, { forms = [], onForm = null } = {}) {
    const def = TYPES[type];
    const spec = { type, side, hp: def.hp, maxHp: def.hp, bonus: 0, control: 'demo', keys: 'all' };
    const dummy = { type: 'knight', side: side === 'light' ? 'dark' : 'light', hp: 1e9, maxHp: 1e9, bonus: 0, control: 'demo', keys: 'all' };
    super({ a: spec, b: dummy, lum: 3, demo: true, silent: true, canvas }, () => {});
    const f = this.a;
    this.home = { x: side === 'light' ? 150 : W - 150, y: H / 2 };
    Object.assign(f, this.home, { fx: side === 'light' ? 1 : -1, fy: 0, cd: 0.4 });
    this.park();
    this.phase = 'fight';
    this.forms = forms;
    this.formIndex = -1;
    this.onForm = onForm;
    this.attacks = 0;
    this.stompNext = false;
    if (def.mimic && forms.length) this.nextForm();
  }

  // Keep the stand-in opponent far off-screen so nothing ever hits it by accident.
  park() { Object.assign(this.b, { x: -5000, y: -5000 }); }

  nextForm() {
    this.formIndex = (this.formIndex + 1) % this.forms.length;
    const def = TYPES[this.forms[this.formIndex]];
    Object.assign(this.a, { def, r: def.r, spearOut: null, auraT: 0, dashT: 0, cd: 0.5 });
    this.projectiles = [];
    this.onForm?.(def);
  }

  readInput(f) {
    // Pause briefly once reloaded so the refilled ring is visible before the next attack.
    f.input = { x: 0, y: 0, fire: f.cd <= -0.35 && f.dashT <= 0 && f.auraT <= 0, face: f.side === 'light' ? 0 : Math.PI };
  }

  attack(f, foe) {
    const w = f.def.weapon;
    if (w.stomp && (this.stompNext = !this.stompNext)) {
      // Show the Giant's stomp by briefly standing the dummy right in front of it.
      Object.assign(this.b, { x: f.x + f.fx * (f.r + this.b.r + 8), y: f.y });
      super.attack(f, this.b);
      this.park();
    } else {
      super.attack(f, foe);
    }
    if (TYPES[f.spec.type].mimic && ++this.attacks % 2 === 0) setTimeout(() => this.running && this.nextForm(), 900);
  }

  step(dt) {
    this.t += dt;
    this.shake = 0;
    const f = this.a;
    this.updateFighter(f, this.b, dt);
    if (f.dashT <= 0) {
      // Charging pieces glide back to their spot after a dash.
      f.x += (this.home.x - f.x) * Math.min(1, dt * 3);
      f.y += (this.home.y - f.y) * Math.min(1, dt * 3);
    }
    this.park();
    this.updateProjectiles(dt);
    this.updateParticles(dt);
  }

  draw() {
    const c = this.ctx;
    c.drawImage(this.bg, -20, -20, W + 40, H + 40);
    this.drawAura(c, this.a);
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill();
    }
    for (const r of this.rings) {
      const k = 1 - r.life / 0.35;
      c.globalAlpha = Math.max(0, r.life / 0.35);
      c.strokeStyle = r.color;
      c.lineWidth = 6 * (1 - k) + 1;
      c.beginPath(); c.arc(r.x, r.y, r.r + (r.max - r.r) * k, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
    for (const p of this.projectiles) this.drawProjectile(c, p);
    this.drawFighter(c, this.a);
  }

  // Only the middle band of the arena is shown; attacks are mostly horizontal.
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = W * dpr;
    this.canvas.height = DEMO_H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, -((H - DEMO_H) / 2) * dpr);
    this.buildBackground(dpr);
  }

  start() {
    this.running = true;
    this.resize();
    this.last = performance.now();
    this.acc = 0;
    const loop = (now) => {
      if (!this.running) return;
      this.acc += Math.min((now - this.last) / 1000, STEP * MAX_STEPS);
      this.last = now;
      while (this.acc >= STEP) { this.step(STEP); this.acc -= STEP; }
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return this;
  }

  stop() { this.running = false; }
}
