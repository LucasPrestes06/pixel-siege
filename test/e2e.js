// Teste E2E: dois clientes, criar/entrar sala, iniciar, mover, drop, coleta, tiro, dano, morte, placar, saída, reentrada
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const mk = async (tag) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', e => errors.push(tag + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#connStatus.ok');
    return page;
  };
  const join = async (page, code) => {
    if (await page.$eval('#joinBox', e => e.style.display !== 'block')) await page.click('#btnShowJoin');
    await page.fill('#codeInput', code);
    await page.click('#btnJoin');
  };
  const A = await mk('A'), B = await mk('B');

  await A.fill('#nameInput', 'alice');
  await A.click('#btnCreate');
  await A.waitForSelector('#lobbyScreen.active');
  const code = await A.$$eval('.code-letter', els => els.map(e => e.textContent).join(''));
  console.log('sala:', code);

  // código inválido
  await B.fill('#nameInput', 'bob');
  await join(B, 'ZZZZ');
  await B.waitForSelector('#toast.show');
  assert((await B.$eval('#toast', e => e.textContent)).includes('NÃO ENCONTRADA'), 'sala inexistente dá erro');

  await join(B, code);
  await B.waitForSelector('#lobbyScreen.active');
  await A.waitForFunction(() => document.querySelectorAll('#playerList li').length === 2);
  assert((await B.$eval('#btnStart', e => e.style.display)) === 'none', 'só o host vê INICIAR');

  await A.click('#btnStart');
  await A.waitForSelector('#gameScreen.active');
  await B.waitForSelector('#gameScreen.active');
  assert(true, 'partida iniciada nos dois clientes');

  // Física: A anda e pula
  const y0 = await A.evaluate(() => __ps.self.y);
  await A.keyboard.down('d'); await A.waitForTimeout(400); await A.keyboard.up('d');
  const x1 = await A.evaluate(() => __ps.self.x);
  assert(x1 > 30, 'jogador anda para a direita (x=' + x1.toFixed(1) + ')');
  await A.keyboard.down('w'); await A.waitForTimeout(120);
  const yJump = await A.evaluate(() => __ps.self.y);
  await A.keyboard.up('w');
  assert(yJump < y0, 'jogador pula (y ' + y0 + ' -> ' + yJump.toFixed(1) + ')');
  await A.waitForTimeout(800);
  assert(await A.evaluate(() => __ps.self.onGround), 'jogador cai e pousa (gravidade + plataforma)');

  // Sincronização: B vê A na posição enviada
  await B.waitForFunction(() => { const p = [...__ps.players.values()].find(p => p.name === 'ALICE'); return p && p.hasRemote; });
  const posB = await B.evaluate(() => { const p = [...__ps.players.values()].find(p => p.name === 'ALICE'); return p.rx; });
  assert(Math.abs(posB - x1) < 40, 'B recebe posição de A (rx=' + posB.toFixed(1) + ')');

  // Drop autoritativo do servidor cai em ~4s
  await A.waitForFunction(() => __ps.drops.length > 0, null, { timeout: 8000 });
  await B.waitForFunction(() => __ps.drops.length > 0, null, { timeout: 8000 });
  assert(true, 'drop de arma sincronizado nos dois clientes');
  await A.waitForFunction(() => __ps.drops[0].landed, null, { timeout: 8000 });

  // Teleporta A para o drop e coleta com E (checa exclusividade no servidor)
  await A.evaluate(() => { const d = __ps.drops[0]; __ps.self.x = d.x - 5; __ps.self.y = d.landY - 8; __ps.self.vy = 0; });
  await A.keyboard.press('e');
  await A.waitForFunction(() => __ps.self.gunType, null, { timeout: 2000 });
  const gun = await A.evaluate(() => ({ g: __ps.self.gunType, a: __ps.self.ammo, w: __ps.self.weapon }));
  assert(gun.a > 0 && gun.w === gun.g, 'A coletou ' + gun.g + ' com ' + gun.a + ' balas');
  await B.waitForFunction(() => __ps.drops.length === 0, null, { timeout: 2000 });
  assert(true, 'drop removido também em B');
  assert((await A.$eval('#wammo', e => e.textContent)).includes('MUNIÇÃO'), 'HUD mostra munição');

  // Coloca A e B lado a lado no chão e A atira em B
  await A.evaluate(() => { __ps.self.x = 200; __ps.self.y = 359; __ps.self.vy = 0; });
  await B.evaluate(() => { __ps.self.x = 260; __ps.self.y = 359; __ps.self.vy = 0; });
  await A.waitForTimeout(200);
  const box = await A.$eval('#game', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const toScreen = (wx, wy) => ({ x: box.x + wx / 720 * box.w, y: box.y + wy / 405 * box.h });
  const tgt = toScreen(265, 365);
  await A.mouse.move(tgt.x, tgt.y);
  await A.waitForTimeout(50);
  const hpBefore = await B.evaluate(() => __ps.self.hp);
  let shots = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    await A.mouse.down(); await A.mouse.up(); shots++;
    await A.waitForTimeout(120);
    if (await B.evaluate(() => !__ps.self.alive)) break;
    await B.evaluate(() => { __ps.self.x = 260; __ps.self.vx = 0; }); // segura B no lugar (recuo/empurrão)
  }
  const hpAfter = await B.evaluate(() => __ps.self.hp);
  assert(hpAfter < hpBefore, 'B tomou dano (' + hpBefore + ' -> ' + hpAfter + ') após ' + shots + ' cliques');
  assert(await B.evaluate(() => !__ps.self.alive), 'B morreu');
  assert(await B.$eval('#respawnOverlay', e => e.classList.contains('active')), 'overlay de respawn em B');
  await A.waitForFunction(() => [...__ps.players.values()].find(p => p.name === 'ALICE').kills === 1, null, { timeout: 2000 });
  assert(true, 'placar do servidor: ALICE 1 kill');
  assert((await A.$eval('#killfeed', e => e.innerText)).includes('ALICE ELIMINOU BOB'), 'kill feed em A');
  assert((await B.$eval('#killfeed', e => e.innerText)).includes('ALICE ELIMINOU BOB'), 'kill feed em B');

  // Respawn após 3s, com espada
  await B.waitForFunction(() => __ps.self.alive, null, { timeout: 5000 });
  const afterRespawn = await B.evaluate(() => ({ hp: __ps.self.hp, w: __ps.self.weapon, g: __ps.self.gunType }));
  assert(afterRespawn.hp === 100 && afterRespawn.w === 'sword' && !afterRespawn.g, 'B renasceu com 100 HP e só espada');

  await A.screenshot({ path: '/root/work/pixel-siege/test/shotA.png' });

  // Munição acaba -> arremesso
  await A.evaluate(() => { __ps.self.ammo = 0; });
  await A.mouse.down(); await A.mouse.up();
  await A.waitForTimeout(100);
  const afterThrow = await A.evaluate(() => ({ w: __ps.self.weapon, g: __ps.self.gunType }));
  assert(afterThrow.w === 'sword' && !afterThrow.g, 'arma vazia arremessada, volta pra espada');

  // B sai; A vê 1 jogador. B reentra em partida em andamento
  await B.click('#exitBtn');
  await B.waitForSelector('#menuScreen.active');
  await A.waitForFunction(() => __ps.players.size === 1, null, { timeout: 3000 });
  assert(true, 'B saiu e foi removido em A');
  await join(B, code);
  await B.waitForSelector('#gameScreen.active', { timeout: 3000 });
  assert(true, 'B entrou direto na partida em andamento');
  await B.waitForTimeout(500);
  await B.screenshot({ path: '/root/work/pixel-siege/test/shotB.png' });

  // A (host) sai -> B vira host
  await A.click('#exitBtn');
  await B.waitForFunction(() => [...__ps.players.values()].find(p => p.id === __ps.socket.id).host, null, { timeout: 3000 });
  assert(true, 'host migrou para B');

  console.log('erros JS:', errors.length ? errors : 'nenhum');
  if (errors.length) process.exit(1);
  await browser.close();
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
