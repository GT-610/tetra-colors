# Tetra Colors

Tetra Colors is an original, open-source, self-hosted multiplayer browser card game. Match the
active color or number, use action cards to redirect the round, and empty your hand first.

- Live deployment: <https://tetra-colors.gt610.dpdns.org>
- License: [AGPL-3.0](LICENSE)
- Runtime: Cloudflare Workers, one Durable Object room actor per room, and Hibernation WebSockets
- Client: React, Vite, Tailwind CSS, and original CSS-only card visuals

The game has no accounts, registration, analytics, advertisements, external images, or external
fonts. A nickname and room state exist only for the lifetime of a room.

## Play

1. Enter a nickname and create a room, or join with a five-character room code.
2. Share the room code with up to five other players. The host can also add easy, standard, or hard
   computer players.
3. The host starts the round. Each player receives seven cards.
4. On your turn, play a card matching the active color or number. You may also use skip, reverse,
   draw-two, wild, or wild-draw-four cards when legal.
5. If no card can be played, draw one. Play it if allowed or end the turn.
6. The first player to empty their hand wins. The host can start another round with the same seats.

Each color has its own shape symbol so that the interface does not rely on color alone. Turns have a
30-second limit. A disconnected player can reclaim their seat with the per-tab session token during
the reconnect window; after that, a computer player takes over the seat.

## Architecture

| Area | Responsibility |
| --- | --- |
| `src/logic/` | Dependency-free deterministic deck, rules, validation, and bot policies |
| `src/protocol.ts` | Shared client/server message contract and input parsing |
| `src/room-do.ts` | Authoritative room state, personalized snapshots, timers, bots, and reconnection |
| `src/worker.ts` | Static assets, HTTP API, rate limits, security headers, and WebSocket routing |
| `client/` | Mobile-first React interface that renders snapshots and sends player intent |

The client never decides whether an action is legal. The room actor validates every action and sends
each player a complete personalized snapshot. Another player's private cards are represented only by
a count. Room tokens are carried in the negotiated WebSocket subprotocol instead of request URLs and
are hashed before storage. HTTP and WebSocket inputs are size-limited and validated, and creation,
joining, and in-room actions are rate-limited.

Durable Object storage keeps an active room resilient across actor restarts. The room and its
nicknames are deleted after the room has no connected human for the idle retention period. There is
no durable user identity or cross-room profile.

## Local development

Requirements:

- [Bun](https://bun.sh/) 1.4 or newer
- A current Node.js release for ecosystem tooling
- A Cloudflare account only when deploying

Install dependencies and start the local Worker:

```sh
git clone https://github.com/GT-610/tetra-colors.git
cd tetra-colors
bun install
bun run dev
```

Wrangler prints the local URL, normally `http://127.0.0.1:8787`. For React hot module replacement,
keep the Worker running and start Vite in a second terminal:

```sh
bun run client:dev
```

Vite proxies `/api` and `/ws` to the Worker on port 8787.

## Verification

Run the complete local quality gate:

```sh
bun run format
bun run typecheck
bun run lint
bun run test
git diff --check
```

The test suite exercises the pure rules, protocol parsing, real Durable Object instances, multiple
WebSockets, reconnection, capacity and permission checks, rate limiting, private-hand isolation,
short bot scheduling, property-based invariants, and at least 100 headless bot games.

With `bun run dev` running, the independent WebSocket smoke test verifies multiple live clients:

```sh
bun run smoke:ws
```

Set `SMOKE_BASE_URL` to test another compatible deployment.

## Deploy your own copy to Cloudflare

1. Fork this repository and clone your fork.
2. Install dependencies with `bun install`.
3. Authenticate Wrangler using one of the supported methods:

   ```sh
   bunx wrangler login
   ```

   For non-interactive deployment, provide a scoped `CLOUDFLARE_API_TOKEN` through your CI or shell
   environment. Never commit it to the repository.

4. Open `wrangler.jsonc` and choose a unique Worker `name`. Keep the `ROOMS` binding, `RoomDO` class,
   SQLite migration, assets binding, and API/WebSocket routing intact.
5. Verify and deploy:

   ```sh
   bun run typecheck
   bun run lint
   bun run test
   bun run deploy
   ```

Wrangler creates the Worker, uploads the static client, applies the Durable Object migration, and
prints a `workers.dev` URL. Visit that URL and create a room to confirm the deployment.

### Optional custom domain

The DNS zone must be active in the same Cloudflare account as the Worker. In the Cloudflare
dashboard, open the Worker, go to its domains and routes settings, add a custom domain, and verify
that HTTPS and WebSocket connections work. You can also declare a Wrangler custom-domain route in
`wrangler.jsonc`; keep environment-specific hostnames out of reusable forks unless that is intended.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Build the client and start the local Worker |
| `bun run client:dev` | Start Vite with API and WebSocket proxying |
| `bun run build` | Build production client assets |
| `bun run test` | Build and run the Workers Vitest suite |
| `bun run typecheck` | Run strict TypeScript checks |
| `bun run lint` | Run Biome checks |
| `bun run format` | Apply Biome formatting and safe fixes |
| `bun run deploy` | Build and deploy with Wrangler |
| `bun run logs` | Tail production Worker logs |
| `bun run cf-typegen` | Regenerate Cloudflare runtime types |
| `bun run smoke:ws` | Exercise a running Worker with multiple WebSocket clients |

See [AGENTS.md](AGENTS.md) for repository conventions and [STATUS.md](STATUS.md) for current verified
project status.

## License

Tetra Colors is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
