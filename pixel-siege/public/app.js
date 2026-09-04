(function(){
"use strict";

/* =========================================================
   CONFIG / ESTADO GLOBAL
========================================================= */
const WORLD_W = 720, WORLD_H = 405;
const GRAVITY = 0.42;
const MOVE_SPEED = 1.7;
const GROUND_MOVE_SPEED = 2.55;
const GROUND_ACCEL = GROUND_MOVE_SPEED * 0.4;
const AIR_ACCEL = MOVE_SPEED * 0.35;
const JUMP_VEL = -6.6;
const JUMP_CUT_MULTIPLIER = 0.45;
const FRICTION = 0.78;
const AIR_FRICTION = 0.9;
const REF_FRAME_MS = 1000/60;

const PALETTE = ['#ff3d6e','#3ee6d6','#ffb02e','#8dff6b','#c77dff','#ff8c42','#5ac8ff','#ff5ac0'];

const PLATFORMS = [
  {x:0,   y:375, w:720, h:30},
  {x:0,   y:0,   w:12,  h:405},
  {x:708, y:0,   w:12,  h:405},
  {x:60,  y:300, w:120, h:15},
  {x:540, y:300, w:120, h:15},
  {x:300, y:240, w:120, h:15},
  {x:113, y:173, w:105, h:15},
  {x:503, y:173, w:105, h:15},
  {x:315, y:113, w:90,  h:15},
];

const SPAWNS = [
  {x:30, y:345},{x:660,y:345},{x:90,y:270},{x:600,y:270},
  {x:330,y:210},{x:143,y:143},{x:533,y:143},{x:345,y:83},
];

const WEAPONS = {
  pistol:{ key:'1', name:'PISTOLA', damage:14, fireRate:340, bulletSpeed:9,  spread:0.03, auto:false, color:'#ffb02e', size:1.6, mag:15, life:150 },
  rifle: { key:'2', name:'FUZIL DE ASSALTO', damage:9,  fireRate:105, bulletSpeed:10, spread:0.075,auto:true,  color:'#3ee6d6', size:1.5, mag:30, life:140 },
  sniper:{ key:'3', name:'SNIPER', damage:48, fireRate:900, bulletSpeed:15, spread:0.0, auto:false, color:'#ff3d6e', size:1.9, mag:8, life:120  },
  sword: { key:'1', name:'ESPADA', damage:26, cooldown:420, range:20, arc:Math.PI/2.1, color:'#d7deea', length:14, melee:true },
};

const GUN_TYPES = ['pistol','rifle','sniper'];

const DROP_BASE_INTERVAL = 14000;
const DROP_MIN_INTERVAL  = 3200;
const DROP_FALL_SPEED    = 150;
const DROP_SIZE          = 9;
const PICKUP_RADIUS      = 20;

const THROW_SPEED  = 7.2;
const THROW_LIFE   = 90;
const THROW_SIZE   = 4;
const STUN_MS       = 500;

let socket = io();
let myId = null;
let myName = 'JOGADOR';
let myColor = '#3ee6d6';
let isHost = false;
let roomCode = null;

let players = new Map();
let bulletsSelf = [];
let bulletsIncoming = [];
let particles = [];

let drops = [];
let dropSpawnTimer = 6000;
let throwsSelf = [];
let throwsIncoming = [];

let lastStateSent = 0;
const STATE_RATE = 45;

const input = { left:false, right:false, up:false, mouseX:360, mouseY:203, firing:false };

/* =========================================================
   HELPERS
========================================================= */
function $(sel){ return document.querySelector(sel); }
function rand(a,b){ return a + Math.random()*(b-a); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function uid(){ return Math.random().toString(36).slice(2,9); }
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $('#'+id).classList.add('active');
}
function toast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove('show'), 2200);
}
function colorForId(id){
  let h=0; for(let i=0;i<id.length;i++) h = (h*31 + id.charCodeAt(i))>>>0;
  return PALETTE[h % PALETTE.length];
}

const canvas = $('#game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const uiCanvas = $('#uiLayer');
const uiCtx = uiCanvas.getContext('2d');
let uiScale = 1;
let uiDpr = 1;

function rectsOverlap(a,b){
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}

/* =========================================================
   ESCALONAMENTO FULLSCREEN DO STAGE
========================================================= */
function resizeStage(){
  const stage = $('#stage');
  if(!stage) return;
  const targetRatio = WORLD_W / WORLD_H;
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  let w = availW, h = w / targetRatio;
  if(h > availH){
    h = availH;
    w = h * targetRatio;
  }
  w = Math.round(w); h = Math.round(h);
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';

  uiDpr = window.devicePixelRatio || 1;
  uiScale = w / WORLD_W;
  if(uiCanvas){
    uiCanvas.width = Math.round(w * uiDpr);
    uiCanvas.height = Math.round(h * uiDpr);
  }
}
window.addEventListener('resize', resizeStage);
window.addEventListener('orientationchange', resizeStage);
resizeStage();

/* =========================================================
   AUDIO
========================================================= */
let actx = null;
function audioCtx(){
  if(!actx) actx = new (window.AudioContext||window.webkitAudioContext)();
  return actx;
}
function beep(freq, dur, type, vol, slideTo){
  try{
    const ctx = audioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type||'square';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if(slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime+dur);
    gain.gain.setValueAtTime(vol||0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime+dur);
  }catch(e){}
}
function sfxShoot(weapon){
  if(weapon==='pistol') beep(520,0.08,'square',0.05,300);
  else if(weapon==='rifle') beep(340,0.05,'square',0.04,220);
  else beep(140,0.25,'sawtooth',0.07,60);
}
function sfxHit(){ beep(180,0.12,'square',0.06,60); }
function sfxJump(){ beep(400,0.09,'triangle',0.04,650); }
function sfxDeath(){ beep(220,0.4,'sawtooth',0.08,40); }
function sfxSwing(){ beep(260,0.09,'triangle',0.05,120); }
function sfxThrow(){ beep(200,0.1,'square',0.04,90); }

/* =========================================================
   PLAYER FACTORY
========================================================= */
function makeSpawn(){
  return SPAWNS[Math.floor(Math.random()*SPAWNS.length)];
}
function newPlayerState(id,name,color,host){
  const sp = makeSpawn();
  return {
    id, name, color, host:!!host,
    x:sp.x, y:sp.y, w:10, h:16,
    vx:0, vy:0, onGround:false,
    angle:0, facing:1,
    weapon:'sword', gunType:null, ammo:0,
    lastShot:0, lastMelee:0,
    hp:100, alive:true, kills:0, deaths:0,
    stunUntil:0, stunned:false,
    rx:sp.x, ry:sp.y,
    lastSeen:performance.now(),
    respawnAt:0,
  };
}

/* =========================================================
   SOCKETS NETWORKING
========================================================= */
socket.on('roomCreated', (data) => {
  myId = socket.id;
  roomCode = data.code;
  isHost = true;
  players.clear();
  data.players.forEach(p => players.set(p.id, newPlayerState(p.id, p.name, p.color, p.host)));
  enterLobby(roomCode);
});

socket.on('roomJoined', (data) => {
  myId = socket.id;
  roomCode = data.code;
  isHost = false;
  players.clear();
  data.players.forEach(p => players.set(p.id, newPlayerState(p.id, p.name, p.color, p.host)));
  enterLobby(roomCode);
});

socket.on('playerJoined', (p) => {
  players.set(p.id, newPlayerState(p.id, p.name, p.color, p.host));
  renderLobbyList();
});

socket.on('playerLeft', (id) => {
  players.delete(id);
  renderLobbyList();
});

socket.on('hostChanged', (hostId) => {
  if (myId === hostId) isHost = true;
  const p = players.get(hostId);
  if (p) p.host = true;
  renderLobbyList();
});

socket.on('errorMsg', (msg) => toast(msg));

socket.on('gameStarted', () => {
  if (currentState !== 'playing') startMatch();
});

socket.on('state', (msg) => {
  let p = players.get(msg.id);
  if(!p) return;
  p.rx = msg.x; p.ry = msg.y;
  p.angle = msg.angle; p.facing = msg.facing;
  p.weapon = msg.weapon; p.hp = msg.hp;
  p.alive = msg.alive; p.kills = msg.kills;
  p.onGround = msg.onGround;
  p.stunned = !!msg.stunned;
});

socket.on('shoot', (msg) => {
  const w = WEAPONS[msg.weapon];
  bulletsIncoming.push({
    id: msg.bid, ownerId: msg.id, ownerColor: msg.color,
    x: msg.x, y: msg.y, angle: msg.angle,
    vx: Math.cos(msg.angle)*w.bulletSpeed, vy: Math.sin(msg.angle)*w.bulletSpeed,
    weapon: msg.weapon, life: w.life,
  });
});

socket.on('hitconfirm', (msg) => spawnHitSpark(msg.x, msg.y));

socket.on('death', (msg) => {
  const victim = players.get(msg.id);
  const killerName = (msg.byId===myId) ? myName : (players.get(msg.byId)?.name || '???');
  const victimName = msg.name || (victim?victim.name:'???');
  pushKillFeed(killerName, victimName);
  if(victim){ victim.alive=false; victim.deaths++; }
  const killer = players.get(msg.byId);
  if(killer) killer.kills++;
});

socket.on('dropspawn', (msg) => {
  if(!drops.some(d=>d.id===msg.dropId)){
    drops.push({
      id: msg.dropId, weapon: msg.weapon, x: msg.x,
      y: 0, landY: msg.landY, startTime: msg.startTime, landed:false,
    });
  }
});

socket.on('droppickup', (msg) => {
  drops = drops.filter(d=>d.id!==msg.dropId);
});

socket.on('melee', (msg) => {
  spawnSwordSwing(msg.x, msg.y, msg.angle, WEAPONS.sword.color);
  if(selfPlayer && selfPlayer.alive && !isStunned(selfPlayer)){
    const cx = selfPlayer.x + selfPlayer.w/2, cy = selfPlayer.y + selfPlayer.h/2 - 2;
    if(pointInMeleeArc(cx,cy, msg.x,msg.y, msg.angle, msg.range, msg.arc)){
      applyDamageToSelf(msg.damage, msg.id, cx, cy);
    }
  }
});

socket.on('throw', (msg) => {
  throwsIncoming.push({
    id: msg.tid, ownerId: msg.id,
    x: msg.x, y: msg.y,
    vx: Math.cos(msg.angle)*THROW_SPEED, vy: Math.sin(msg.angle)*THROW_SPEED,
    weapon: msg.weapon, life: THROW_LIFE,
  });
});

socket.on('stunconfirm', (msg) => spawnStunSpark(msg.x, msg.y));

/* =========================================================
   MENU / LOBBY LOGIC
========================================================= */
let currentState = 'menu';

$('#btnShowJoin').addEventListener('click', ()=>{
  $('#joinBox').style.display = $('#joinBox').style.display==='none' ? 'block':'none';
});

$('#btnCreate').addEventListener('click', ()=>{
  setupIdentity();
  socket.emit('createRoom', { name: myName, color: myColor });
});

$('#btnJoin').addEventListener('click', ()=>{
  const code = $('#codeInput').value.trim().toUpperCase();
  if(code.length !== 4){ toast('DIGITE UM CÓDIGO DE 4 LETRAS'); return; }
  setupIdentity();
  socket.emit('joinRoom', { code, name: myName, color: myColor });
});

function setupIdentity(){
  myName = ($('#nameInput').value.trim() || 'JOGADOR').toUpperCase().slice(0,12);
  myColor = colorForId(socket.id || uid());
}

function enterLobby(code){
  currentState = 'lobby';
  showScreen('lobbyScreen');
  const box = $('#codeBox'); box.innerHTML = '';
  code.split('').forEach(ch=>{
    const d = document.createElement('div');
    d.className='code-letter'; d.textContent = ch;
    box.appendChild(d);
  });
  $('#btnStart').style.display = isHost ? 'block' : 'none';
  renderLobbyList();
}

function renderLobbyList(){
  const ul = $('#playerList'); ul.innerHTML='';
  players.forEach(p=>{
    const li = document.createElement('li');
    const sw = document.createElement('div');
    sw.className='swatch'; sw.style.background = p.color;
    li.appendChild(sw);
    const span = document.createElement('span');
    span.textContent = p.name;
    li.appendChild(span);
    if(p.host){ const t=document.createElement('span'); t.className='tag-host'; t.textContent='HOST'; li.appendChild(t); }
    else if(p.id===myId){ const t=document.createElement('span'); t.className='tag-you'; t.textContent='VOCÊ'; li.appendChild(t); }
    ul.appendChild(li);
  });
  if($('#btnStart')) $('#btnStart').style.display = isHost ? 'block' : 'none';
}

$('#btnStart').addEventListener('click', ()=>{
  socket.emit('startGame');
});

$('#btnLeaveLobby').addEventListener('click', ()=>{
  window.location.reload();
});

$('#exitBtn').addEventListener('click', ()=>{
  window.location.reload();
});

/* =========================================================
   INICIAR PARTIDA
========================================================= */
let selfPlayer = null;
function startMatch(){
  currentState = 'playing';
  showScreen('gameScreen');
  $('#roomTag').textContent = 'SALA ' + roomCode;

  const sp = makeSpawn();
  selfPlayer = newPlayerState(myId, myName, myColor, isHost);
  selfPlayer.x = sp.x; selfPlayer.y = sp.y;
  players.set(myId, selfPlayer);

  bulletsSelf = []; bulletsIncoming = []; particles = [];
  drops = []; throwsSelf = []; throwsIncoming = [];
  dropSpawnTimer = 4000;
  updateWeaponHud();
  bindGameInput();
  resizeStage();
  requestAnimationFrame(loop);
}

/* =========================================================
   INPUT
========================================================= */
let inputBound = false;
function bindGameInput(){
  if(inputBound) return;
  inputBound = true;
  const canvas = $('#game');

  window.addEventListener('keydown', e=>{
    if(currentState!=='playing') return;
    if(['a','A','ArrowLeft'].includes(e.key)) input.left = true;
    if(['d','D','ArrowRight'].includes(e.key)) input.right = true;
    if(['w','W','ArrowUp',' '].includes(e.key)){ input.up = true; }
    if(e.key==='1') switchWeapon('sword');
    if(e.key==='2'){ if(selfPlayer && selfPlayer.gunType) switchWeapon(selfPlayer.gunType); else toast('SEM ARMA DE FOGO — PRESSIONE E PERTO DE UM DROP'); }
    if(e.key==='e' || e.key==='E') tryPickupDrop();
  });
  window.addEventListener('keyup', e=>{
    if(['a','A','ArrowLeft'].includes(e.key)) input.left = false;
    if(['d','D','ArrowRight'].includes(e.key)) input.right = false;
    if(['w','W','ArrowUp',' '].includes(e.key)){
      input.up = false;
      if(selfPlayer && selfPlayer.alive && selfPlayer.vy < 0){
        selfPlayer.vy *= JUMP_CUT_MULTIPLIER;
      }
    }
  });
  canvas.addEventListener('mousemove', e=>{
    const r = canvas.getBoundingClientRect();
    input.mouseX = (e.clientX - r.left) / r.width * WORLD_W;
    input.mouseY = (e.clientY - r.top) / r.height * WORLD_H;
  });
  canvas.addEventListener('mousedown', e=>{
    if(e.button===0){
      input.firing = true;
      if(!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
      if(selfPlayer.weapon==='sword'){
        performSwordAttack();
      } else if(selfPlayer.ammo > 0){
        tryShoot();
      } else {
        throwWeapon();
      }
    } else if(e.button===2){
      performSwordAttack();
    }
  });
  window.addEventListener('mouseup', e=>{ if(e.button===0) input.firing = false; });
  canvas.addEventListener('wheel', e=>{
    if(!selfPlayer) return;
    if(selfPlayer.weapon==='sword'){
      if(selfPlayer.gunType) switchWeapon(selfPlayer.gunType);
    } else {
      switchWeapon('sword');
    }
  });
  canvas.addEventListener('contextmenu', e=>e.preventDefault());
}

function switchWeapon(w){
  if(!selfPlayer || !selfPlayer.alive) return;
  if(w!=='sword' && selfPlayer.gunType!==w) return;
  selfPlayer.weapon = w;
  updateWeaponHud();
}

function updateWeaponHud(){
  if(!selfPlayer) return;
  const active = selfPlayer.weapon;
  $('#wname').textContent = WEAPONS[active].name;
  const wammo = $('#wammo');
  if(active==='sword'){
    wammo.textContent = selfPlayer.gunType ? '' : 'SEM ARMA DE FOGO';
  } else {
    wammo.textContent = 'MUNIÇÃO: ' + selfPlayer.ammo + ' / ' + WEAPONS[selfPlayer.gunType].mag;
  }
  document.querySelectorAll('.wkey').forEach(el=>{
    const isGunSlot = el.dataset.w==='gun';
    el.classList.toggle('active', isGunSlot ? active!=='sword' : active==='sword');
    el.classList.toggle('empty', isGunSlot && !selfPlayer.gunType);
  });
}

/* =========================================================
   TIRO E ATAQUES
========================================================= */
function tryShoot(){
  if(!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
  if(selfPlayer.weapon==='sword') return;
  if(selfPlayer.ammo <= 0) return;
  const w = WEAPONS[selfPlayer.weapon];
  const now = performance.now();
  if(now - selfPlayer.lastShot < w.fireRate) return;
  selfPlayer.lastShot = now;
  selfPlayer.ammo--;
  updateWeaponHud();

  const cx = selfPlayer.x + selfPlayer.w/2;
  const cy = selfPlayer.y + selfPlayer.h/2 - 2;
  let angle = Math.atan2(input.mouseY - cy, input.mouseX - cx);
  angle += rand(-w.spread, w.spread);

  const bid = uid();
  bulletsSelf.push({
    id:bid, x:cx + Math.cos(angle)*8, y:cy + Math.sin(angle)*8,
    vx:Math.cos(angle)*w.bulletSpeed, vy:Math.sin(angle)*w.bulletSpeed,
    weapon:selfPlayer.weapon, life:w.life,
  });
  spawnMuzzleFlash(cx + Math.cos(angle)*8, cy + Math.sin(angle)*8, angle, w.color);
  sfxShoot(selfPlayer.weapon);

  socket.emit('shoot', {
    bid, color:myColor, x: cx + Math.cos(angle)*8, y: cy + Math.sin(angle)*8,
    angle, weapon:selfPlayer.weapon,
  });
}

function pointInMeleeArc(px,py, ox,oy, angle, range, arc){
  const dx = px-ox, dy = py-oy;
  const dist = Math.hypot(dx,dy);
  if(dist > range) return false;
  let diff = Math.atan2(dy,dx) - angle;
  while(diff > Math.PI) diff -= Math.PI*2;
  while(diff < -Math.PI) diff += Math.PI*2;
  return Math.abs(diff) <= arc/2;
}

function performSwordAttack(){
  if(!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
  const w = WEAPONS.sword;
  const now = performance.now();
  if(now - selfPlayer.lastMelee < w.cooldown) return;
  selfPlayer.lastMelee = now;

  const cx = selfPlayer.x + selfPlayer.w/2;
  const cy = selfPlayer.y + selfPlayer.h/2 - 2;
  const angle = Math.atan2(input.mouseY - cy, input.mouseX - cx);

  spawnSwordSwing(cx, cy, angle, w.color);
  sfxSwing();

  socket.emit('melee', {
    x:cx, y:cy, angle, range:w.range, arc:w.arc, damage:w.damage,
  });
}

function isStunned(p){
  if(!p) return false;
  return p.id===myId ? (performance.now() < p.stunUntil) : !!p.stunned;
}

function throwWeapon(){
  if(!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
  if(!selfPlayer.gunType || selfPlayer.ammo > 0) return;
  const weapon = selfPlayer.gunType;

  const cx = selfPlayer.x + selfPlayer.w/2;
  const cy = selfPlayer.y + selfPlayer.h/2 - 2;
  const angle = Math.atan2(input.mouseY - cy, input.mouseX - cx);

  const tid = uid();
  throwsSelf.push({
    id:tid, x:cx + Math.cos(angle)*8, y:cy + Math.sin(angle)*8,
    vx:Math.cos(angle)*THROW_SPEED, vy:Math.sin(angle)*THROW_SPEED,
    weapon, life:THROW_LIFE,
  });
  sfxThrow();

  socket.emit('throw', {
    tid, weapon, x: cx + Math.cos(angle)*8, y: cy + Math.sin(angle)*8, angle,
  });

  selfPlayer.gunType = null;
  selfPlayer.ammo = 0;
  selfPlayer.weapon = 'sword';
  updateWeaponHud();
}

function applyStunToSelf(byId, hx, hy){
  if(!selfPlayer.alive) return;
  selfPlayer.stunUntil = performance.now() + STUN_MS;
  spawnStunSpark(hx,hy);
  sfxHit();
  socket.emit('stunconfirm', { id:byId, x:hx, y:hy });
}

/* =========================================================
   DROPS DE ARMAS
========================================================= */
function findLandingY(x){
  let bestY = WORLD_H;
  for(const plat of PLATFORMS){
    if(plat.h >= WORLD_H) continue;
    if(x >= plat.x && x <= plat.x + plat.w){
      if(plat.y < bestY) bestY = plat.y;
    }
  }
  return bestY - DROP_SIZE;
}

function hostMaybeSpawnDrop(dt){
  if(!isHost || currentState!=='playing') return;
  dropSpawnTimer -= dt;
  if(dropSpawnTimer > 0) return;

  const n = Math.max(1, players.size);
  dropSpawnTimer = clamp(DROP_BASE_INTERVAL / n, DROP_MIN_INTERVAL, DROP_BASE_INTERVAL);

  const weapon = GUN_TYPES[Math.floor(Math.random()*GUN_TYPES.length)];
  const x = rand(24, WORLD_W-24);
  const landY = findLandingY(x);
  const dropId = uid();
  const startTime = Date.now();

  drops.push({ id:dropId, weapon, x, y:0, landY, startTime, landed:false });
  socket.emit('dropspawn', { dropId, weapon, x, landY, startTime });
}

function updateDrops(){
  const now = Date.now();
  drops.forEach(d=>{
    const elapsed = (now - d.startTime) / 1000;
    d.y = Math.min(d.landY, elapsed * DROP_FALL_SPEED);
    d.landed = d.y >= d.landY;
  });
}

function tryPickupDrop(){
  if(!selfPlayer || !selfPlayer.alive || isStunned(selfPlayer)) return;
  const cx = selfPlayer.x + selfPlayer.w/2, cy = selfPlayer.y + selfPlayer.h/2;
  let best = null, bestDist = PICKUP_RADIUS;
  drops.forEach(d=>{
    if(!d.landed) return;
    const dist = Math.hypot(cx-d.x, cy-(d.y+DROP_SIZE/2));
    if(dist <= bestDist){ bestDist = dist; best = d; }
  });
  if(!best) return;

  selfPlayer.gunType = best.weapon;
  selfPlayer.ammo = WEAPONS[best.weapon].mag;
  selfPlayer.weapon = best.weapon;
  drops = drops.filter(d=>d.id!==best.id);
  updateWeaponHud();
  toast(WEAPONS[best.weapon].name + ' COLETADA');
  socket.emit('droppickup', { dropId:best.id });
}

/* =========================================================
   EFETOS VISUAIS
========================================================= */
function spawnMuzzleFlash(x,y,angle,color){
  for(let i=0;i<3;i++){
    particles.push({x,y, vx:Math.cos(angle)*rand(1,3), vy:Math.sin(angle)*rand(1,3), life:10, color, size:1.6});
  }
}
function spawnHitSpark(x,y){
  for(let i=0;i<6;i++){
    const a = rand(0,Math.PI*2);
    particles.push({x,y, vx:Math.cos(a)*rand(0.5,2), vy:Math.sin(a)*rand(0.5,2), life:16, color:'#ff3d6e', size:1.4});
  }
}
function spawnDeathBurst(x,y,color){
  for(let i=0;i<14;i++){
    const a = rand(0,Math.PI*2);
    particles.push({x,y, vx:Math.cos(a)*rand(0.5,3.2), vy:Math.sin(a)*rand(0.5,3.2)-1, life:26, color, size:2});
  }
}
function spawnSwordSwing(x,y,angle,color){
  const w = WEAPONS.sword;
  const steps = 6;
  for(let i=0;i<=steps;i++){
    const a = angle - w.arc/2 + (w.arc*i/steps);
    particles.push({ x:x+Math.cos(a)*6, y:y+Math.sin(a)*6, vx:Math.cos(a)*1.6, vy:Math.sin(a)*1.6, life:9, color, size:1.6 });
  }
}
function spawnStunSpark(x,y){
  for(let i=0;i<7;i++){
    const a = rand(0,Math.PI*2);
    particles.push({x,y, vx:Math.cos(a)*rand(0.3,1.4), vy:Math.sin(a)*rand(0.3,1.4)-0.6, life:20, color:'#ffd76b', size:1.6});
  }
}

/* =========================================================
   SCOREBOARD & FEED
========================================================= */
function pushKillFeed(killer, victim){
  const el = document.createElement('div');
  el.textContent = killer + ' ELIMINOU ' + victim;
  $('#killfeed').appendChild(el);
  setTimeout(()=>el.remove(), 4000);
}
function renderScoreboard(){
  const sb = $('#scoreboard');
  let rows = [];
  players.forEach(p=>{
    rows.push('<div class="srow"><div class="swatch" style="background:'+p.color+'"></div>'+
      '<span>'+p.name.slice(0,10)+'</span><span class="k">'+p.kills+'</span></div>');
  });
  sb.innerHTML = rows.join('');
}
let scoreboardTimer = 0;

/* =========================================================
   FÍSICA
========================================================= */
function updatePhysics(p, dt){
  if(!p.alive) return;

  const step = dt / REF_FRAME_MS;
  const stunned = isStunned(p);

  if(!stunned){
    if(input.left)  p.vx -= (p.onGround ? GROUND_ACCEL : AIR_ACCEL)*step;
    if(input.right) p.vx += (p.onGround ? GROUND_ACCEL : AIR_ACCEL)*step;
  }
  const cap = p.onGround ? GROUND_MOVE_SPEED : Math.max(MOVE_SPEED, Math.abs(p.vx));
  p.vx = clamp(p.vx, -cap, cap);

  if(!stunned && input.up && p.onGround){ p.vy = JUMP_VEL; p.onGround=false; sfxJump(); }

  p.vy += GRAVITY*step;
  p.vy = clamp(p.vy, -20, 12);

  p.x += p.vx*step;
  p.vx *= p.onGround ? Math.pow(FRICTION, step) : Math.pow(AIR_FRICTION, step);
  p.x = clamp(p.x, 0, WORLD_W - p.w);

  let onGround = false;
  p.y += p.vy*step;
  for(const plat of PLATFORMS){
    if(rectsOverlap(p, plat)){
      const prevBottom = p.y + p.h - p.vy*step;
      if(p.vy >= 0 && prevBottom <= plat.y + 2){
        p.y = plat.y - p.h; p.vy = 0; onGround = true;
      } else if(p.vy < 0 && (p.y - p.vy*step) >= plat.y + plat.h - 2){
        p.y = plat.y + plat.h; p.vy = 0;
      } else {
        if(p.x + p.w/2 < plat.x + plat.w/2) p.x = plat.x - p.w;
        else p.x = plat.x + plat.w;
      }
    }
  }
  if(p.y + p.h > WORLD_H){ p.y = WORLD_H - p.h; p.vy = 0; onGround = true; }
  p.onGround = onGround;

  const cx = p.x + p.w/2, cy = p.y + p.h/2 - 2;
  p.angle = Math.atan2(input.mouseY - cy, input.mouseX - cx);
  p.facing = (input.mouseX < cx) ? -1 : 1;
}

function updateBullets(dt){
  const step = dt / REF_FRAME_MS;
  for(let i=bulletsSelf.length-1;i>=0;i--){
    const b = bulletsSelf[i];
    const px = b.x, py = b.y;
    b.x += b.vx*step; b.y += b.vy*step; b.life -= step;
    if(b.life<=0 || hitsWorldSegment(px,py,b.x,b.y)) bulletsSelf.splice(i,1);
  }
  for(let i=bulletsIncoming.length-1;i>=0;i--){
    const b = bulletsIncoming[i];
    const px = b.x, py = b.y;
    b.x += b.vx*step; b.y += b.vy*step; b.life -= step;
    let dead = false;
    if(b.life<=0 || hitsWorldSegment(px,py,b.x,b.y)) dead = true;

    if(!dead && selfPlayer.alive){
      const hb = {x:selfPlayer.x, y:selfPlayer.y, w:selfPlayer.w, h:selfPlayer.h};
      if(segmentIntersectsRect(px,py,b.x,b.y, hb.x,hb.y,hb.w,hb.h)){
        dead = true;
        applyDamageToSelf(WEAPONS[b.weapon].damage, b.ownerId, b.x, b.y);
      }
    }
    if(dead) bulletsIncoming.splice(i,1);
  }
}

function updateThrows(dt){
  const step = dt / REF_FRAME_MS;
  for(let i=throwsSelf.length-1;i>=0;i--){
    const t = throwsSelf[i];
    const px=t.x, py=t.y;
    t.x += t.vx*step; t.y += t.vy*step; t.life -= step;
    if(t.life<=0 || hitsWorldSegment(px,py,t.x,t.y)) throwsSelf.splice(i,1);
  }
  for(let i=throwsIncoming.length-1;i>=0;i--){
    const t = throwsIncoming[i];
    const px=t.x, py=t.y;
    t.x += t.vx*step; t.y += t.vy*step; t.life -= step;
    let dead = false;
    if(t.life<=0 || hitsWorldSegment(px,py,t.x,t.y)) dead = true;

    if(!dead && selfPlayer.alive){
      const hb = {x:selfPlayer.x, y:selfPlayer.y, w:selfPlayer.w, h:selfPlayer.h};
      if(segmentIntersectsRect(px,py,t.x,t.y, hb.x,hb.y,hb.w,hb.h)){
        dead = true;
        applyStunToSelf(t.ownerId, t.x, t.y);
      }
    }
    if(dead) throwsIncoming.splice(i,1);
  }
}

function segmentIntersectsRect(x0,y0,x1,y1, rx,ry,rw,rh){
  let t0 = 0, t1 = 1;
  const dx = x1-x0, dy = y1-y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0-rx, (rx+rw)-x0, y0-ry, (ry+rh)-y0];
  for(let i=0;i<4;i++){
    if(p[i] === 0){
      if(q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if(p[i] < 0){
        if(r > t1) return false;
        if(r > t0) t0 = r;
      } else {
        if(r < t0) return false;
        if(r < t1) t1 = r;
      }
    }
  }
  return true;
}

function hitsWorldSegment(px,py,x,y){
  for(const plat of PLATFORMS){
    if(segmentIntersectsRect(px,py,x,y, plat.x,plat.y,plat.w,plat.h)) return true;
  }
  return x<0||x>WORLD_W||y<0||y>WORLD_H||px<0||px>WORLD_W||py<0||py>WORLD_H;
}

function applyDamageToSelf(dmg, byId, hx, hy){
  if(!selfPlayer.alive) return;
  selfPlayer.hp -= dmg;
  spawnHitSpark(hx,hy);
  sfxHit();
  socket.emit('hitconfirm', { id:byId, x:hx, y:hy });
  if(selfPlayer.hp <= 0){
    selfPlayer.hp = 0;
    selfPlayer.alive = false;
    selfPlayer.deaths++;
    spawnDeathBurst(selfPlayer.x+selfPlayer.w/2, selfPlayer.y+selfPlayer.h/2, selfPlayer.color);
    sfxDeath();
    socket.emit('death', { name:myName, byId });
    selfPlayer.respawnAt = performance.now() + 3000;
    $('#respawnOverlay').classList.add('active');
  }
}

function updateRespawn(){
  if(selfPlayer.alive) return;
  const remain = Math.max(0, selfPlayer.respawnAt - performance.now());
  $('#respawnNum').textContent = Math.ceil(remain/1000);
  if(remain<=0){
    const sp = makeSpawn();
    selfPlayer.x = sp.x; selfPlayer.y = sp.y;
    selfPlayer.vx = 0; selfPlayer.vy = 0;
    selfPlayer.hp = 100; selfPlayer.alive = true;
    selfPlayer.weapon = 'sword'; selfPlayer.gunType = null; selfPlayer.ammo = 0;
    selfPlayer.stunUntil = 0;
    updateWeaponHud();
    $('#respawnOverlay').classList.remove('active');
  }
}

function updateRemoteInterp(){
  players.forEach(p=>{
    if(p.id===myId) return;
    if(p.rx===undefined) return;
    p.x += (p.rx - p.x) * 0.35;
    p.y += (p.ry - p.y) * 0.35;
  });
}

/* =========================================================
   RENDER
========================================================= */
function drawBackground(){
  ctx.fillStyle = '#0d1420';
  ctx.fillRect(0,0,WORLD_W,WORLD_H);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for(let i=0;i<40;i++){
    const sx = (i*53)%WORLD_W, sy=(i*97)%WORLD_H;
    ctx.fillRect(sx, sy, 1,1);
  }
  ctx.strokeStyle = 'rgba(62,230,214,0.05)';
  for(let x=0;x<WORLD_W;x+=24){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,WORLD_H); ctx.stroke(); }
}

function drawPlatforms(){
  PLATFORMS.forEach(p=>{
    ctx.fillStyle = '#1c2433';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#2f3b52';
    ctx.fillRect(p.x, p.y, p.w, 2);
    ctx.strokeStyle = '#0a0d14';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x+0.5, p.y+0.5, p.w-1, p.h-1);
  });
}

function drawPlayer(p){
  if(!p.alive) return;
  const x = Math.round(p.x), y = Math.round(p.y);
  ctx.save();

  ctx.fillStyle='rgba(0,0,0,.35)';
  ctx.fillRect(x-1, y+p.h-1, p.w+2, 2);

  ctx.fillStyle = '#12161f';
  ctx.fillRect(x+2, y+11, 2, 5);
  ctx.fillRect(x+6, y+11, 2, 5);

  ctx.fillStyle = p.color;
  ctx.fillRect(x+1, y+4, p.w-2, 8);

  ctx.fillStyle = '#f2c9a0';
  ctx.fillRect(x+2, y, p.w-4, 5);

  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(x+2, y, p.w-4, 2);

  const cx = x+p.w/2, cy = y+p.h/2-2;
  const w = WEAPONS[p.weapon]||WEAPONS.sword;
  ctx.translate(cx,cy);
  ctx.rotate(p.angle);
  ctx.fillStyle = w.color;
  ctx.fillRect(2, -1, w.length||9, 2);
  ctx.restore();
}

function drawNameplates(){
  if(!uiCanvas) return;
  uiCtx.setTransform(uiDpr, 0, 0, uiDpr, 0, 0);
  uiCtx.clearRect(0, 0, uiCanvas.width/uiDpr, uiCanvas.height/uiDpr);

  players.forEach(p=>{
    if(!p.alive) return;
    const x = Math.round(p.x), y = Math.round(p.y);
    const barW = (p.w+16) * uiScale;
    const barH = Math.max(2, 3*uiScale);
    const barX = (x-8) * uiScale;
    const barY = (y-9) * uiScale;
    const cx = (x + p.w/2) * uiScale;

    uiCtx.fillStyle = 'rgba(0,0,0,.5)';
    uiCtx.fillRect(barX, barY, barW, barH);
    uiCtx.fillStyle = p.color;
    uiCtx.fillRect(barX, barY, barW * clamp(p.hp/100,0,1), barH);

    const fontPx = Math.max(9, Math.round(6*uiScale));
    uiCtx.font = fontPx + 'px "Courier New", monospace';
    uiCtx.textAlign = 'center';
    uiCtx.textBaseline = 'alphabetic';
    const ny = (y-11) * uiScale;
    uiCtx.lineWidth = Math.max(2, Math.round(fontPx*0.28));
    uiCtx.strokeStyle = 'rgba(0,0,0,.65)';
    uiCtx.strokeText(p.name.slice(0,10), cx, ny);
    uiCtx.fillStyle = '#eef2f8';
    uiCtx.fillText(p.name.slice(0,10), cx, ny);

    if(isStunned(p)){
      const starFont = Math.max(10, Math.round(8*uiScale));
      uiCtx.font = starFont + 'px "Courier New", monospace';
      const spin = performance.now()/140;
      for(let i=0;i<3;i++){
        const a = spin + i*(Math.PI*2/3);
        const sx = cx + Math.cos(a)*10*uiScale;
        const sy = ny - 8*uiScale + Math.sin(a)*3*uiScale;
        uiCtx.fillStyle = '#ffd76b';
        uiCtx.fillText('★', sx, sy);
      }
    }
  });

  drawInteractionPrompts();
}

function drawBullets(){
  bulletsSelf.forEach(b=>{
    ctx.fillStyle = WEAPONS[b.weapon].color;
    const s = WEAPONS[b.weapon].size;
    ctx.fillRect(b.x-s/2, b.y-s/2, s, s);
  });
  bulletsIncoming.forEach(b=>{
    ctx.fillStyle = WEAPONS[b.weapon].color;
    const s = WEAPONS[b.weapon].size;
    ctx.fillRect(b.x-s/2, b.y-s/2, s, s);
  });
}

function drawDrops(){
  const t = performance.now();
  drops.forEach(d=>{
    const w = WEAPONS[d.weapon];
    const bob = d.landed ? Math.sin(t/220 + d.x) * 1.2 : 0;
    const dx = Math.round(d.x - DROP_SIZE/2), dy = Math.round(d.y + bob);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(dx-1, dy-1, DROP_SIZE+2, DROP_SIZE+2);
    ctx.fillStyle = w.color;
    ctx.fillRect(dx, dy, DROP_SIZE, DROP_SIZE);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(dx+1, dy+1, DROP_SIZE-2, 1);
  });
}

function drawThrows(){
  [...throwsSelf, ...throwsIncoming].forEach(t=>{
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(Math.atan2(t.vy,t.vx));
    ctx.fillStyle = WEAPONS[t.weapon].color;
    ctx.fillRect(-THROW_SIZE, -1, THROW_SIZE*2, 2);
    ctx.restore();
  });
}

function drawInteractionPrompts(){
  if(!uiCanvas || !selfPlayer) return;
  const cx = selfPlayer.x + selfPlayer.w/2, cy = selfPlayer.y + selfPlayer.h/2;
  drops.forEach(d=>{
    if(!d.landed) return;
    const dist = Math.hypot(cx-d.x, cy-(d.y+DROP_SIZE/2));
    if(dist > PICKUP_RADIUS) return;
    const px = d.x * uiScale, py = (d.y - 6) * uiScale;
    const fontPx = Math.max(10, Math.round(7*uiScale));
    uiCtx.font = 'bold ' + fontPx + 'px "Courier New", monospace';
    uiCtx.textAlign = 'center';
    uiCtx.lineWidth = Math.max(2, Math.round(fontPx*0.28));
    uiCtx.strokeStyle = 'rgba(0,0,0,.7)';
    uiCtx.strokeText('[E]', px, py);
    uiCtx.fillStyle = '#ffd76b';
    uiCtx.fillText('[E]', px, py);
  });
}

function drawParticles(){
  for(let i=particles.length-1;i>=0;i--){
    const pt = particles[i];
    pt.x+=pt.vx; pt.y+=pt.vy; pt.life--;
    if(pt.life<=0){ particles.splice(i,1); continue; }
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = clamp(pt.life/16,0,1);
    ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
    ctx.globalAlpha = 1;
  }
}

function drawCrosshair(){
  const x = input.mouseX, y = input.mouseY;
  ctx.strokeStyle = '#ff3d6e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x-5,y); ctx.lineTo(x-2,y);
  ctx.moveTo(x+2,y); ctx.lineTo(x+5,y);
  ctx.moveTo(x,y-5); ctx.lineTo(x,y-2);
  ctx.moveTo(x,y+2); ctx.lineTo(x,y+5);
  ctx.stroke();
}

/* =========================================================
   LOOP PRINCIPAL
========================================================= */
let lastTime = performance.now();
function loop(now){
  if(currentState !== 'playing') return;
  const dt = Math.min(33, now-lastTime); lastTime = now;

  updatePhysics(selfPlayer, dt);
  updateRespawn();
  if(input.firing && selfPlayer.alive && !isStunned(selfPlayer) && selfPlayer.weapon!=='sword' && selfPlayer.ammo>0){
    const w = WEAPONS[selfPlayer.weapon];
    if(w.auto) tryShoot();
  }
  updateBullets(dt);
  updateThrows(dt);
  updateRemoteInterp();
  hostMaybeSpawnDrop(dt);
  updateDrops();

  if(now - lastStateSent > STATE_RATE){
    lastStateSent = now;
    socket.emit('state', {
      name:myName, color:myColor, host:isHost,
      x:selfPlayer.x, y:selfPlayer.y, angle:selfPlayer.angle, facing:selfPlayer.facing,
      weapon:selfPlayer.weapon, hp:selfPlayer.hp, alive:selfPlayer.alive,
      kills:selfPlayer.kills, onGround:selfPlayer.onGround,
      stunned:isStunned(selfPlayer),
    });
  }

  drawBackground();
  drawPlatforms();
  drawDrops();
  players.forEach(p=> drawPlayer(p));
  drawBullets();
  drawThrows();
  drawParticles();
  drawNameplates();
  drawCrosshair();

  $('#hpFill').style.width = clamp(selfPlayer.hp,0,100) + '%';

  scoreboardTimer += dt;
  if(scoreboardTimer > 300){ scoreboardTimer=0; renderScoreboard(); }

  requestAnimationFrame(loop);
}

})();