# Tetra Colors

[简体中文](README-zh-CN.md)

Tetra Colors is an open-source, self-hosted multiplayer browser card game. There are no accounts to create: enter a nickname, create a room, and share its five-character code with friends. The interface is currently in Simplified Chinese and works on phones and desktop browsers.

- Live game: <https://tetra-colors.gt610.dpdns.org>
- License: [AGPL-3.0](LICENSE)

## What is playable today

- Rooms hold two to six seats. A host can invite people or add easy, standard, and hard computer players.
- Each round begins with seven cards per player. The deck includes number cards, skip, reverse, draw-two, wild, and wild-draw-four cards. The server checks every play, including the wild-draw-four restriction.
- Turns last 30 seconds. Players draw by clicking the pile; after drawing a playable card, they may play it or end the turn.
- Opening deals, draws, and plays have table animations, with separate feedback for skips, direction changes, and color changes. Input stays locked during an animation so the display cannot get ahead of the game state.
- Hands overlap to fit the available width. They can be swiped on phones and scrolled with a horizontal scrollbar on desktop, while retaining a usable part of every card.
- Each of the four colors has its own geometric shape. Unplayable cards are dimmed, and the interface respects the system reduced-motion setting.
- A disconnected player has 30 seconds to return to the same seat using the session stored in the current tab. After that, a computer player takes over an active seat. A room is removed once it has no human-controlled seats.

## How to play

1. Enter a nickname and create a room, or join one with a room code from a friend.
2. Once the room has at least two seats, the host can start a round.
3. On your turn, play a card that matches the current color, number, or action type. A color-changing card lets you choose the next color.
4. If no card is playable, click the draw pile. If the drawn card can be played immediately, that card is the only card you may play this turn; otherwise, end the turn.
5. The first player to empty their hand wins. The host can start another round with the same seats.

## Run locally and preview changes

Install [Bun](https://bun.sh/), then install dependencies and start the Worker.

```sh
git clone https://github.com/GT-610/tetra-colors.git
cd tetra-colors
bun install
bun run dev
```

Wrangler normally serves the complete application at `http://127.0.0.1:8787`. To see changes as you work, leave that process running and start Vite in a second terminal.

```sh
bun run client:dev
```

Open the address printed by Vite, usually `http://localhost:5173`. React and CSS changes hot reload, while `/api` and `/ws` are proxied to the local Worker on port 8787.

## Where to look in the code

- `src/logic/` contains the pure game rules. It does not depend on the Worker runtime, and receives randomness as an argument for testing.
- `src/protocol.ts` defines the messages shared by the client and server.
- `src/room-do.ts` owns authoritative room state, validation, timers, computer players, and each player's game snapshot.
- `src/worker.ts` serves static assets and routes the HTTP API and WebSockets.
- `client/` is the React client. It submits player intent and renders server snapshots.

The server decides every game result. Another player's hand appears in a personal snapshot only as a card count, so the client never receives hidden cards. Active rooms are stored in Durable Objects and synchronize through event-driven WebSockets without polling.

The project does not create accounts or persistent cross-room identities, collect analytics, or track players. It has no advertising, external images, or external fonts. Nicknames and room sessions exist only for the current room.

## Check and deploy

Run these checks before committing.

```sh
bun run typecheck
bun run lint
bun run test
git diff --check
```

`bun run test` builds the client first. It covers pure rules and protocol parsing, then runs real room, WebSocket, and rate-limit scenarios along with simulated games. Run `bun run build` when you only need a production build.

To self-host on Cloudflare, first choose a Worker name in `wrangler.jsonc`, then authenticate and deploy.

```sh
bunx wrangler login
bun run deploy
```

The Durable Object binding and migration are already in the configuration. The live project is built automatically by Cloudflare after updates to `main`. Forks can set up their own Git integration or use Wrangler for manual deployments. Keep secrets in environment variables or in the deployment platform's secret settings.

See [package.json](package.json) and [AGENTS.md](AGENTS.md) for more scripts and repository conventions.

## License

Tetra Colors is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for the full text.
