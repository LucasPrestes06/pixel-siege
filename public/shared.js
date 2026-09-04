/* =========================================================
   PIXEL SIEGE — CONSTANTES COMPARTILHADAS (servidor + cliente)
   Carregado no browser via <script src="shared.js"> (vira window.PS)
   e no Node via require('./public/shared.js').
========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORLD_W = 720, WORLD_H = 405;

  const PALETTE = ['#ff3d6e', '#3ee6d6', '#ffb02e', '#8dff6b', '#c77dff', '#ff8c42', '#5ac8ff', '#ff5ac0'];

  const PLATFORMS = [
    { x: 0,   y: 375, w: 720, h: 30 },  // chão
    { x: 0,   y: 0,   w: 12,  h: 405 }, // parede esq
    { x: 708, y: 0,   w: 12,  h: 405 }, // parede dir
    { x: 60,  y: 300, w: 120, h: 15 },
    { x: 540, y: 300, w: 120, h: 15 },
    { x: 300, y: 240, w: 120, h: 15 },
    { x: 113, y: 173, w: 105, h: 15 },
    { x: 503, y: 173, w: 105, h: 15 },
    { x: 315, y: 113, w: 90,  h: 15 },
  ];

  const SPAWNS = [
    { x: 30,  y: 345 }, { x: 660, y: 345 }, { x: 90,  y: 270 }, { x: 600, y: 270 },
    { x: 330, y: 210 }, { x: 143, y: 143 }, { x: 533, y: 143 }, { x: 345, y: 83 },
  ];

  const WEAPONS = {
    pistol: { name: 'PISTOLA',          damage: 14, fireRate: 340, bulletSpeed: 9,  spread: 0.03,  auto: false, color: '#ffb02e', size: 1.6, mag: 15, life: 150 },
    rifle:  { name: 'FUZIL DE ASSALTO', damage: 9,  fireRate: 105, bulletSpeed: 10, spread: 0.075, auto: true,  color: '#3ee6d6', size: 1.5, mag: 30, life: 140 },
    sniper: { name: 'SNIPER',           damage: 48, fireRate: 900, bulletSpeed: 15, spread: 0.0,   auto: false, color: '#ff3d6e', size: 1.9, mag: 8,  life: 120 },
    sword:  { name: 'ESPADA',           damage: 26, cooldown: 420, range: 20, arc: Math.PI / 2.1, color: '#d7deea', length: 14, melee: true },
  };
  const GUN_TYPES = ['pistol', 'rifle', 'sniper'];

  /* Drops aéreos */
  const DROP_BASE_INTERVAL = 14000; // ms com 1 jogador
  const DROP_MIN_INTERVAL  = 3200;  // ms piso
  const DROP_FIRST_DELAY   = 4000;  // ms após início da partida
  const DROP_FALL_SPEED    = 150;   // px/s
  const DROP_SIZE          = 9;
  const PICKUP_RADIUS      = 20;
  const MAX_DROPS_ON_MAP   = 6;

  /* Arremesso / atordoamento */
  const THROW_SPEED = 7.2;
  const THROW_LIFE  = 90;
  const THROW_SIZE  = 4;
  const STUN_MS     = 500;

  const RESPAWN_MS = 3000;
  const MAX_PLAYERS = 8;

  /* Coluna X -> topo da plataforma mais alta que a intercepta (pouso do drop) */
  function findLandingY(x) {
    let bestY = WORLD_H;
    for (const plat of PLATFORMS) {
      if (plat.h >= WORLD_H) continue; // ignora paredes
      if (x >= plat.x && x <= plat.x + plat.w && plat.y < bestY) bestY = plat.y;
    }
    return bestY - DROP_SIZE;
  }

  return {
    WORLD_W, WORLD_H, PALETTE, PLATFORMS, SPAWNS, WEAPONS, GUN_TYPES,
    DROP_BASE_INTERVAL, DROP_MIN_INTERVAL, DROP_FIRST_DELAY, DROP_FALL_SPEED, DROP_SIZE, PICKUP_RADIUS, MAX_DROPS_ON_MAP,
    THROW_SPEED, THROW_LIFE, THROW_SIZE, STUN_MS, RESPAWN_MS, MAX_PLAYERS,
    findLandingY,
  };
});
