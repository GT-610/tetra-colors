# Project Status

## Current phase

Phase 3 — Frontend lobby (in progress)

## Completed

- Confirmed current Wrangler and Durable Object configuration behavior.
- Added the TypeScript, Vite, React, Tailwind, Workers, Vitest, and Biome project structure.
- Added initial Worker health and Durable Object endpoints.
- Added the project constitution and command reference.
- Passed strict type checking, Biome linting, a production Vite build, and 2 Workers integration
  tests using the current Cloudflare Vitest plugin.
- Deployed the Worker, assets, RoomDO binding, and SQLite migration to
  `https://tetra-colors.myddz1005.workers.dev`.
- Verified the deployed desktop and 390 × 844 mobile layouts with no browser warnings or errors.
- Verified the deployed health and RoomDO endpoints from the real host network.
- Defined the shared client/server protocol, room snapshots, events, error codes, and input parsing.
- Implemented a deterministic 108-card rules core with injected randomness and no external runtime
  dependencies.
- Implemented matching, draw/play/pass flow, skip, reverse, draw penalties, color choice, draw-four
  restrictions, discard recycling, winner detection, and three bot decision policies.
- Passed 18 tests across 4 files, including 100 property runs and 120 mixed-difficulty bot games
  with state validation on every action.
- Implemented the RoomDO lifecycle for creation, joining, reconnect validation, lobby management,
  personalized snapshots, gameplay actions, rematches, and leaving.
- Added Hibernation WebSockets with per-connection attachments, hashed reconnect tokens, action and
  HTTP rate limits, 30-second turn/reconnect handling, alarm-driven bots, and idle room deletion.
- Added Worker HTTP/WebSocket routing, unambiguous five-character room codes, request size checks,
  and static asset security headers.
- Passed 21 tests across 5 files, including real Durable Object instances, multiple WebSockets,
  capacity, permissions, reconnection, rate limiting, and cross-player hidden-card checks.
- Passed the independent local Wrangler WebSocket smoke test with two clients and three seats.

## Remaining

- Build the mobile-first nickname, create/join, and lobby flows.
- Add host controls for bot difficulty, removal, and starting a round.
- Verify create, multi-tab join, and start through the browser.
- Continue with Phases 4–6 from `.vscode/init-prompt.md`.

## Known issues

- None currently.
