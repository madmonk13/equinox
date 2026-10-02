// Tiny WebAudio synth for sound effects — no audio assets needed.
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('equinox-muted') === '1'; } catch { /* storage unavailable */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('equinox-muted', m ? '1' : '0'); } catch { /* ignore */ }
}

function tone({ freq = 440, to = null, dur = 0.15, type = 'sine', vol = 0.12, delay = 0 }) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const gn = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gn.gain.setValueAtTime(0.0001, t0);
  gn.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(gn).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.15, freq = 1200, q = 0.8, delay = 0 }) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const gn = a.createGain();
  gn.gain.value = vol;
  src.connect(f).connect(gn).connect(a.destination);
  src.start(t0);
}

export const sfx = {
  unlock: () => ac(),
  select: () => tone({ freq: 660, dur: 0.06, type: 'triangle', vol: 0.07 }),
  move: () => tone({ freq: 280, to: 520, dur: 0.14, vol: 0.08 }),
  deny: () => tone({ freq: 180, to: 120, dur: 0.12, type: 'square', vol: 0.05 }),
  challenge: () => { tone({ freq: 220, dur: 0.18, type: 'sawtooth', vol: 0.07 }); tone({ freq: 330, dur: 0.25, type: 'sawtooth', vol: 0.07, delay: 0.12 }); },
  shot: (style) => {
    if (style === 'boulder') noise({ dur: 0.25, freq: 300, vol: 0.18 });
    else if (style === 'fireball' || style === 'flame') noise({ dur: 0.3, freq: 700, vol: 0.14 });
    else if (style === 'lightning' || style === 'bolt' || style === 'gaze') tone({ freq: 1400, to: 300, dur: 0.15, type: 'sawtooth', vol: 0.05 });
    else tone({ freq: 900, to: 400, dur: 0.1, type: 'triangle', vol: 0.06 });
  },
  swing: () => noise({ dur: 0.1, freq: 2500, vol: 0.1, q: 2 }),
  aura: () => { tone({ freq: 160, to: 90, dur: 0.6, type: 'sawtooth', vol: 0.06 }); noise({ dur: 0.5, freq: 500, vol: 0.08 }); },
  hit: () => { tone({ freq: 140, to: 70, dur: 0.12, type: 'square', vol: 0.08 }); noise({ dur: 0.08, freq: 1800, vol: 0.12 }); },
  death: () => { tone({ freq: 400, to: 60, dur: 0.8, type: 'sawtooth', vol: 0.09 }); noise({ dur: 0.7, freq: 400, vol: 0.14 }); },
  spell: () => [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.06, delay: i * 0.07 })),
  count: () => tone({ freq: 440, dur: 0.12, type: 'square', vol: 0.05 }),
  go: () => tone({ freq: 880, dur: 0.3, type: 'square', vol: 0.06 }),
  win: () => [392, 523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.4, type: 'triangle', vol: 0.07, delay: i * 0.12 })),
};
