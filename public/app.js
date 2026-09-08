/* =========================================================
   PIXEL SIEGE — CLIENTE (Socket.IO)
   Porta completa das mecânicas da versão alpha (BroadcastChannel) para o
   servidor dedicado. O servidor cuida de salas, placar e spawn de drops;
   o cliente cuida de física, mira, tiro, detecção de acerto no PRÓPRIO
   personagem e renderização.
========================================================= */
(function () {
'use strict';

/* =========================================================
   CONSTANTES (compartilhadas com o servidor via shared.js)
========================================================= */
const { WORLD_W, WORLD_H, PLATFORMS, SPAWNS, WEAPONS, DROP_FALL_SPEED, DROP_SIZE,
        PICKUP_RADIUS, THROW_SPEED, THROW_LIFE, THROW_SIZE, STUN_MS, RESPAWN_MS } = PS;

/* Física "arcade" — idêntica ao alpha */
const GRAVITY = 0.42;
const MOVE_SPEED = 1.7;
const GROUND_MOVE_SPEED = 2.55;
const GROUND_ACCEL = GROUND_MOVE_SPEED * 0.4;
const AIR_ACCEL = MOVE_SPEED * 0.35;
const JUMP_VEL = -6.6;
const AIR_JUMP_VEL = -6.0;   // pulo duplo é levemente mais fraco que o do chão
const MAX_AIR_JUMPS = 1;     // 1 = pulo duplo (chão + 1 no ar)
const JUMP_CUT_MULTIPLIER = 0.45;
const FRICTION = 0.78;
const AIR_FRICTION = 0.9;
const REF_FRAME_MS = 1000 / 60;
const COYOTE_MS = 80;        // pulo permitido logo após sair da borda
const JUMP_BUFFER_MS = 100;  // pulo registrado um pouco antes de tocar o chão

const STATE_RATE = 55; // ms entre envios de estado
const REMOTE_TIMEOUT = 8000;

/* =========================================================
   ESTADO
========================================================= */
const socket = io({ transports: ['websocket', 'polling'] });

let myId = null;
let myName = 'JOGADOR';
let myColor = '#3ee6d6';
let isHost = false;
let roomCode = null;
let currentState = 'menu'; // menu | lobby | playing
let connected = false;

let players = new Map();     // id -> estado (inclui o meu, selfPlayer)
let selfPlayer = null;
let bulletsSelf = [];
let bulletsIncoming = [];
let throwsSelf = [];
let throwsIncoming = [];
let drops = [];
let particles = [];
let lastStateSent = 0;
let lastKillerName = null;

const input = { left: false, right: false, up: false, mouseX: 360, mouseY: 203, firing: false,
                jumpPressedAt: -1e9, lastGroundAt: -1e9 };

/* =========================================================
   HELPERS
========================================================= */
const $ = (sel) => document.querySelector(sel);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 9);
const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id).classList.add('active');
}
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function setConn(text, cls) {
  const el = $('#connStatus');
  el.textContent = text;
  el.className = 'conn ' + (cls || '');
}

const canvas = $('#game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const uiCanvas = $('#uiLayer');
const uiCtx = uiCanvas.getContext('2d');
let uiScale = 1, uiDpr = 1;

/* =========================================================
   ESCALONAMENTO 16:9 DO STAGE
========================================================= */
function resizeStage() {
  const stage = $('#stage');
  if (!stage) return;
  const ratio = WORLD_W / WORLD_H;
  let w = window.innerWidth, h = w / ratio;
  if (h > window.innerHeight) { h = window.innerHeight; w = h * ratio; }
  w = Math.round(w); h = Math.round(h);
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';
  uiDpr = window.devicePixelRatio || 1;
  uiScale = w / WORLD_W;
  uiCanvas.width = Math.round(w * uiDpr);
  uiCanvas.height = Math.round(h * uiDpr);
}
window.addEventListener('resize', resizeStage);
window.addEventListener('orientationchange', resizeStage);
resizeStage();

/* =========================================================
   SFX (WebAudio sintetizado)
========================================================= */
let actx = null;
function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function beep(freq, dur, type, vol, slideTo) {
  try {
    const c = audioCtx();
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    gain.gain.setValueAtTime(vol || 0.06, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(); osc.stop(c.currentTime + dur);
  } catch (e) { /* sem áudio */ }
}
const sfxShoot = (w) => w === 'pistol' ? beep(520, 0.08, 'square', 0.05, 300)
                    : w === 'rifle' ? beep(340, 0.05, 'square', 0.04, 220)
                    : beep(140, 0.25, 'sawtooth', 0.07, 60);
const sfxHit    = () => beep(180, 0.12, 'square', 0.06, 60);
const sfxJump   = () => beep(400, 0.09, 'triangle', 0.04, 650);
const sfxJump2  = () => beep(560, 0.09, 'triangle', 0.045, 900);
const sfxDeath  = () => beep(220, 0.4, 'sawtooth', 0.08, 40);
const sfxSwing  = () => beep(260, 0.09, 'triangle', 0.05, 120);
const sfxThrow  = () => beep(200, 0.1, 'square', 0.04, 90);
const sfxPickup = () => beep(600, 0.12, 'triangle', 0.05, 900);
const sfxKill   = () => { beep(700, 0.08, 'square', 0.05, 1000); setTimeout(() => beep(1000, 0.12, 'square', 0.05, 1400), 70); };

/* =========================================================
   PLAYER FACTORY
========================================================= */
function makeSpawn() {
  // Prefere spawns longe dos inimigos vivos
  const others = [...players.values()].filter(p => p.id !== myId && p.alive);
  if (!others.length) return SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
  let best = null, bestD = -1;
  for (const sp of SPAWNS) {
    const d = Math.min(...others.map(o => Math.hypot(o.x - sp.x, o.y - sp.y)));
    if (d > bestD) { bestD = d; best = sp; }
  }
  return best;
}
function newPlayerState(id, name, color, host) {
  const sp = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
  return {
    id, name, color, host: !!host,
    x: sp.x, y: sp.y, w: 10, h: 16,
    vx: 0, vy: 0, onGround: false,
    airJumpsUsed: 0,
    angle: 0, facing: 1,
    weapon: 'sword', gunType: null, ammo: 0,
    lastShot: 0, lastMelee: 0,
    hp: 100, alive: true, kills: 0, deaths: 0,
    stunUntil: 0, stunned: false,
    rx: sp.x, ry: sp.y, hasRemote: false,
    lastSeen: performance.now(),
    respawnAt: 0,
  };
}
function ensurePlayer(info) {
  let p = players.get(info.id);
  if (!p) { p = newPlayerState(info.id, info.name, info.color, info.host); players.set(info.id, p); }
  else { p.name = info.name ?? p.name; p.color = info.color ?? p.color; p.host = !!info.host; }
  if (typeof info.kills === 'number') p.kills = info.kills;
  if (typeof info.deaths === 'number') p.deaths = info.deaths;
  return p;
}
function isStunned(p) {
  if (!p) return false;
  return p.id === myId ? (performance.now() < p.stunUntil) : !!p.stunned;
}

/* =========================================================
   SOCKET — CONEXÃO / LOBBY
========================================================= */
socket.on('connect', () => {
  connected = true;
  myId = socket.id;
  setConn('● SERVIDOR ONLINE', 'ok');
  $('#btnCreate').disabled = false;
  $('#btnJoin').disabled = false;
});
socket.on('disconnect', () => {
  connected = false;
  setConn('● DESCONECTADO — TENTANDO RECONECTAR...', 'bad');
  $('#btnCreate').disabled = true;
  $('#btnJoin').disabled = true;
  if (currentState !== 'menu') {
    toast('CONEXÃO PERDIDA COM O SERVIDOR', 4000);
    resetToMenu();
  }
});
socket.on('connect_error', () => setConn('● FALHA AO CONECTAR — VERIFIQUE O SERVIDOR', 'bad'));
socket.on('errorMsg', (msg) => toast(msg));

socket.on('roomCreated', ({ code, you, players: list }) => {
  isHost = true;
  applyIdentity(you);
  players.clear();
  list.forEach(ensurePlayer);
  enterLobby(code);
});
socket.on('roomJoined', ({ code, you, players: list, started }) => {
  isHost = !!you.host;
  applyIdentity(you);
  players.clear();
  list.forEach(ensurePlayer);
  enterLobby(code);
  if (started) toast('PARTIDA EM ANDAMENTO — ENTRANDO...');
});
socket.on('playerJoined', (p) => {
  ensurePlayer(p);
  renderLobbyList();
  if (currentState === 'playing') toast(p.name + ' ENTROU NA PARTIDA');
});
socket.on('playerLeft', (id) => {
  const p = players.get(id);
  if (p && currentState === 'playing') toast(p.name + ' SAIU');
  players.delete(id);
  renderLobbyList();
});
socket.on('hostChanged', (id) => {
  players.forEach(p => p.host = p.id === id);
  isHost = id === myId;
  if (isHost && currentState === 'lobby') toast('VOCÊ AGORA É O HOST');
  updateLobbyControls();
  renderLobbyList();
});
socket.on('scores', (list) => {
  list.forEach(info => {
    const p = players.get(info.id);
    if (p) { p.kills = info.kills; p.deaths = info.deaths; p.host = info.host; }
  });
  renderScoreboard();
});
socket.on('gameStarted', ({ drops: snapshot } = {}) => {
  if (currentState !== 'playing') startMatch();
  drops = (snapshot || []).map(d => ({
    id: d.id, weapon: d.weapon, x: d.x, landY: d.landY,
    startTime: performance.now() - (d.elapsedMs || 0), y: 0, landed: false,
  }));
});

function applyIdentity(you) {
  myId = you.id; myName = you.name; myColor = you.color;
}

/* =========================================================
   SOCKET — JOGO
========================================================= */
socket.on('state', (msg) => {
  if (msg.id === myId || currentState !== 'playing') return;
  let p = players.get(msg.id);
  if (!p) p = ensurePlayer({ id: msg.id, name: '???', color: '#888' });
  if (!p.hasRemote) { p.x = msg.x; p.y = msg.y; p.hasRemote = true; }
  p.rx = msg.x; p.ry = msg.y;
  p.angle = msg.angle; p.facing = msg.facing;
  p.weapon = msg.weapon; p.hp = msg.hp;
  p.alive = msg.alive; p.onGround = msg.onGround;
  p.stunned = !!msg.stunned;
  p.lastSeen = performance.now();
});

socket.on('shoot', (msg) => {
  const w = WEAPONS[msg.weapon];
  if (!w || w.melee) return;
  bulletsIncoming.push({
    id: msg.bid, ownerId: msg.id,
    x: msg.x, y: msg.y,
    vx: Math.cos(msg.angle) * w.bulletSpeed, vy: Math.sin(msg.angle) * w.bulletSpeed,
    weapon: msg.weapon, life: w.life,
  });
  spawnMuzzleFlash(msg.x, msg.y, msg.angle, w.color);
});

socket.on('melee', (msg) => {
  spawnSwordSwing(msg.x, msg.y, msg.angle, WEAPONS.sword.color);
  if (selfPlayer && selfPlayer.alive) {
    const cx = selfPlayer.x + selfPlayer.w / 2, cy = selfPlayer.y + selfPlayer.h / 2 - 2;
    if (pointInMeleeArc(cx, cy, msg.x, msg.y, msg.angle, WEAPONS.sword.range, WEAPONS.sword.arc)) {
      applyDamageToSelf(WEAPONS.sword.damage, msg.id, cx, cy);
    }
  }
});

socket.on('throw', (msg) => {
  if (!WEAPONS[msg.weapon]) return;
  throwsIncoming.push({
    id: msg.tid, ownerId: msg.id,
    x: msg.x, y: msg.y,
    vx: Math.cos(msg.angle) * THROW_SPEED, vy: Math.sin(msg.angle) * THROW_SPEED,
    weapon: msg.weapon, life: THROW_LIFE,
  });
});

socket.on('hitconfirm', (msg) => { spawnHitSpark(msg.x, msg.y); beep(900, 0.04, 'square', 0.03, 1200); });
socket.on('stunconfirm', (msg) => spawnStunSpark(msg.x, msg.y));

socket.on('death', (msg) => {
  const victim = players.get(msg.id);
  if (victim && msg.id !== myId) {
    victim.alive = false;
    spawnDeathBurst(victim.x + victim.w / 2, victim.y + victim.h / 2, victim.color);
  }
  const killerName = msg.killerName || 'A ARENA';
  const victimName = msg.name || (victim ? victim.name : '???');
  pushKillFeed(killerName, victimName, msg.byId === myId);
  if (msg.byId === myId && msg.id !== myId) { sfxKill(); toast('VOCÊ ELIMINOU ' + victimName, 1500); }
});

socket.on('dropspawn', (d) => {
  if (currentState !== 'playing' || drops.some(x => x.id === d.id)) return;
  drops.push({ id: d.id, weapon: d.weapon, x: d.x, landY: d.landY, startTime: performance.now(), y: 0, landed: false });
});
socket.on('droppickup', ({ dropId, byId, weapon }) => {
  drops = drops.filter(d => d.id !== dropId);
  if (byId === myId && selfPlayer && selfPlayer.alive) {
    // Confirmado pelo servidor: equipa a arma
    selfPlayer.gunType = weapon;
    selfPlayer.ammo = WEAPONS[weapon].mag;
    selfPlayer.weapon = weapon;
    updateWeaponHud();
    sfxPickup();
    toast(WEAPONS[weapon].name + ' COLETADA', 1400);
  }
});

/* =========================================================
   MENU / LOBBY
========================================================= */
$('#btnCreate').disabled = true;
$('#btnJoin').disabled = true;

$('#btnShowJoin').addEventListener('click', () => {
  const jb = $('#joinBox');
  jb.style.display = jb.style.display === 'none' ? 'block' : 'none';
  if (jb.style.display === 'block') $('#codeInput').focus();
});
$('#btnCreate').addEventListener('click', () => {
  if (!connected) return toast('SEM CONEXÃO COM O SERVIDOR');
  audioCtx();
  socket.emit('createRoom', { name: readName() });
});
$('#btnJoin').addEventListener('click', joinFromInput);
$('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinFromInput(); });
$('#nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnCreate').click(); });

function readName() {
  const n = ($('#nameInput').value.trim() || 'JOGADOR').toUpperCase().slice(0, 12);
  try { localStorage.setItem('ps_name', n); } catch (e) {}
  return n;
}
try { const saved = localStorage.getItem('ps_name'); if (saved) $('#nameInput').value = saved; } catch (e) {}

function joinFromInput() {
  if (!connected) return toast('SEM CONEXÃO COM O SERVIDOR');
  const code = $('#codeInput').value.trim().toUpperCase();
  if (code.length !== 4) return toast('DIGITE UM CÓDIGO DE 4 LETRAS');
  audioCtx();
  socket.emit('joinRoom', { code, name: readName() });
}

function enterLobby(code) {
  roomCode = code;
  currentState = 'lobby';
  showScreen('lobbyScreen');
  const box = $('#codeBox'); box.innerHTML = '';
  code.split('').forEach(ch => {
    const d = document.createElement('div');
    d.className = 'code-letter'; d.textContent = ch;
    box.appendChild(d);
  });
  updateLobbyControls();
  renderLobbyList();
}
function updateLobbyControls() {
  $('#btnStart').style.display = isHost ? 'block' : 'none';
  $('#waitHint').style.display = isHost ? 'none' : 'block';
}
function renderLobbyList() {
  const ul = $('#playerList'); ul.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    const sw = document.createElement('div');
    sw.className = 'swatch'; sw.style.background = p.color;
    li.appendChild(sw);
    const span = document.createElement('span');
    span.textContent = p.name;
    li.appendChild(span);
    if (p.host) { const t = document.createElement('span'); t.className = 'tag-host'; t.textContent = p.id === myId ? 'HOST · VOCÊ' : 'HOST'; li.appendChild(t); }
    else if (p.id === myId) { const t = document.createElement('span'); t.className = 'tag-you'; t.textContent = 'VOCÊ'; li.appendChild(t); }
    ul.appendChild(li);
  });
}

$('#btnStart').addEventListener('click', () => socket.emit('startGame'));
$('#btnLeaveLobby').addEventListener('click', () => { socket.emit('leaveRoom'); resetToMenu(); });
$('#exitBtn').addEventListener('click', () => { socket.emit('leaveRoom'); resetToMenu(); });

function resetToMenu() {
  currentState = 'menu';
  players.clear();
  selfPlayer = null;
  isHost = false;
  roomCode = null;
  bulletsSelf = []; bulletsIncoming = []; throwsSelf = []; throwsIncoming = []; drops = []; particles = [];
  input.left = input.right = input.up = input.firing = false;
  $('#respawnOverlay').classList.remove('active');
  $('#killfeed').innerHTML = '';
  $('#scoreboard').innerHTML = '';
  showScreen('menuScreen');
}

/* =========================================================
   INICIAR PARTIDA
========================================================= */
let lastTime = performance.now();
function startMatch() {
  currentState = 'playing';
  showScreen('gameScreen');
  $('#roomTag').textContent = 'SALA ' + roomCode;

  const me = players.get(myId);
  selfPlayer = newPlayerState(myId, myName, myColor, isHost);
  if (me) { selfPlayer.kills = me.kills; selfPlayer.deaths = me.deaths; }
  players.set(myId, selfPlayer);
  players.forEach(p => { if (p.id !== myId) { p.hasRemote = false; p.lastSeen = performance.now(); } });

  bulletsSelf = []; bulletsIncoming = []; particles = [];
  drops = []; throwsSelf = []; throwsIncoming = [];
  $('#respawnOverlay').classList.remove('active');
  updateWeaponHud();
  renderScoreboard();
  bindGameInput();
  resizeStage();
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

/* =========================================================
   INPUT
========================================================= */
let inputBound = false;
function bindGameInput() {
  if (inputBound) return;
  inputBound = true;

  window.addEventListener('keydown', e => {
    if (currentState !== 'playing') return;
    if (e.repeat) return;
    const k = e.key;
    if (['a', 'A', 'ArrowLeft'].includes(k)) input.left = true;
    if (['d', 'D', 'ArrowRight'].includes(k)) input.right = true;
    if (['w', 'W', 'ArrowUp', ' '].includes(k)) { input.up = true; input.jumpPressedAt = performance.now(); e.preventDefault(); }
    if (k === '1') switchWeapon('sword');
    if (k === '2') { if (selfPlayer && selfPlayer.gunType) switchWeapon(selfPlayer.gunType); else toast('SEM ARMA DE FOGO — PRESSIONE E PERTO DE UM DROP'); }
    if (k === 'e' || k === 'E') tryPickupDrop();
    if (k === 'q' || k === 'Q') cycleWeapon();
  });
  window.addEventListener('keyup', e => {
    const k = e.key;
    if (['a', 'A', 'ArrowLeft'].includes(k)) input.left = false;
    if (['d', 'D', 'ArrowRight'].includes(k)) input.right = false;
    if (['w', 'W', 'ArrowUp', ' '].includes(k)) {
      input.up = false;
      // pulo variável
      if (selfPlayer && selfPlayer.alive && selfPlayer.vy < 0) selfPlayer.vy *= JUMP_CUT_MULTIPLIER;
    }
  });
  window.addEventListener('blur', () => { input.left = input.right = input.up = input.firing = false; });

  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    input.mouseX = (e.clientX - r.left) / r.width * WORLD_W;
    input.mouseY = (e.clientY - r.top) / r.height * WORLD_H;
  });
  canvas.addEventListener('mousedown', e => {
    if (currentState !== 'playing') return;
    if (e.button === 0) {
      input.firing = true;
      if (!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
      if (selfPlayer.weapon === 'sword') performSwordAttack();
      else if (selfPlayer.ammo > 0) tryShoot();
      else throwWeapon();
    } else if (e.button === 2) {
      performSwordAttack();
    }
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) input.firing = false; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); cycleWeapon(); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function cycleWeapon() {
  if (!selfPlayer) return;
  if (selfPlayer.weapon === 'sword') { if (selfPlayer.gunType) switchWeapon(selfPlayer.gunType); }
  else switchWeapon('sword');
}
function switchWeapon(w) {
  if (!selfPlayer || !selfPlayer.alive) return;
  if (w !== 'sword' && selfPlayer.gunType !== w) return;
  selfPlayer.weapon = w;
  updateWeaponHud();
}
function updateWeaponHud() {
  if (!selfPlayer) return;
  const active = selfPlayer.weapon;
  $('#wname').textContent = WEAPONS[active].name;
  const wammo = $('#wammo');
  if (active === 'sword') wammo.textContent = selfPlayer.gunType ? WEAPONS[selfPlayer.gunType].name + ' NO SLOT 2 · ' + selfPlayer.ammo + ' BALAS' : 'SEM ARMA DE FOGO';
  else wammo.textContent = selfPlayer.ammo > 0 ? 'MUNIÇÃO: ' + selfPlayer.ammo + ' / ' + WEAPONS[selfPlayer.gunType].mag : 'VAZIA — CLIQUE PARA ARREMESSAR';
  document.querySelectorAll('.wkey').forEach(el => {
    const isGunSlot = el.dataset.w === 'gun';
    el.classList.toggle('active', isGunSlot ? active !== 'sword' : active === 'sword');
    el.classList.toggle('empty', isGunSlot && !selfPlayer.gunType);
  });
}

/* =========================================================
   TIRO
========================================================= */
function aimAngle() {
  const cx = selfPlayer.x + selfPlayer.w / 2, cy = selfPlayer.y + selfPlayer.h / 2 - 2;
  return { cx, cy, angle: Math.atan2(input.mouseY - cy, input.mouseX - cx) };
}
function tryShoot() {
  if (!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
  if (selfPlayer.weapon === 'sword' || selfPlayer.ammo <= 0) return;
  const w = WEAPONS[selfPlayer.weapon];
  const now = performance.now();
  if (now - selfPlayer.lastShot < w.fireRate) return;
  selfPlayer.lastShot = now;
  selfPlayer.ammo--;
  updateWeaponHud();

  const { cx, cy } = aimAngle();
  let angle = aimAngle().angle + rand(-w.spread, w.spread);
  const bx = cx + Math.cos(angle) * 8, by = cy + Math.sin(angle) * 8;
  const bid = uid();
  bulletsSelf.push({ id: bid, x: bx, y: by, vx: Math.cos(angle) * w.bulletSpeed, vy: Math.sin(angle) * w.bulletSpeed, weapon: selfPlayer.weapon, life: w.life });
  spawnMuzzleFlash(bx, by, angle, w.color);
  sfxShoot(selfPlayer.weapon);
  // recuo leve
  selfPlayer.vx -= Math.cos(angle) * (w.damage / 60);

  socket.emit('shoot', { bid, x: bx, y: by, angle, weapon: selfPlayer.weapon });
  if (selfPlayer.ammo === 0) toast('PENTE VAZIO — CLIQUE PARA ARREMESSAR A ARMA', 1600);
}

/* =========================================================
   ESPADA
========================================================= */
function pointInMeleeArc(px, py, ox, oy, angle, range, arc) {
  const dx = px - ox, dy = py - oy;
  if (Math.hypot(dx, dy) > range) return false;
  let diff = Math.atan2(dy, dx) - angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) <= arc / 2;
}
function performSwordAttack() {
  if (!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
  const w = WEAPONS.sword;
  const now = performance.now();
  if (now - selfPlayer.lastMelee < w.cooldown) return;
  selfPlayer.lastMelee = now;
  const { cx, cy, angle } = aimAngle();
  spawnSwordSwing(cx, cy, angle, w.color);
  sfxSwing();
  socket.emit('melee', { x: cx, y: cy, angle });
}

/* =========================================================
   ARREMESSO / ATORDOAMENTO
========================================================= */
function throwWeapon() {
  if (!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
  if (!selfPlayer.gunType || selfPlayer.ammo > 0) return;
  const weapon = selfPlayer.gunType;
  const { cx, cy, angle } = aimAngle();
  const tx = cx + Math.cos(angle) * 8, ty = cy + Math.sin(angle) * 8;
  const tid = uid();
  throwsSelf.push({ id: tid, x: tx, y: ty, vx: Math.cos(angle) * THROW_SPEED, vy: Math.sin(angle) * THROW_SPEED, weapon, life: THROW_LIFE });
  sfxThrow();
  socket.emit('throw', { tid, weapon, x: tx, y: ty, angle });
  selfPlayer.gunType = null; selfPlayer.ammo = 0; selfPlayer.weapon = 'sword';
  updateWeaponHud();
}
function applyStunToSelf(byId, hx, hy) {
  if (!selfPlayer.alive) return;
  selfPlayer.stunUntil = performance.now() + STUN_MS;
  spawnStunSpark(hx, hy);
  sfxHit();
  socket.emit('stunconfirm', { byId, x: hx, y: hy });
}

/* =========================================================
   DROPS
========================================================= */
function updateDrops() {
  const now = performance.now();
  drops.forEach(d => {
    const elapsed = (now - d.startTime) / 1000;
    d.y = Math.min(d.landY, elapsed * DROP_FALL_SPEED);
    d.landed = d.y >= d.landY;
  });
}
function nearestDrop() {
  if (!selfPlayer) return null;
  const cx = selfPlayer.x + selfPlayer.w / 2, cy = selfPlayer.y + selfPlayer.h / 2;
  let best = null, bestDist = PICKUP_RADIUS;
  drops.forEach(d => {
    if (!d.landed) return;
    const dist = Math.hypot(cx - d.x, cy - (d.y + DROP_SIZE / 2));
    if (dist <= bestDist) { bestDist = dist; best = d; }
  });
  return best;
}
function tryPickupDrop() {
  if (!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
  const best = nearestDrop();
  if (!best) return;
  // O servidor confirma (primeiro a pedir leva) via 'droppickup'
  socket.emit('droppickup', { dropId: best.id });
}

/* =========================================================
   PARTÍCULAS
========================================================= */
function spawnMuzzleFlash(x, y, angle, color) {
  for (let i = 0; i < 3; i++) particles.push({ x, y, vx: Math.cos(angle) * rand(1, 3), vy: Math.sin(angle) * rand(1, 3), life: 10, color, size: 1.6 });
}
function spawnHitSpark(x, y) {
  for (let i = 0; i < 6; i++) { const a = rand(0, Math.PI * 2); particles.push({ x, y, vx: Math.cos(a) * rand(0.5, 2), vy: Math.sin(a) * rand(0.5, 2), life: 16, color: '#ff3d6e', size: 1.4 }); }
}
function spawnDeathBurst(x, y, color) {
  for (let i = 0; i < 14; i++) { const a = rand(0, Math.PI * 2); particles.push({ x, y, vx: Math.cos(a) * rand(0.5, 3.2), vy: Math.sin(a) * rand(0.5, 3.2) - 1, life: 26, color, size: 2 }); }
}
function spawnSwordSwing(x, y, angle, color) {
  const w = WEAPONS.sword, steps = 6;
  for (let i = 0; i <= steps; i++) {
    const a = angle - w.arc / 2 + (w.arc * i / steps);
    particles.push({ x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6, vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 1.6, life: 9, color, size: 1.6 });
  }
}
function spawnStunSpark(x, y) {
  for (let i = 0; i < 7; i++) { const a = rand(0, Math.PI * 2); particles.push({ x, y, vx: Math.cos(a) * rand(0.3, 1.4), vy: Math.sin(a) * rand(0.3, 1.4) - 0.6, life: 20, color: '#ffd76b', size: 1.6 }); }
}
function spawnDust(x, y) {
  for (let i = 0; i < 4; i++) particles.push({ x, y, vx: rand(-1, 1), vy: rand(-0.6, -0.1), life: 10, color: '#4a5568', size: 1.2 });
}
function spawnAirJumpBurst(x, y, color) {
  for (let i = 0; i < 8; i++) {
    const a = Math.PI * (i / 7) + Math.PI; // leque para baixo, tipo "empurrão" do ar
    particles.push({ x, y, vx: Math.cos(a) * rand(0.8, 2.2), vy: Math.sin(a) * rand(0.4, 1.6) + 0.4, life: 14, color: color || '#3ee6d6', size: 1.6 });
  }
}

/* =========================================================
   KILL FEED / PLACAR
========================================================= */
function pushKillFeed(killer, victim, mine) {
  const el = document.createElement('div');
  el.textContent = killer + ' ELIMINOU ' + victim;
  if (mine) el.className = 'me';
  const feed = $('#killfeed');
  feed.appendChild(el);
  while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => el.remove(), 4000);
}
function renderScoreboard() {
  const sb = $('#scoreboard');
  const rows = [...players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  sb.innerHTML = rows.map(p =>
    '<div class="srow' + (p.id === myId ? ' me' : '') + '"><div class="swatch" style="background:' + p.color + '"></div>' +
    '<span>' + escapeHtml(p.name.slice(0, 10)) + '</span><span class="d">' + p.deaths + '</span><span class="k">' + p.kills + '</span></div>'
  ).join('');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let scoreboardTimer = 0;

/* =========================================================
   FÍSICA
========================================================= */
function updatePhysics(p, dt) {
  if (!p.alive) return;
  const step = dt / REF_FRAME_MS;
  const now = performance.now();
  const stunned = isStunned(p);

  if (!stunned) {
    if (input.left)  p.vx -= (p.onGround ? GROUND_ACCEL : AIR_ACCEL) * step;
    if (input.right) p.vx += (p.onGround ? GROUND_ACCEL : AIR_ACCEL) * step;
  }
  const cap = p.onGround ? GROUND_MOVE_SPEED : Math.max(MOVE_SPEED, Math.abs(p.vx));
  p.vx = clamp(p.vx, -cap, cap);

  // Pulo com coyote time + jump buffer
  if (p.onGround) input.lastGroundAt = now;
  const canJump = (p.onGround || now - input.lastGroundAt < COYOTE_MS) && p.vy >= 0;
  const wantsJump = input.up && now - input.jumpPressedAt < JUMP_BUFFER_MS;
  if (!stunned && wantsJump && canJump) {
    p.vy = JUMP_VEL; p.onGround = false;
    input.jumpPressedAt = -1e9; input.lastGroundAt = -1e9;
    sfxJump();
  } else if (!stunned && wantsJump && !canJump && p.airJumpsUsed < MAX_AIR_JUMPS) {
    // Pulo duplo: já está no ar, coyote/chão não valem, mas ainda tem pulo extra
    p.vy = AIR_JUMP_VEL;
    p.airJumpsUsed++;
    input.jumpPressedAt = -1e9;
    spawnAirJumpBurst(p.x + p.w / 2, p.y + p.h, p.color);
    sfxJump2();
  }

  p.vy += GRAVITY * step;
  p.vy = clamp(p.vy, -20, 12);

  p.x += p.vx * step;
  p.vx *= Math.pow(p.onGround ? FRICTION : AIR_FRICTION, step);
  p.x = clamp(p.x, 0, WORLD_W - p.w);

  const wasAirborne = !p.onGround;
  const fallSpeed = p.vy;
  let onGround = false;
  p.y += p.vy * step;
  for (const plat of PLATFORMS) {
    // Plataformas são "atravessáveis": só param o jogador quando ele está
    // caindo e pousa em cima. Pulando por baixo ou vindo pelo lado, atravessa
    // direto — sem trava, sem "bonk" na cabeça.
    if (p.vy >= 0 && rectsOverlap(p, plat)) {
      const prevBottom = p.y + p.h - p.vy * step;
      if (prevBottom <= plat.y + 2) {
        p.y = plat.y - p.h; p.vy = 0; onGround = true;
      }
    }
  }
  if (p.y + p.h > WORLD_H) { p.y = WORLD_H - p.h; p.vy = 0; onGround = true; }
  if (onGround && wasAirborne && fallSpeed > 3) spawnDust(p.x + p.w / 2, p.y + p.h);
  if (onGround) p.airJumpsUsed = 0;
  p.onGround = onGround;

  const cx = p.x + p.w / 2, cy = p.y + p.h / 2 - 2;
  p.angle = Math.atan2(input.mouseY - cy, input.mouseX - cx);
  p.facing = (input.mouseX < cx) ? -1 : 1;
}

/* Liang-Barsky: segmento vs retângulo (evita tunneling de balas rápidas) */
function segmentIntersectsRect(x0, y0, x1, y1, rx, ry, rw, rh) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - rx, (rx + rw) - x0, y0 - ry, (ry + rh) - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}
function hitsWorldSegment(px, py, x, y) {
  for (const plat of PLATFORMS) if (segmentIntersectsRect(px, py, x, y, plat.x, plat.y, plat.w, plat.h)) return true;
  return x < 0 || x > WORLD_W || y < 0 || y > WORLD_H || px < 0 || px > WORLD_W || py < 0 || py > WORLD_H;
}

function updateProjectiles(list, dt, onHitSelf) {
  const step = dt / REF_FRAME_MS;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    const px = b.x, py = b.y;
    b.x += b.vx * step; b.y += b.vy * step; b.life -= step;
    let dead = b.life <= 0 || hitsWorldSegment(px, py, b.x, b.y);
    if (!dead && onHitSelf && selfPlayer.alive) {
      if (segmentIntersectsRect(px, py, b.x, b.y, selfPlayer.x, selfPlayer.y, selfPlayer.w, selfPlayer.h)) {
        dead = true;
        onHitSelf(b);
      }
    }
    if (dead) list.splice(i, 1);
  }
}
function updateBullets(dt) {
  updateProjectiles(bulletsSelf, dt, null);
  updateProjectiles(bulletsIncoming, dt, b => applyDamageToSelf(WEAPONS[b.weapon].damage, b.ownerId, b.x, b.y));
}
function updateThrows(dt) {
  updateProjectiles(throwsSelf, dt, null);
  updateProjectiles(throwsIncoming, dt, t => applyStunToSelf(t.ownerId, t.x, t.y));
}

function applyDamageToSelf(dmg, byId, hx, hy) {
  if (!selfPlayer.alive) return;
  selfPlayer.hp -= dmg;
  spawnHitSpark(hx, hy);
  sfxHit();
  flashDamage();
  socket.emit('hitconfirm', { byId, x: hx, y: hy });
  if (selfPlayer.hp <= 0) {
    selfPlayer.hp = 0;
    selfPlayer.alive = false;
    spawnDeathBurst(selfPlayer.x + selfPlayer.w / 2, selfPlayer.y + selfPlayer.h / 2, selfPlayer.color);
    sfxDeath();
    lastKillerName = players.get(byId)?.name || null;
    socket.emit('death', { byId });
    selfPlayer.respawnAt = performance.now() + RESPAWN_MS;
    $('#respawnBy').textContent = lastKillerName ? 'POR ' + lastKillerName : '';
    $('#respawnOverlay').classList.add('active');
  }
}
let damageFlash = 0;
function flashDamage() { damageFlash = 1; }

function updateRespawn() {
  if (selfPlayer.alive) return;
  const remain = Math.max(0, selfPlayer.respawnAt - performance.now());
  $('#respawnNum').textContent = Math.ceil(remain / 1000);
  if (remain <= 0) {
    const sp = makeSpawn();
    selfPlayer.x = sp.x; selfPlayer.y = sp.y;
    selfPlayer.vx = 0; selfPlayer.vy = 0;
    selfPlayer.hp = 100; selfPlayer.alive = true;
    selfPlayer.weapon = 'sword'; selfPlayer.gunType = null; selfPlayer.ammo = 0;
    selfPlayer.stunUntil = 0;
    selfPlayer.airJumpsUsed = 0;
    updateWeaponHud();
    $('#respawnOverlay').classList.remove('active');
  }
}

function updateRemoteInterp() {
  players.forEach(p => {
    if (p.id === myId) return;
    if (p.hasRemote) {
      p.x += (p.rx - p.x) * 0.35;
      p.y += (p.ry - p.y) * 0.35;
    }
    if (currentState === 'playing' && p.hasRemote && performance.now() - p.lastSeen > REMOTE_TIMEOUT) {
      p.alive = false; // sem estado há muito tempo — não desenha até voltar
    }
  });
}

/* =========================================================
   RENDER
========================================================= */
function drawBackground() {
  ctx.fillStyle = '#0d1420';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 40; i++) ctx.fillRect((i * 53) % WORLD_W, (i * 97) % WORLD_H, 1, 1);
  ctx.strokeStyle = 'rgba(62,230,214,0.05)';
  for (let x = 0; x < WORLD_W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke(); }
}
function drawPlatforms() {
  PLATFORMS.forEach(p => {
    ctx.fillStyle = '#1c2433'; ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#2f3b52'; ctx.fillRect(p.x, p.y, p.w, 2);
    ctx.strokeStyle = '#0a0d14'; ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
  });
}
function drawPlayer(p) {
  if (!p.alive) return;
  const x = Math.round(p.x), y = Math.round(p.y);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x - 1, y + p.h - 1, p.w + 2, 2);
  ctx.fillStyle = '#12161f'; ctx.fillRect(x + 2, y + 11, 2, 5); ctx.fillRect(x + 6, y + 11, 2, 5);
  ctx.fillStyle = p.color; ctx.fillRect(x + 1, y + 4, p.w - 2, 8);
  ctx.fillStyle = '#f2c9a0'; ctx.fillRect(x + 2, y, p.w - 4, 5);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + 2, y, p.w - 4, 2);
  const cx = x + p.w / 2, cy = y + p.h / 2 - 2;
  const w = WEAPONS[p.weapon] || WEAPONS.sword;
  ctx.translate(cx, cy);
  ctx.rotate(p.angle);
  ctx.fillStyle = w.color;
  ctx.fillRect(2, -1, w.length || 9, 2);
  ctx.restore();
}
function drawNameplates() {
  uiCtx.setTransform(uiDpr, 0, 0, uiDpr, 0, 0);
  uiCtx.clearRect(0, 0, uiCanvas.width / uiDpr, uiCanvas.height / uiDpr);
  players.forEach(p => {
    if (!p.alive) return;
    const x = Math.round(p.x), y = Math.round(p.y);
    const barW = (p.w + 16) * uiScale, barH = Math.max(2, 3 * uiScale);
    const barX = (x - 8) * uiScale, barY = (y - 9) * uiScale;
    const cx = (x + p.w / 2) * uiScale;
    uiCtx.fillStyle = 'rgba(0,0,0,.5)'; uiCtx.fillRect(barX, barY, barW, barH);
    uiCtx.fillStyle = p.color; uiCtx.fillRect(barX, barY, barW * clamp(p.hp / 100, 0, 1), barH);
    const fontPx = Math.max(9, Math.round(6 * uiScale));
    uiCtx.font = fontPx + 'px "Courier New", monospace';
    uiCtx.textAlign = 'center'; uiCtx.textBaseline = 'alphabetic';
    const ny = (y - 11) * uiScale;
    uiCtx.lineWidth = Math.max(2, Math.round(fontPx * 0.28));
    uiCtx.strokeStyle = 'rgba(0,0,0,.65)';
    uiCtx.strokeText(p.name.slice(0, 10), cx, ny);
    uiCtx.fillStyle = p.id === myId ? '#3ee6d6' : '#eef2f8';
    uiCtx.fillText(p.name.slice(0, 10), cx, ny);
    if (isStunned(p)) {
      uiCtx.font = Math.max(10, Math.round(8 * uiScale)) + 'px "Courier New", monospace';
      const spin = performance.now() / 140;
      for (let i = 0; i < 3; i++) {
        const a = spin + i * (Math.PI * 2 / 3);
        uiCtx.fillStyle = '#ffd76b';
        uiCtx.fillText('★', cx + Math.cos(a) * 10 * uiScale, ny - 8 * uiScale + Math.sin(a) * 3 * uiScale);
      }
    }
  });
  drawInteractionPrompts();
}
function drawInteractionPrompts() {
  if (!selfPlayer || !selfPlayer.alive) return;
  const best = nearestDrop();
  if (!best) return;
  const px = best.x * uiScale, py = (best.y - 6) * uiScale;
  const fontPx = Math.max(10, Math.round(7 * uiScale));
  uiCtx.font = 'bold ' + fontPx + 'px "Courier New", monospace';
  uiCtx.textAlign = 'center';
  uiCtx.lineWidth = Math.max(2, Math.round(fontPx * 0.28));
  uiCtx.strokeStyle = 'rgba(0,0,0,.7)';
  const label = '[E] ' + WEAPONS[best.weapon].name;
  uiCtx.strokeText(label, px, py);
  uiCtx.fillStyle = '#ffd76b';
  uiCtx.fillText(label, px, py);
}
function drawBullets() {
  for (const b of bulletsSelf.concat(bulletsIncoming)) {
    const w = WEAPONS[b.weapon];
    ctx.fillStyle = w.color;
    ctx.fillRect(b.x - w.size / 2, b.y - w.size / 2, w.size, w.size);
    // rastro
    ctx.globalAlpha = 0.35;
    ctx.fillRect(b.x - b.vx * 0.5 - w.size / 2, b.y - b.vy * 0.5 - w.size / 2, w.size, w.size);
    ctx.globalAlpha = 1;
  }
}
function drawDrops() {
  const t = performance.now();
  drops.forEach(d => {
    const w = WEAPONS[d.weapon];
    const bob = d.landed ? Math.sin(t / 220 + d.x) * 1.2 : 0;
    const dx = Math.round(d.x - DROP_SIZE / 2), dy = Math.round(d.y + bob);
    if (!d.landed) { // paraquedas
      ctx.fillStyle = 'rgba(231,236,243,.75)';
      ctx.fillRect(dx - 3, dy - 8, DROP_SIZE + 6, 3);
      ctx.fillRect(dx - 1, dy - 5, DROP_SIZE + 2, 2);
      ctx.fillStyle = 'rgba(231,236,243,.4)';
      ctx.fillRect(dx, dy - 3, 1, 3); ctx.fillRect(dx + DROP_SIZE - 1, dy - 3, 1, 3);
    } else {
      ctx.fillStyle = 'rgba(255,215,107,' + (0.08 + 0.06 * Math.sin(t / 300 + d.x)) + ')';
      ctx.fillRect(dx - 4, dy - 4, DROP_SIZE + 8, DROP_SIZE + 8);
    }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(dx - 1, dy - 1, DROP_SIZE + 2, DROP_SIZE + 2);
    ctx.fillStyle = w.color; ctx.fillRect(dx, dy, DROP_SIZE, DROP_SIZE);
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(dx + 1, dy + 1, DROP_SIZE - 2, 1);
  });
}
function drawThrows() {
  for (const t of throwsSelf.concat(throwsIncoming)) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(Math.atan2(t.vy, t.vx) + performance.now() / 60);
    ctx.fillStyle = WEAPONS[t.weapon].color;
    ctx.fillRect(-THROW_SIZE, -1, THROW_SIZE * 2, 2);
    ctx.restore();
  }
}
function drawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx; pt.y += pt.vy; pt.life--;
    if (pt.life <= 0) { particles.splice(i, 1); continue; }
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = clamp(pt.life / 16, 0, 1);
    ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
    ctx.globalAlpha = 1;
  }
}
function drawCrosshair() {
  const x = input.mouseX, y = input.mouseY;
  ctx.strokeStyle = '#ff3d6e'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 5, y); ctx.lineTo(x - 2, y); ctx.moveTo(x + 2, y); ctx.lineTo(x + 5, y);
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y - 2); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 5);
  ctx.stroke();
}
function drawDamageFlash() {
  if (damageFlash <= 0) return;
  ctx.fillStyle = 'rgba(255,61,110,' + (0.25 * damageFlash) + ')';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  damageFlash = Math.max(0, damageFlash - 0.08);
}

/* =========================================================
   LOOP PRINCIPAL
========================================================= */
function loop(now) {
  if (currentState !== 'playing') return;
  const dt = Math.min(33, now - lastTime); lastTime = now;

  updatePhysics(selfPlayer, dt);
  updateRespawn();
  if (input.firing && selfPlayer.alive && !isStunned(selfPlayer) && selfPlayer.weapon !== 'sword' && selfPlayer.ammo > 0) {
    if (WEAPONS[selfPlayer.weapon].auto) tryShoot();
  }
  updateBullets(dt);
  updateThrows(dt);
  updateRemoteInterp();
  updateDrops();

  if (now - lastStateSent > STATE_RATE) {
    lastStateSent = now;
    socket.emit('state', {
      x: selfPlayer.x, y: selfPlayer.y, angle: selfPlayer.angle, facing: selfPlayer.facing,
      weapon: selfPlayer.weapon, hp: selfPlayer.hp, alive: selfPlayer.alive,
      onGround: selfPlayer.onGround, stunned: isStunned(selfPlayer),
    });
  }

  drawBackground();
  drawPlatforms();
  drawDrops();
  players.forEach(drawPlayer);
  drawBullets();
  drawThrows();
  drawParticles();
  drawDamageFlash();
  drawNameplates();
  drawCrosshair();

  $('#hpFill').style.width = clamp(selfPlayer.hp, 0, 100) + '%';
  $('#hpNum').textContent = Math.max(0, Math.round(selfPlayer.hp));

  scoreboardTimer += dt;
  if (scoreboardTimer > 500) { scoreboardTimer = 0; renderScoreboard(); }

  requestAnimationFrame(loop);
}

/* Hook de depuração (console do navegador): window.__ps */
window.__ps = {
  socket,
  get players() { return players; },
  get self() { return selfPlayer; },
  get drops() { return drops; },
  get state() { return currentState; },
};

})();
