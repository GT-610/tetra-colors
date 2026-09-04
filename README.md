# Tetra Colors

Tetra Colors is an original, open-source, self-hosted multiplayer browser card game. Match the
active color or number, use neutral action cards to change the flow of play, and empty your hand
first.

The project is under active development. It uses TypeScript, Bun, React, Vite, Tailwind CSS,
Cloudflare Workers, and one Durable Object room actor per game.

## Development

```sh
bun install
bun run dev
```

Quality checks:

```sh
bun run typecheck
bun run lint
bun run test
```

See `AGENTS.md` for architecture and repository conventions and `STATUS.md` for current progress.

## License

Tetra Colors is licensed under AGPL-3.0. See `LICENSE`.
