# Prosa

Prosa is an independent communication app focused on clear, welcoming conversations. This repository contains a responsive client and a local API foundation.

## Current status

The client supports account creation, sign-in, sign-out, user discovery, connection requests, direct conversations between connected accounts, and persisted messages delivered over an authenticated live connection. The API stores accounts, sessions, connections, conversations, and messages in SQLite. Passwords use Argon2id and bearer session values are stored as SHA-256 digests.

This is an early development foundation. Email verification, account recovery, multi-factor authentication, multi-device synchronization, read receipts, attachments, moderation, voice/video, and platform installers are not implemented. Do not expose this local service to the public internet or use it for production accounts.

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

Run the account, connection-request, access-control, message-persistence, and live-delivery integration check with `npm test`.

## License

MIT. See [LICENSE](LICENSE).
