# Tetra Colors Project Constitution

## Product boundaries

- Tetra Colors is an original, open-source, self-hosted browser card game.
- Never mention competitors or commercial game trademarks in code, UI, documentation, or commits.
- Use original copy and CSS geometry only. Do not add external images, fonts, or generated art.
- Do not add accounts, analytics, tracking, or persisted player identity. Secrets belong in environment
  variables only.
- Keep the root AGPLv3 license intact.

## Architecture

- `src/logic/`: deterministic pure game rules with injected randomness and no runtime dependencies.
- `src/protocol.ts`: the single shared client/server message contract.
- `src/room-do.ts`: authoritative room actor, validation, timers, bots, and per-player snapshots.
- `src/worker.ts`: static assets, HTTP API, and WebSocket routing.
- `client/`: mobile-first React client that submits intents and renders server snapshots.
- One room code maps to one Durable Object instance.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Build the client and start the local Worker |
| `bun run client:dev` | Start the Vite client with API/WebSocket proxying |
| `bun run build` | Build production client assets |
| `bun run test` | Build and run the Workers Vitest suite |
| `bun run typecheck` | Run strict TypeScript checks |
| `bun run lint` | Run Biome checks |
| `bun run format` | Apply Biome formatting and safe fixes |
| `bun run deploy` | Build and deploy with Wrangler |
| `bun run logs` | Tail production Worker logs |

## Engineering rules

- Server state is authoritative. Treat every client payload as untrusted input.
- Never expose hidden cards in another player's snapshot.
- All rule functions are deterministic and receive RNG explicitly.
- Use unambiguous room codes, event-driven WebSockets, basic rate limits, and no polling.
- Centralize Simplified Chinese copy for later internationalization.
- Add tests with each behavior change. Before commits, run typecheck, lint, tests, and
  `git diff --check`.
- Use Conventional Commits in English. Do not rewrite pushed history.
- Update `STATUS.md` after each verified phase.
