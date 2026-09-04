const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Servir os arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Gerenciamento de salas na memória do servidor
const rooms = new Map();

function genRoomCode() {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
  return s;
}

io.on('connection', (socket) => {
  let currentRoom = null;

  // Criar Sala
  socket.on('createRoom', ({ name, color }) => {
    let code = genRoomCode();
    while (rooms.has(code)) code = genRoomCode();

    const player = { id: socket.id, name, color, host: true };
    rooms.set(code, { host: socket.id, players: new Map([[socket.id, player]]) });

    currentRoom = code;
    socket.join(code);
    socket.emit('roomCreated', { code, player, players: Array.from(rooms.get(code).players.values()) });
  });

  // Entrar em Sala
  socket.on('joinRoom', ({ code, name, color }) => {
    const roomKey = code.toUpperCase();
    const room = rooms.get(roomKey);

    if (!room) {
      return socket.emit('errorMsg', 'SALA NÃO ENCONTRADA!');
    }

    const player = { id: socket.id, name, color, host: false };
    room.players.set(socket.id, player);

    currentRoom = roomKey;
    socket.join(roomKey);

    socket.emit('roomJoined', { code: roomKey, player, players: Array.from(room.players.values()) });
    socket.to(roomKey).emit('playerJoined', player);
  });

  // Iniciar Jogo
  socket.on('startGame', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room && room.host === socket.id) {
      io.to(currentRoom).emit('gameStarted');
    }
  });

  // Sincronização de Estado (Posição/Física)
  socket.on('state', (data) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('state', { ...data, id: socket.id });
    }
  });

  // Eventos de Combate / Ações
  socket.on('shoot', (data) => socket.to(currentRoom).emit('shoot', { ...data, id: socket.id }));
  socket.on('melee', (data) => socket.to(currentRoom).emit('melee', { ...data, id: socket.id }));
  socket.on('throw', (data) => socket.to(currentRoom).emit('throw', { ...data, id: socket.id }));
  socket.on('hitconfirm', (data) => io.to(currentRoom).emit('hitconfirm', data));
  socket.on('stunconfirm', (data) => io.to(currentRoom).emit('stunconfirm', data));
  socket.on('death', (data) => io.to(currentRoom).emit('death', { ...data, id: socket.id }));

  // Drops de Armas
  socket.on('dropspawn', (data) => socket.to(currentRoom).emit('dropspawn', data));
  socket.on('droppickup', (data) => io.to(currentRoom).emit('droppickup', data));

  // Desconexão
  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.players.delete(socket.id);
      socket.to(currentRoom).emit('playerLeft', socket.id);

      if (room.players.size === 0) {
        rooms.delete(currentRoom);
      } else if (room.host === socket.id) {
        const nextHost = room.players.keys().next().value;
        room.host = nextHost;
        room.players.get(nextHost).host = true;
        io.to(currentRoom).emit('hostChanged', nextHost);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor online rodando na porta ${PORT}`);
});