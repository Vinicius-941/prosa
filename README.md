# Prosa

Prosa is an independent communication app focused on clear, welcoming conversations. This repository contains a responsive client and a local API foundation.

## Current status

The client supports account creation, sign-in, sign-out, user discovery, connection requests, direct conversations between connected accounts, authenticated message search, and persisted messages delivered over a live connection. The API stores accounts, sessions, connections, conversations, and messages in SQLite. Passwords use Argon2id and bearer session values are stored as SHA-256 digests.

This is an early development foundation. Email verification, account recovery, multi-factor authentication, multi-device synchronization, attachments, moderation, voice/video, and Android are not implemented. Do not expose this local service to the public internet or use it for production accounts.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the detailed feature matrix and remaining work.

## Requirements

- Node.js 22.12 or later
- npm

## Desktop app

Build and open the desktop app with `npm run desktop:dev`. The desktop shell starts the API on a random local port, binds it to this device, and stores SQLite data in the operating system's Prosa application-data folder. Browser development continues to use `npm run dev` and `data/`.

Create an unpacked desktop build for the current system with `npm run package:desktop`. GitHub Actions checks the Windows and Linux packages on every update. A version tag (`v*`) builds the Windows installer, Linux AppImage, and Debian package and attaches them to a GitHub release. Release installers are currently unsigned and may show an operating-system publisher warning.

## Run locally

```sh
npm install
npm run dev
```

The client runs at `http://localhost:5173`; the API runs at `http://localhost:8787`. SQLite data is stored under `data/`. Set `PROSA_DATA_DIR`, `PORT`, or `HOST` to change the API data location, port, or listen address. The service binds to this device by default; set `CLIENT_ORIGIN` to a comma-separated list of allowed browser origins when developing with another client origin.

Create a client production build with `npm run build`. Start the API separately with `npm run api:start`.

Run the account, connection-request, access-control, message-persistence, and live-delivery integration check with `npm test`.

## License

MIT. See [LICENSE](LICENSE).
