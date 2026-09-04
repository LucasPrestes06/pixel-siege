'use strict';
/* =========================================================
   PIXEL SIEGE — SERVIDOR DEDICADO (Express + Socket.IO)

   Responsabilidades do servidor:
   - Salas (código de 4 letras), lista de jogadores, host e troca de host
   - Cor única por jogador (paleta compartilhada)
   - Início da partida + entrada de jogadores em partida já em andamento
   - Placar oficial (kills/mortes) e kill feed
   - Spawn autoritativo dos drops de armas (não depende mais do host)
   - Relay dos eventos de combate (tiro, espada, arremesso, confirmações)

   A detecção de acerto continua "self-authoritative" no cliente (cada
   jogador detecta os acertos no PRÓPRIO personagem), igual à versão alpha —
   isso mantém o jogo responsivo e simples.
========================================================= */
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const PS = require('./public/shared.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, players: io.engine.clientsCount }));

/* ---------------------------------------------------------
   ESTADO EM MEMÓRIA
--------------------------------------------------------- */
const rooms = new Map(); // code -> room
let dropSeq = 0;

function genRoomCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I/O para evitar confusão com 1/0
  let s = '';
  for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
  return s;
}

function sanitizeName(name) {
  const s = String(name || '').replace(/[<>&"']/g, '').trim().toUpperCase().slice(0, 12);
  return s || 'JOGADOR';
}

function pickColor(room) {
  const used = new Set([...room.players.values()].map(p => p.color));
  const free = PS.PALETTE.find(c => !used.has(c));
  return free || PS.PALETTE[Math.floor(Math.random() * PS.PALETTE.length)];
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, color: p.color, host: p.host, kills: p.kills, deaths: p.deaths };
}

function roomPlayers(room) {
  return [...room.players.values()].map(publicPlayer);
}

function broadcastScores(room) {
  io.to(room.code).emit('scores', roomPlayers(room));
}

function createRoom(hostSocket) {
  let code = genRoomCode();
  while (rooms.has(code)) code = genRoomCode();
  const room = {
    code,
    hostId: hostSocket.id,
    players: new Map(),
    started: false,
    drops: new Map(),      // dropId -> {id, weapon, x, landY, spawnedAt}
    dropTimer: null,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, socket, name) {
  const player = {
    id: socket.id,
    name: sanitizeName(name),
    color: pickColor(room),
    host: socket.id === room.hostId,
    kills: 0,
    deaths: 0,
  };
  room.players.set(socket.id, player);
  return player;
}

/* ---------------------------------------------------------
   DROPS AUTORITATIVOS
--------------------------------------------------------- */
function dropInterval(room) {
  const n = Math.max(1, room.players.size);
  return Math.max(PS.DROP_MIN_INTERVAL, Math.min(PS.DROP_BASE_INTERVAL, PS.DROP_BASE_INTERVAL / n));
}

function scheduleDrop(room, delay) {
  clearTimeout(room.dropTimer);
  if (!room.started) return;
  room.dropTimer = setTimeout(() => spawnDrop(room), delay);
}

function spawnDrop(room) {
  if (!room.started || !rooms.has(room.code)) return;
  if (room.drops.size < PS.MAX_DROPS_ON_MAP) {
    const weapon = PS.GUN_TYPES[Math.floor(Math.random() * PS.GUN_TYPES.length)];
    const x = 24 + Math.random() * (PS.WORLD_W - 48);
    const landY = PS.findLandingY(x);
    const drop = { id: 'd' + (++dropSeq), weapon, x, landY, spawnedAt: Date.now() };
    room.drops.set(drop.id, drop);
    io.to(room.code).emit('dropspawn', drop);
  }
  scheduleDrop(room, dropInterval(room));
}

/* Drops já no mapa, com o tempo decorrido (para quem entra no meio da partida) */
function dropsSnapshot(room) {
  const now = Date.now();
  return [...room.drops.values()].map(d => ({ ...d, elapsedMs: now - d.spawnedAt }));
}

/* ---------------------------------------------------------
   SAÍDA / LIMPEZA
--------------------------------------------------------- */
function leaveRoom(socket, room) {
  if (!room) return;
  const wasHost = room.hostId === socket.id;
  room.players.delete(socket.id);
  socket.leave(room.code);
  socket.data.roomCode = null;

  if (room.players.size === 0) {
    clearTimeout(room.dropTimer);
    rooms.delete(room.code);
    return;
  }
  io.to(room.code).emit('playerLeft', socket.id);
  if (wasHost) {
    const next = room.players.values().next().value;
    room.hostId = next.id;
    next.host = true;
    io.to(room.code).emit('hostChanged', next.id);
  }
  broadcastScores(room);
}

function currentRoom(socket) {
  return socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;
}

/* ---------------------------------------------------------
   SOCKET.IO
--------------------------------------------------------- */
io.on('connection', (socket) => {
  socket.data.roomCode = null;

  socket.on('createRoom', ({ name } = {}) => {
    if (currentRoom(socket)) leaveRoom(socket, currentRoom(socket));
    const room = createRoom(socket);
    const player = addPlayer(room, socket, name);
    socket.data.roomCode = room.code;
    socket.join(room.code);
    socket.emit('roomCreated', { code: room.code, you: publicPlayer(player), players: roomPlayers(room) });
  });

  socket.on('joinRoom', ({ code, name } = {}) => {
    const key = String(code || '').toUpperCase().trim();
    const room = rooms.get(key);
    if (!room) return socket.emit('errorMsg', 'SALA NÃO ENCONTRADA');
    if (room.players.size >= PS.MAX_PLAYERS) return socket.emit('errorMsg', 'SALA CHEIA');
    if (currentRoom(socket)) leaveRoom(socket, currentRoom(socket));

    const player = addPlayer(room, socket, name);
    socket.data.roomCode = room.code;
    socket.join(room.code);

    socket.emit('roomJoined', { code: room.code, you: publicPlayer(player), players: roomPlayers(room), started: room.started });
    socket.to(room.code).emit('playerJoined', publicPlayer(player));

    // Partida já em andamento: entra direto no jogo com os drops atuais
    if (room.started) socket.emit('gameStarted', { drops: dropsSnapshot(room) });
  });

  socket.on('leaveRoom', () => leaveRoom(socket, currentRoom(socket)));

  socket.on('startGame', () => {
    const room = currentRoom(socket);
    if (!room || room.hostId !== socket.id || room.started) return;
    room.started = true;
    room.drops.clear();
    for (const p of room.players.values()) { p.kills = 0; p.deaths = 0; }
    io.to(room.code).emit('gameStarted', { drops: [] });
    scheduleDrop(room, PS.DROP_FIRST_DELAY);
  });

  /* ---- Estado de movimento (relay, ~18x/s por cliente) ---- */
  socket.on('state', (data) => {
    const room = currentRoom(socket);
    if (!room || !room.started || !data) return;
    socket.to(room.code).emit('state', {
      id: socket.id,
      x: +data.x || 0, y: +data.y || 0,
      angle: +data.angle || 0, facing: data.facing === -1 ? -1 : 1,
      weapon: data.weapon in PS.WEAPONS ? data.weapon : 'sword',
      hp: Math.max(0, Math.min(100, +data.hp || 0)),
      alive: !!data.alive, onGround: !!data.onGround, stunned: !!data.stunned,
    });
  });

  /* ---- Combate (relay aos demais) ---- */
  const relay = (evt) => socket.on(evt, (data) => {
    const room = currentRoom(socket);
    if (!room || !room.started) return;
    socket.to(room.code).emit(evt, { ...data, id: socket.id });
  });
  relay('shoot');
  relay('melee');
  relay('throw');

  /* ---- Confirmações: enviadas SÓ para quem atacou ---- */
  socket.on('hitconfirm', ({ byId, x, y } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.players.has(byId)) return;
    io.to(byId).emit('hitconfirm', { victimId: socket.id, x, y });
  });
  socket.on('stunconfirm', ({ byId, x, y } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.players.has(byId)) return;
    io.to(byId).emit('stunconfirm', { victimId: socket.id, x, y });
  });

  /* ---- Morte: o servidor contabiliza e distribui o placar oficial ---- */
  socket.on('death', ({ byId } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.started) return;
    const victim = room.players.get(socket.id);
    if (!victim) return;
    victim.deaths++;
    const killer = byId && byId !== socket.id ? room.players.get(byId) : null;
    if (killer) killer.kills++;
    io.to(room.code).emit('death', {
      id: socket.id, name: victim.name,
      byId: killer ? killer.id : null, killerName: killer ? killer.name : null,
    });
    broadcastScores(room);
  });

  /* ---- Coleta de drop: o primeiro que pedir leva ---- */
  socket.on('droppickup', ({ dropId } = {}) => {
    const room = currentRoom(socket);
    if (!room || !room.drops.has(dropId)) return; // já coletado por outro
    const drop = room.drops.get(dropId);
    room.drops.delete(dropId);
    io.to(room.code).emit('droppickup', { dropId, byId: socket.id, weapon: drop.weapon });
  });

  socket.on('disconnect', () => leaveRoom(socket, currentRoom(socket)));
});

server.listen(PORT, () => {
  console.log(`PIXEL SIEGE online em http://localhost:${PORT}`);
});
