// The Lantern Garden — top-down 2D stealth game, canvas only, no assets.
// You are a thief in a walled garden at night. Three guards patrol with
// lantern vision cones. Bushes hide you. Steal 3 moon-keys, reach the gate.

'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 960, H = 640;

// ---------------------------------------------------------------- level
const WALLS = [
  { x: 0, y: 0, w: 960, h: 26 },      // outer walls
  { x: 0, y: 614, w: 960, h: 26 },
  { x: 0, y: 0, w: 26, h: 640 },
  { x: 934, y: 0, w: 26, h: 640 },
  { x: 210, y: 150, w: 180, h: 26 },  // inner hedges / stone walls
  { x: 570, y: 150, w: 180, h: 26 },
  { x: 210, y: 460, w: 180, h: 26 },
  { x: 570, y: 460, w: 180, h: 26 },
  { x: 452, y: 260, w: 56, h: 120 },  // central fountain plinth
];
const BUSHES = [
  { x: 60, y: 70, w: 110, h: 70 },
  { x: 790, y: 70, w: 110, h: 70 },
  { x: 60, y: 500, w: 110, h: 70 },
  { x: 790, y: 500, w: 110, h: 70 },
  { x: 430, y: 60, w: 100, h: 56 },
  { x: 430, y: 524, w: 100, h: 56 },
  { x: 300, y: 290, w: 90, h: 60 },
  { x: 570, y: 290, w: 90, h: 60 },
];
const KEYS = [
  { x: 115, y: 115, taken: false },
  { x: 845, y: 115, taken: false },
  { x: 480, y: 560, taken: false },
];
const EXIT = { x: 428, y: 26, w: 104, h: 30 }; // glowing gate, top centre
const PLAYER_START = { x: 480, y: 595 }; // below the bottom-centre bush, clear of the key inside it
const LANTERNS = [
  { x: 60, y: 60 }, { x: 900, y: 60 }, { x: 60, y: 580 }, { x: 900, y: 580 },
  { x: 480, y: 320 }, { x: 240, y: 320 }, { x: 720, y: 320 },
];
const CONE_RANGE = 185;
const CONE_HALF = 0.58; // radians, ~33 degrees each side

function makeGuards() {
  return [
    { // top patrol, left-right
      x: 300, y: 240, speed: 62, wp: 0, angle: 0, range: CONE_RANGE,
      path: [{ x: 300, y: 240 }, { x: 660, y: 240 }],
    },
    { // bottom patrol, right-left
      x: 660, y: 410, speed: 58, wp: 0, angle: Math.PI, range: CONE_RANGE,
      path: [{ x: 660, y: 410 }, { x: 300, y: 410 }],
    },
    { // middle vertical patrol
      x: 480, y: 180, speed: 52, wp: 0, angle: Math.PI / 2, range: CONE_RANGE,
      path: [{ x: 480, y: 180 }, { x: 480, y: 470 }],
    },
  ];
}

// ---------------------------------------------------------------- state
let guards = makeGuards();
let player = { x: PLAYER_START.x, y: PLAYER_START.y, r: 13 };
let keysGot = 0;
let meter = 0;          // 0..100 detection
let seen = false;       // currently inside a cone and visible
let elapsed = 0;        // seconds of play
let status = 'playing'; // 'playing' | 'caught' | 'won'
let statusT = 0;        // seconds in current status
let frozen = false;     // screenshot (?shot=) scenes are static
let flash = 0;          // alarm flash intensity
let keysDown = {};
let muted = false;

// ---------------------------------------------------------------- audio
let audioCtx = null;
function audio() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; } }
  return audioCtx;
}
function tone(freq, dur, type, gain) {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  try {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.08, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  } catch (e) { /* audio is decorative; never break the game */ }
}
function chime() { tone(880, 0.25, 'sine', 0.09); setTimeout(() => tone(1318, 0.35, 'sine', 0.07), 90); }
function alarmSound() { tone(196, 0.5, 'sawtooth', 0.06); setTimeout(() => tone(147, 0.6, 'sawtooth', 0.06), 180); }

// ---------------------------------------------------------------- helpers
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function pointInRect(px, py, r, pad) {
  pad = pad || 0;
  return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
}
// Segment (ax,ay)-(bx,by) vs rect: true when the line of sight is blocked.
function segHitsRect(ax, ay, bx, by, r) {
  if (pointInRect(ax, ay, r) || pointInRect(bx, by, r)) return true;
  const edges = [
    [r.x, r.y, r.x + r.w, r.y], [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
    [r.x + r.w, r.y + r.h, r.x, r.y + r.h], [r.x, r.y + r.h, r.x, r.y],
  ];
  for (const [x1, y1, x2, y2] of edges) {
    const d = (bx - ax) * (y2 - y1) - (by - ay) * (x2 - x1);
    if (Math.abs(d) < 1e-9) continue;
    const t = ((x1 - ax) * (y2 - y1) - (y1 - ay) * (x2 - x1)) / d;
    const u = ((x1 - ax) * (by - ay) - (y1 - ay) * (bx - ax)) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}
function losClear(ax, ay, bx, by) {
  for (const w of WALLS) if (segHitsRect(ax, ay, bx, by, w)) return false;
  return true;
}
function circleHitsWalls(x, y, r) {
  for (const w of WALLS) {
    const cx = clamp(x, w.x, w.x + w.w), cy = clamp(y, w.y, w.y + w.h);
    if (dist(x, y, cx, cy) < r) return true;
  }
  return false;
}

// ---------------------------------------------------------------- rules
function inBush(x, y) {
  for (const b of BUSHES) if (pointInRect(x, y, b, -6)) return true;
  return false;
}
function playerSeenBy(g) {
  const d = dist(player.x, player.y, g.x, g.y);
  if (d > g.range) return false;
  const ang = Math.atan2(player.y - g.y, player.x - g.x);
  if (Math.abs(angleDiff(ang, g.angle)) > CONE_HALF) return false;
  if (!losClear(g.x, g.y, player.x, player.y)) return false;
  if (inBush(player.x, player.y)) return false; // cover beats the cone
  return true;
}
function detection(dt) {
  seen = false;
  for (const g of guards) if (playerSeenBy(g)) { seen = true; break; }
  const sneaking = keysDown['ShiftLeft'] || keysDown['ShiftRight'];
  if (seen) {
    meter += dt * (sneaking ? 26 : 46); // sneak: slower to spot
    if (meter >= 100) { meter = 100; caught(); }
  } else {
    meter = Math.max(0, meter - dt * 30); // break sight, recover
  }
}
function patrol(g, dt) {
  const target = g.path[g.wp];
  const dx = target.x - g.x, dy = target.y - g.y;
  const d = Math.hypot(dx, dy);
  const want = Math.atan2(dy, dx);
  if (d < 4) { // reached waypoint: turn around, head to the next
    g.wp = (g.wp + 1) % g.path.length;
    return;
  }
  // turn smoothly toward the walking direction, then step
  g.angle += clamp(angleDiff(want, g.angle), -2.4 * dt, 2.4 * dt);
  const step = Math.min(d, g.speed * dt);
  g.x += (dx / d) * step;
  g.y += (dy / d) * step;
}
function movePlayer(dt) {
  let dx = 0, dy = 0;
  if (keysDown['KeyW'] || keysDown['ArrowUp']) dy -= 1;
  if (keysDown['KeyS'] || keysDown['ArrowDown']) dy += 1;
  if (keysDown['KeyA'] || keysDown['ArrowLeft']) dx -= 1;
  if (keysDown['KeyD'] || keysDown['ArrowRight']) dx += 1;
  if (!dx && !dy) return;
  const len = Math.hypot(dx, dy);
  const sneaking = keysDown['ShiftLeft'] || keysDown['ShiftRight'];
  const speed = sneaking ? 88 : 175;
  const nx = player.x + (dx / len) * speed * dt;
  const ny = player.y + (dy / len) * speed * dt;
  if (!circleHitsWalls(nx, player.y, player.r)) player.x = nx;
  if (!circleHitsWalls(player.x, ny, player.r)) player.y = ny;
  player.x = clamp(player.x, 26 + player.r, W - 26 - player.r);
  player.y = clamp(player.y, 26 + player.r, H - 26 - player.r);
}
function collectKeys() {
  for (const k of KEYS) {
    if (!k.taken && dist(player.x, player.y, k.x, k.y) < 26) {
      k.taken = true; keysGot++;
      chime();
    }
  }
}
function checkExit() {
  if (keysGot < 3) return;
  if (pointInRect(player.x, player.y, EXIT, 4)) {
    status = 'won'; statusT = 0;
    tone(523, 0.3, 'sine', 0.09); setTimeout(() => tone(784, 0.4, 'sine', 0.09), 140);
  }
}
function caught() {
  if (status !== 'playing') return;
  status = 'caught'; statusT = 0; flash = 1;
  alarmSound();
}
function resetLevel() {
  guards = makeGuards();
  player.x = PLAYER_START.x; player.y = PLAYER_START.y;
  for (const k of KEYS) k.taken = false;
  keysGot = 0; meter = 0; seen = false; elapsed = 0;
  status = 'playing'; statusT = 0; flash = 0;
}

// ---------------------------------------------------------------- update
function update(dt) {
  if (status === 'playing') {
    elapsed += dt;
    movePlayer(dt);
    for (const g of guards) patrol(g, dt);
    collectKeys();
    detection(dt);
    checkExit();
  } else {
    statusT += dt;
    flash = Math.max(0, flash - dt * 0.7);
    if (status === 'caught' && statusT > 1.8) resetLevel();
  }
}

// ---------------------------------------------------------------- render
function drawCone(g) {
  const grad = ctx.createRadialGradient(g.x, g.y, 10, g.x, g.y, g.range);
  grad.addColorStop(0, 'rgba(244, 217, 123, 0.34)');
  grad.addColorStop(1, 'rgba(244, 217, 123, 0.05)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(g.x, g.y);
  ctx.arc(g.x, g.y, g.range, g.angle - CONE_HALF, g.angle + CONE_HALF);
  ctx.closePath(); ctx.fill();
}
function drawBush(b) {
  ctx.fillStyle = '#14301c';
  ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1e4a28';
  for (let i = 0; i < 7; i++) {
    const bx = b.x + 12 + ((i * 37) % (b.w - 24));
    const by = b.y + 12 + ((i * 53) % (b.h - 24));
    ctx.beginPath(); ctx.arc(bx, by, 7 + (i % 3) * 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(120, 200, 130, 0.25)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); ctx.stroke();
}
function drawKey(k, t) {
  const bob = Math.sin(t * 2 + k.x) * 3;
  const glow = ctx.createRadialGradient(k.x, k.y + bob, 2, k.x, k.y + bob, 26);
  glow.addColorStop(0, 'rgba(244, 217, 123, 0.55)');
  glow.addColorStop(1, 'rgba(244, 217, 123, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(k.x, k.y + bob, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f4d97b';
  ctx.beginPath(); ctx.arc(k.x, k.y + bob, 9, Math.PI * 0.15, Math.PI * 1.65); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(k.x + 2, k.y + bob, 6, Math.PI * 1.15, Math.PI * 0.6, true); ctx.fill();
  ctx.fillStyle = '#f4d97b';
  ctx.fillRect(k.x + 7, k.y + bob - 2, 12, 3);
  ctx.fillRect(k.x + 15, k.y + bob - 2, 3, 7);
}
function drawGuard(g) {
  drawCone(g);
  // lantern light pool
  const pool = ctx.createRadialGradient(g.x, g.y, 4, g.x, g.y, 46);
  pool.addColorStop(0, 'rgba(244, 217, 123, 0.30)');
  pool.addColorStop(1, 'rgba(244, 217, 123, 0)');
  ctx.fillStyle = pool;
  ctx.beginPath(); ctx.arc(g.x, g.y, 46, 0, Math.PI * 2); ctx.fill();
  // body: dark blue cloak, facing the cone
  ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.angle);
  ctx.fillStyle = '#2c3e63';
  ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-11, -11); ctx.lineTo(-11, 11); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f4d97b';
  ctx.beginPath(); ctx.arc(10, 0, 4, 0, Math.PI * 2); ctx.fill(); // lantern
  ctx.restore();
  ctx.fillStyle = '#dfe8f2';
  ctx.beginPath(); ctx.arc(g.x, g.y, 4.5, 0, Math.PI * 2); ctx.fill();
}
function drawPlayer(t) {
  const hidden = inBush(player.x, player.y);
  const sneaking = keysDown['ShiftLeft'] || keysDown['ShiftRight'];
  ctx.save();
  ctx.globalAlpha = hidden ? 0.55 : 1; // half-faded while hidden in a bush
  ctx.translate(player.x, player.y);
  ctx.fillStyle = '#1d1a24'; // dark cloak
  ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(12, 10); ctx.lineTo(-12, 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2e2a3a';
  ctx.beginPath(); ctx.arc(0, -4, 8, 0, Math.PI * 2); ctx.fill(); // hood
  ctx.fillStyle = '#f4d97b';
  ctx.beginPath(); ctx.arc(-3, -5, 1.6, 0, Math.PI * 2); ctx.arc(3, -5, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (sneaking && status === 'playing') {
    ctx.fillStyle = 'rgba(223, 232, 216, 0.75)';
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('sneaking…', player.x, player.y - 22);
  }
}
function drawExit(t) {
  const open = keysGot >= 3;
  const pulse = 0.5 + 0.3 * Math.sin(t * 3);
  const glow = ctx.createRadialGradient(480, 40, 4, 480, 40, open ? 90 : 55);
  glow.addColorStop(0, open ? `rgba(150, 255, 180, ${0.55 * pulse + 0.25})` : 'rgba(150, 255, 180, 0.18)');
  glow.addColorStop(1, 'rgba(150, 255, 180, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(380, 0, 200, 130);
  ctx.strokeStyle = open ? '#a8ffc0' : '#5c7a5e'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(480, 52, 40, Math.PI, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(440, 52); ctx.lineTo(440, 26); ctx.moveTo(520, 52); ctx.lineTo(520, 26); ctx.stroke();
  ctx.fillStyle = open ? '#a8ffc0' : '#7d9a7e';
  ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(open ? 'EXIT OPEN' : 'EXIT · ' + keysGot + '/3 KEYS', 480, 140); // below the gate-side bush, clear of the HUD meter
}
function drawHUD() {
  // keys
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillStyle = '#f4d97b';
  ctx.fillText('☾ keys  ' + keysGot + ' / 3', 36, 46);
  // timer
  const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
  ctx.fillStyle = '#dfe8d8';
  ctx.textAlign = 'right';
  ctx.fillText('time  ' + m + ':' + String(s).padStart(2, '0'), W - 36, 46);
  // detection meter, top centre
  const bw = 220, bx = (W - bw) / 2, by = 36;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bx - 3, by - 3, bw + 6, 18);
  ctx.fillStyle = meter > 66 ? '#e5484d' : meter > 33 ? '#f4a259' : '#f4d97b';
  ctx.fillRect(bx, by, bw * (meter / 100), 12);
  ctx.strokeStyle = '#dfe8d8'; ctx.lineWidth = 1;
  ctx.strokeRect(bx - 3, by - 3, bw + 6, 18);
  ctx.fillStyle = '#dfe8d8'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(seen ? 'SEEN!' : 'detection', W / 2, by + 26);
}
function drawOverlayCard(title, lines, accent) {
  ctx.fillStyle = 'rgba(4, 8, 6, 0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0e1a12';
  ctx.strokeStyle = accent; ctx.lineWidth = 2;
  const cw = 460, ch = 240, cx = (W - cw) / 2, cy = (H - ch) / 2;
  ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, 12); ctx.fill(); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = accent; ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText(title, W / 2, cy + 62);
  ctx.fillStyle = '#dfe8d8'; ctx.font = '16px system-ui, sans-serif';
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, cy + 108 + i * 28));
  ctx.fillStyle = '#8fa38a'; ctx.font = '13px system-ui, sans-serif';
  ctx.fillText('press R to play again', W / 2, cy + ch - 26);
}
function render(t) {
  // garden floor: dark grass with faint stone paths
  ctx.fillStyle = '#0e2416'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#122b1b';
  ctx.fillRect(26, 300, 908, 40); ctx.fillRect(440, 26, 80, 588);
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect(30 + ((i * 173) % 900), 30 + ((i * 97) % 580), 3, 3);
  }
  drawExit(t);
  for (const b of BUSHES) drawBush(b);
  // fountain plinth shimmer
  ctx.fillStyle = '#1b3a4a';
  ctx.beginPath(); ctx.arc(480, 320, 24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f6a86';
  ctx.beginPath(); ctx.arc(480, 320, 14 + 3 * Math.sin(t * 2), 0, Math.PI * 2); ctx.fill();
  // walls
  for (const w of WALLS) {
    ctx.fillStyle = '#3a4149'; ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = '#4a545f'; ctx.fillRect(w.x, w.y, w.w, 4);
  }
  // lanterns on the walls
  for (const l of LANTERNS) {
    const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, 34);
    g.addColorStop(0, 'rgba(244, 217, 123, 0.5)');
    g.addColorStop(1, 'rgba(244, 217, 123, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(l.x, l.y, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f4d97b';
    ctx.beginPath(); ctx.arc(l.x, l.y, 4, 0, Math.PI * 2); ctx.fill();
  }
  for (const k of KEYS) if (!k.taken) drawKey(k, t);
  for (const g of guards) drawGuard(g);
  drawPlayer(t);
  drawHUD();
  if (status === 'caught') {
    if (flash > 0) { ctx.fillStyle = `rgba(229, 72, 77, ${flash * 0.35})`; ctx.fillRect(0, 0, W, H); }
    drawOverlayCard('CAUGHT!', ['A guard raised the alarm.', 'The night begins again…'], '#e5484d');
  } else if (status === 'won') {
    const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
    drawOverlayCard('YOU ESCAPED', [
      'All 3 moon-keys stolen, gate slipped unseen.',
      'Time: ' + m + ':' + String(s).padStart(2, '0') + '  ·  detection peaked, never caught.',
    ], '#a8ffc0');
  }
  if (status === 'playing' && elapsed < 6 && !frozen) {
    ctx.fillStyle = 'rgba(223, 232, 216, 0.85)';
    ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Stay out of the yellow cones — bushes hide you. Steal 3 moon-keys, then reach the gate.', W / 2, H - 44);
  }
}

// ---------------------------------------------------------------- shots
// ?shot=start | sneak | alarm | win — fixed, readable scenes for screenshots.
function applyShot(shot) {
  frozen = true;
  if (shot === 'sneak') {
    player.x = 345; player.y = 320;           // tucked in the middle bush
    guards[0].x = 420; guards[0].y = 240; guards[0].angle = 2.05; // cone sweeping down-left onto the bush
    guards[1].x = 620; guards[1].y = 410; guards[1].angle = Math.PI;
    guards[2].x = 480; guards[2].y = 180; guards[2].angle = Math.PI / 2;
    KEYS[0].taken = true; keysGot = 1;
    meter = 34; elapsed = 47;
  } else if (shot === 'alarm') {
    player.x = 480; player.y = 330;           // out in the open, dead in a cone
    guards[2].x = 480; guards[2].y = 230; guards[2].angle = Math.PI / 2;
    guards[0].x = 330; guards[0].y = 240; guards[0].angle = 0;
    guards[1].x = 640; guards[1].y = 410; guards[1].angle = Math.PI;
    KEYS[0].taken = true; KEYS[1].taken = true; keysGot = 2;
    meter = 92; seen = true; elapsed = 83;
  } else if (shot === 'win') {
    for (const k of KEYS) k.taken = true;
    keysGot = 3; status = 'won'; elapsed = 118; meter = 12;
    player.x = 480; player.y = 60;
  }
  // 'start' keeps the opening view: player at the gate-side start, all keys out.
}

// ---------------------------------------------------------------- input + loop
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keysDown[e.code] = true;
  audio(); // first gesture unlocks WebAudio
  if (e.code === 'KeyR') resetLevel();
  if (e.code === 'KeyM') muted = !muted;
});
window.addEventListener('keyup', (e) => { keysDown[e.code] = false; });

const shot = new URLSearchParams(location.search).get('shot');
if (shot) applyShot(shot);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!frozen) update(dt);
  render(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
