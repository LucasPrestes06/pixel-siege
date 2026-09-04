# PIXEL SIEGE — Online (v2)

Platform shooter multiplayer com servidor dedicado (Express + Socket.IO).

## Estrutura

```
pixel-siege/
├── package.json
├── server.js            # servidor dedicado (salas, placar, drops, relay)
└── public/
    ├── index.html       # telas: menu / lobby / jogo + HUD
    ├── style.css        # visual (mesmo do alpha + ajustes)
    ├── shared.js        # constantes compartilhadas servidor ↔ cliente
    └── app.js           # toda a lógica do jogo no cliente
```

## Rodar

```bash
npm install
npm start          # http://localhost:3000
```

`PORT=8080 npm start` para outra porta. Para jogar pela internet, publique em qualquer
host Node (Render, Railway, Fly, VPS...). O cliente conecta automaticamente na mesma
origem que serviu a página — não precisa configurar URL.

## Controles

| Ação | Tecla |
|---|---|
| Mover | A / D ou ← → |
| Pular (variável) | W / ↑ / Espaço |
| Mirar | Mouse |
| Ataque primário | Clique esquerdo |
| Espada (sempre) | Clique direito |
| Trocar arma | 1 / 2 / Q / roda do mouse |
| Coletar arma | E perto do drop |
| Arremessar arma vazia (atordoa 0,5 s) | Clique esquerdo com pente vazio |

## Arquitetura de rede

- **Servidor autoritativo em**: salas e códigos, lista de jogadores, cor única por jogador,
  host e migração de host, início da partida, entrada em partida em andamento,
  placar (kills/mortes), spawn dos drops (ritmo escala com nº de jogadores) e
  exclusividade da coleta (o primeiro que pedir leva).
- **Cliente autoritativo em**: física do próprio personagem e detecção de acerto no
  próprio personagem (mesmo modelo do alpha). Tiros, golpes de espada e arremessos
  são retransmitidos pelo servidor a todos os outros jogadores da sala.
- `hitconfirm` / `stunconfirm` vão apenas para quem acertou (feedback visual).

## Debug

No console do navegador: `__ps.self`, `__ps.players`, `__ps.drops`, `__ps.socket`.
