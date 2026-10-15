# Prosa

Prosa is an independent communication app focused on clear, welcoming conversations. This repository contains a responsive client and a local API foundation.

## Current status

The client supports account creation, sign-in, per-device active-session listing and revocation, password changes that disconnect other sessions, JSON data export, password-confirmed account deletion, user discovery, connection requests, direct conversations between connected accounts, invite-based communities and text channels, authenticated message search, replies, and emoji reactions. Messages and reactions persist in SQLite and sync over a live connection. Passwords use Argon2id and bearer session values are stored as SHA-256 digests.

This is an early development foundation. Email verification, account recovery, multi-factor authentication, shared multi-device synchronization, attachments, moderation, and voice/video are not implemented. Android is available as a debug preview and requires a separately hosted API.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the detailed feature matrix and remaining work.

## Android preview

The Android client is an installable Capacitor application that uses the same Prosa client and connects to an independently hosted Prosa API. On first launch, enter the API's HTTPS base address. Configure that service's `CLIENT_ORIGIN` to allow `https://localhost`, the Android WebView origin. Android source is in `android/`; build the web assets and sync them with `npm run android:sync`, then run the Gradle `assembleDebug` task from that directory. The CI workflow builds a debug APK for each change. A public API is not hosted by this repository; signed release APK/AAB, push notifications, and device-level session credential storage are not yet configured.

## Requirements

- Node.js 22.12 or later
- npm

## Desktop app

Build and open the desktop app with `npm run desktop:dev`. The desktop shell starts the API on a random local port, binds it to this device, and stores SQLite data in the operating system's Prosa application-data folder. This is a single-device local account store. Browser development continues to use `npm run dev` and `data/`.

Create an unpacked desktop build for the current system with `npm run package:desktop`. GitHub Actions checks the Windows and Linux packages on every update. A version tag (`v*`) builds the Windows installer, Linux AppImage, and Debian package and attaches them to a GitHub release. Release installers are currently unsigned and may show an operating-system publisher warning.

## Run locally

```sh
npm install
npm run dev
```

The client runs at `http://localhost:5173`; the API runs at `http://localhost:8787`. SQLite data is stored under `data/`. Set `PROSA_DATA_DIR`, `PORT`, or `HOST` to change the API data location, port, or listen address. The service binds to this device by default; set `CLIENT_ORIGIN` to a comma-separated list of allowed browser origins when developing with another client origin.

Create a client and service production build with `npm run build:desktop`. Start the API separately with `npm run api:start` during development.

## Service deployment

A production start command is available with `npm run api:start:prod` after `npm run build:service`. Copy `.env.example` to `.env` and set `NODE_ENV=production`, a persistent absolute `PROSA_DATA_DIR`, a valid `PORT`, and `CLIENT_ORIGIN` to the exact browser origins that should be accepted. Production startup rejects a missing or wildcard origin configuration, and `HOST` defaults to the local-only address unless explicitly set by the deployment environment. The API handles `SIGINT` and `SIGTERM` by stopping new connections before closing the database. `GET /api/health` checks the database connection and returns 503 when it is unavailable.

`deploy/compose.yaml` provides a single-server Docker deployment with persistent SQLite storage and Caddy-managed HTTPS. Follow [docs/deployment.md](docs/deployment.md) to set a domain and allowed origins before starting it. This repository does not provision or operate the server; the operator must configure DNS, network access, off-server backups, and restore checks. The SQLite deployment supports one API instance.

Run the account, connection-request, access-control, message-persistence, and live-delivery integration check with `npm test`.

Account export and deletion behavior is described in [docs/account-data.md](docs/account-data.md).

Run a reproducible local API write benchmark with `npm run benchmark:service -- --messages=300 --concurrency=10`. Methodology and measurement limits are described in [benchmarks/README.md](benchmarks/README.md); each run prints its actual measurements as JSON.

## License

MIT. See [LICENSE](LICENSE).
