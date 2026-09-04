# Project Status

## Current phase

Post-delivery optimization — Batch 3 of 4 completed

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
- Verified easy, standard, and hard bots together in production room `MZX7G`. A single human and
  all three bot difficulties completed the full game through the normal server action pipeline;
  the result was 0 / 15 / 14 / 14 cards and the browser console remained clean.
- Added a short `scheduler.wait()` wake path for connected games while retaining Durable Object
  alarms as the persistent fallback. The production hard-bot state change measured 2.213 seconds
  including network and rendering, down from the previously observed alarm-tail delay.
- Re-ran a complete production human-versus-bot game after the scheduling fix, including draws,
  action cards, repeated bot turns, and three wild-color choices, with no duplicate actions or
  console errors.
- Deployed the bot scheduling fix as Cloudflare version
  `8ce96e1a-5a0f-46d7-b0c8-4693602d3a7f`.
- Expanded the public README with gameplay, architecture, privacy and security behavior, local
  development, verification, and fork-to-Cloudflare deployment instructions.
- Completed the workers.dev production regression in room `MDND8` with three independent human
  browser tabs. All clients completed the game and agreed on the result (雨燕 0 cards, 山雀 4
  cards, 云雀 9 cards), including a stale-tab refresh and token-based seat recovery.
- Confirmed empty browser console logs on all three clients and captured the final mobile and desktop
  results in `/private/tmp/tetra-colors-phase6-three-player-host.png` and
  `/private/tmp/tetra-colors-phase6-three-player-desktop.png`.
- Audited the locked dependency graph against the official npm advisory service with no reported
  vulnerabilities.
- Found that cache-served static assets bypass Worker-generated headers, added the official Static
  Assets `_headers` file, and verified CSP, permissions, referrer, framing, and MIME-sniffing headers
  on the live homepage.
- Deployed the hardened production build as Cloudflare version
  `8980becc-a56b-4ae0-8adf-4d7cb24441cc`, then reloaded all three game clients with identical
  results and no browser console errors.
- Expanded the Workers integration suite to cover hibernation wake-up, forced turn timeout,
  reconnect-grace conversion, a complete alarm-driven bot game, token-based seat recovery,
  rematches, and idle room deletion. All 24 tests pass, and the full lifecycle case passed three
  consecutive focused runs.
- Fixed the alarm fallback so a no-op reconnect expiry pass no longer postpones the scheduled bot
  action. Re-ran the independent local Wrangler smoke test with two WebSockets, three seats, and
  hidden-hand verification.
- Deployed the audited server as Cloudflare version `90fbd504-11d6-4505-93e5-a15dcca9e903`.
- Verified the production alarm fallback in room `F8859`: while the only human was offline, the bot
  legally played from 9 to 8 cards and advanced the game before the same tab reclaimed its seat.
- Repeated the full three-human production game on the final version in room `TRY52`. All clients
  agreed on 白鹭 0 cards, 赤隼 3 cards, and 青鸟 4 cards, with no console errors. Final screenshots
  are `/private/tmp/tetra-colors-final-workers-host.png` and
  `/private/tmp/tetra-colors-final-workers-desktop.png`.
- Refreshed room activity on abrupt disconnects so the 30-second reconnect grace cannot be bypassed
  by an older idle timestamp; the lifecycle regression now explicitly covers this ordering.
- Removed the remaining unused Phase 3 placeholder copy and CSS after a source-to-style reference
  audit found no other obsolete client selectors.
- Deployed the final workers.dev candidate as Cloudflare version
  `4747b923-bc52-49c0-9519-2b1478363065`. The health endpoint, cached asset security headers, and all
  three `TRY52` sessions passed post-deploy reload checks with empty browser consoles.
- Completed the current delivery scope on workers.dev after the project owner chose to defer custom
  domain binding and handle it separately later.
- Audited production, client, protocol, test, dependency, and style usage on the synchronized `main`
  baseline. Strict unused checks and CSS reference checks passed, and the official npm advisory
  service reported no vulnerabilities.
- Removed unused request types, persisted round metadata, public game configuration, event fields,
  the test-only production state validator and deck-size export, and the unconsumed WebSocket welcome
  message. State invariant validation now lives in the test suite, heartbeats no longer send full
  snapshots, and new connections no longer receive duplicate snapshots. Type checking, linting, all
  24 tests, and whitespace validation pass after the cleanup.
- Applied draw penalties before declaring a winner, rejected color choices attached to non-wild
  cards, and transferred host control to a connected human when the prior host leaves or becomes
  bot-controlled. Focused rule and real Durable Object regressions increased the suite to 27 passing
  tests.
- Moved WebSocket tokens out of request URLs and into the negotiated subprotocol, centralized room
  code and token validation, required JSON media types, and replaced whole-body reads with a strict
  streaming byte limit. Replaced the unbounded HTTP rate-limit map with a constant-time bounded
  limiter. Six test files now contain 32 passing tests, including handshake, malformed/oversized
  body, protocol, limiter-window, and limiter-capacity coverage.

## Remaining

- Reduce client game-table rerenders and strengthen stored-session validation.
- Run final quality gates and live WebSocket smoke testing, then publish the pull request.

## Known issues

- A custom domain is intentionally not configured; the project owner will bind it later.
