# Project Status

## Current phase

Phase 5 — Bots (in progress)

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
- Added centralized Simplified Chinese copy, per-tab session restoration, heartbeat and bounded
  WebSocket reconnection, API loading/error states, and client intent dispatch.
- Built the original mobile-first entry and lobby UI with four color/shape identities, responsive
  desktop layout, room code, player seats, connection state, and host bot controls.
- Deployed Phase 3 and verified create → second-tab join → add hard bot → start with two live browser
  tabs. Both tabs reached the same three-player game state and had no console warnings or errors.
- Verified a 390-pixel mobile lobby and a 1280 × 720 desktop entry layout through the browser.
- Built the complete game table with private hands, playable-card states, draw/discard piles,
  accessible color identities, wild-color selection, turn timing, event feedback, reconnect UX,
  action loading/error states, results, and host rematches.
- Deployed Phase 4 and completed a live two-tab game in room `U5MYG`. Both clients reached the
  same result (山雀 0 cards, 雨燕 7 cards), exposed the correct host/guest rematch controls, and
  produced no browser console warnings or errors.
- Captured the deployed result UI at mobile and desktop sizes in
  `/private/tmp/tetra-colors-phase4-result-host.png` and
  `/private/tmp/tetra-colors-phase4-result-guest.png`.

## Remaining

- Verify easy, standard, and hard bots through the production room action pipeline.
- Complete a browser game with one human and multiple bots.
- Continue with Phase 6 from `.vscode/init-prompt.md`.

## Known issues

- None currently.
