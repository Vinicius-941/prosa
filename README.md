# Prosa

Prosa is an independent communication app focused on clear, welcoming conversations. This repository contains a responsive client and a local API foundation.

## Current status

The client supports account creation, sign-in, sign-out, a personal conversation, and sending and reading persisted messages. The API stores accounts, sessions, conversations, and messages in SQLite. Passwords use Argon2id and bearer session values are stored as SHA-256 digests.

This is an early, single-user development foundation. Email verification, account recovery, multi-factor authentication, friend discovery, conversations between separate accounts, multi-device synchronization, real-time delivery, attachments, moderation, voice/video, and platform installers are not implemented. Do not expose this local service to the public internet or use it for production accounts.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the detailed feature matrix and remaining work.

## Requirements

- Node.js 22.12 or later
- npm

## Run locally

```sh
npm install
npm run dev
```

The client runs at `http://localhost:5173`; the API runs at `http://localhost:8787`. SQLite data is stored under `data/`. Set `PROSA_DATA_DIR` or `PORT` to change the API data location or port. Set `CLIENT_ORIGIN` to a comma-separated list of allowed browser origins when developing with another client origin.

Create a client production build with `npm run build`. Start the API separately with `npm run api:start`.

## License

MIT. See [LICENSE](LICENSE).
