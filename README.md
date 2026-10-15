# Prosa

Prosa is an independent communication app focused on clear, welcoming conversations. This repository contains the first desktop and web client foundation.

## Current status

The initial client includes a responsive messaging workspace, conversation switching, search and filters, and local message composition. Conversation examples are seeded interface content; messages sent in this first version stay in the current browser session. Accounts, persistent storage, synchronization, file uploads, voice/video, and moderation require backend services and are not implemented yet.

See [docs/ROADMAP.md](docs/ROADMAP.md) for milestones and the feature status matrix.

## Run locally

Requirements: Node.js 22.12+.

```sh
npm install
npm run dev
```

Create a production client build with `npm run build`.

## License

MIT. See [LICENSE](LICENSE).
