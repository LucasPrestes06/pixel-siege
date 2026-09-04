// CONEXÃO COM O SERVIDOR
const socket = io();

// ELEMENTOS DO DOM
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const menuScreen = document.getElementById('menuScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const btnCreate = document.getElementById('btnCreate');
const btnShowJoin = document.getElementById('btnShowJoin');
const joinBox = document.getElementById('joinBox');
const btnJoin = document.getElementById('btnJoin');
const btnStart = document.getElementById('btnStart');
const btnLeaveLobby = document.getElementById('btnLeaveLobby');
const codeBox = document.getElementById('codeBox');
const playerList = document.getElementById('playerList');
const roomTag = document.getElementById('roomTag');

// ESTADO DO JOGO
let myId = null;
let currentRoomCode = null;
let isHost = false;
let gameRunning = false;
let players = {};

// MEU JOGADOR LOCAL
let localPlayer = {
  x: 100,
  y: 200,
  vx: 0,
  vy: 0,
  width: 20,
  height: 20,
  color: '#' + Math.floor(Math.random()*16777215).toString(16),
  hp: 100
};

// TECLAS PRESSIONADAS
const keys = {};
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);

// EVENTOS DE INTERFACE (BOTÕES)
btnShowJoin.onclick = () => joinBox.style.display = joinBox.style.display === 'none' ? 'block' : 'none';

btnCreate.onclick = () => {
  const name = nameInput.value.trim() || 'Jogador';
  socket.emit('createRoom', { name, color: localPlayer.color });
};

btnJoin.onclick = () => {
  const name = nameInput.value.trim() || 'Jogador';
  const code = codeInput.value.trim().toUpperCase();
  if (code.length === 4) {
    socket.emit('joinRoom', { code, name, color: localPlayer.color });
  }
};

btnStart.onclick = () => {
  socket.emit('startGame');
};

btnLeaveLobby.onclick = () => {
  location.reload();
};

// EVENTOS DO SOCKET.IO
socket.on('connect', () => {
  myId = socket.id;
});

socket.on('roomCreated', ({ code, player, players: list }) => {
  setupLobby(code, true, list);
});

socket.on('roomJoined', ({ code, player, players: list }) => {
  setupLobby(code, false, list);
});

socket.on('playerJoined', (player) => {
  addPlayerToUI(player);
});

socket.on('gameStarted', () => {
  // OCULTA OS MENUS E INICIA O LOOP DO JOGO
  menuScreen.classList.remove('active');
  lobbyScreen.classList.remove('active');
  gameRunning = true;
  requestAnimationFrame(gameLoop);
});

socket.on('state', (data) => {
  // ATUALIZA A POSIÇÃO DOS OUTROS JOGADORES
  if (data.id !== myId) {
    players[data.id] = data;
  }
});

socket.on('playerLeft', (id) => {
  delete players[id];
});

// FUNÇÕES DE LOBBY
function setupLobby(code, hostStatus, list) {
  currentRoomCode = code;
  isHost = hostStatus;
  menuScreen.classList.remove('active');
  lobbyScreen.classList.add('active');
  
  roomTag.innerText = `SALA: ${code}`;
  codeBox.innerHTML = code.split('').map(c => `<div class="code-letter">${c}</div>`).join('');
  btnStart.style.display = isHost ? 'inline-block' : 'none';
  
  playerList.innerHTML = '';
  list.forEach(addPlayerToUI);
}

function addPlayerToUI(p) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="swatch" style="background:${p.color}"></span> ${p.name}`;
  playerList.appendChild(li);
}

// LOOP PRINCIPAL DE FÍSICA E RENDERIZAÇÃO
function gameLoop() {
  if (!gameRunning) return;

  // 1. MOVIMENTAÇÃO SIMPLES DO JOGADOR LOCAL
  if (keys['KeyA'] || keys['ArrowLeft']) localPlayer.vx = -3;
  else if (keys['KeyD'] || keys['ArrowRight']) localPlayer.vx = 3;
  else localPlayer.vx = 0;

  if (keys['KeyW'] || keys['ArrowUp']) localPlayer.vy = -3;
  else if (keys['KeyS'] || keys['ArrowDown']) localPlayer.vy = 3;
  else localPlayer.vy = 0;

  localPlayer.x += localPlayer.vx;
  localPlayer.y += localPlayer.vy;

  // ENVIA A SUA POSIÇÃO PARA OS OUTROS
  socket.emit('state', {
    x: localPlayer.x,
    y: localPlayer.y,
    color: localPlayer.color
  });

  // 2. DESENHAR NA TELA
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // DESENHA SEU JOGADOR
  ctx.fillStyle = localPlayer.color;
  ctx.fillRect(localPlayer.x, localPlayer.y, localPlayer.width, localPlayer.height);

  // DESENHA OS OUTROS JOGADORES
  for (let id in players) {
    const p = players[id];
    ctx.fillStyle = p.color || '#ff0000';
    ctx.fillRect(p.x, p.y, 20, 20);
  }

  // REPETE O LOOP
  requestAnimationFrame(gameLoop);
}