# Prosa

Prosa is an independent communication app focused on clear, welcoming conversations. This repository contains a responsive client and a local API foundation.

## Current status

The client supports account creation, sign-in, per-device active-session listing and revocation, password changes that disconnect other sessions, JSON data export, password-confirmed account deletion, user discovery, connection requests, direct conversations between connected accounts, invite-based communities and text channels, community owner/admin/member controls, authenticated message search, replies, emoji reactions, pinned messages, per-conversation notification controls, and early one-to-one audio calls. Messages, reactions, and pins persist in SQLite and sync over a live connection. Notification events are sent in real time and can be muted per account for up to seven days. Passwords use Argon2id and bearer session values are stored as SHA-256 digests.

This is an early development foundation. Email verification, account recovery, multi-factor authentication, shared multi-device synchronization, attachments, moderation, and group calls are not implemented. Direct calls support audio, video, and screen sharing on browsers and desktop systems with WebRTC display capture. The deployment includes a TURN relay for restrictive networks; Android screen sharing depends on platform support and remains unavailable in the current client. Calls still need testing on physical devices and different networks.

Electron stores its session token with the operating system's secure-storage facility. Linux requires an available system keyring. Android encrypts the session token with an AES-GCM key held by Android Keystore and migrates the previous web-storage copy after it can read the protected vault. Browser sessions use HttpOnly cookies and CSRF checks; production deployments should serve the client and API from the same site or through a shared-domain proxy because browsers may block third-party cookies.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the detailed feature matrix and remaining work.

## Android preview

The Android client is an installable Capacitor application that uses the same Prosa client and connects to an independently hosted Prosa API. On first launch, enter the API's HTTPS base address. Configure that service's `CLIENT_ORIGIN` to allow `https://localhost`, the Android WebView origin. Android source is in `android/`; build the web assets and sync them with `npm run android:sync`, then run the Gradle `assembleDebug` task from that directory with JDK 21. The CI workflow builds a debug APK for each change. A public API is not hosted by this repository; signed release APK/AAB and push notifications are not configured. Session tokens use an Android Keystore backed AES-GCM vault; physical-device validation remains required.

## Requirements

- Node.js 22.12 or later
- npm

## Desktop app

Build and open the desktop app with `npm run desktop:dev`. The desktop shell starts the API on a random local port, binds it to this device, and stores SQLite data in the operating system's Prosa application-data folder. This is a single-device local account store. Browser development continues to use `npm run dev` and `data/`.

Create an unpacked desktop build for the current system with `npm run package:desktop`. GitHub Actions checks the Windows and Linux packages on every update. A version tag (`v*`) builds the Windows installer, Linux AppImage and Debian package, and an Android debug preview APK, then attaches them to a GitHub release. The Android APK is unsigned and intended only for preview; release installers are also unsigned and may show an operating-system publisher warning.

## Run locally

```sh
npm install
npm run dev
```

The client runs at `http://localhost:5173`; the API runs at `http://localhost:8787`. SQLite data is stored under `data/`. Set `PROSA_DATA_DIR`, `PORT`, or `HOST` to change the API data location, port, or listen address. The service binds to this device by default; set `CLIENT_ORIGIN` to a comma-separated list of allowed browser origins when developing with another client origin.

The client uses system fonts and does not need a remote font service. Run `npm run test:e2e` to check signup, conversation flows, keyboard navigation, responsive layouts, connection status, and automated accessibility rules in Chromium. The test starts an isolated API and uses a temporary database.

Create a client and service production build with `npm run build:desktop`. Start the API separately with `npm run api:start` during development.

## Public service deployment

A production start command is available with `npm run api:start:prod` after `npm run build:service`. The Docker Compose stack serves the web app and API on the same HTTPS domain, and runs Caddy for certificates plus Coturn for media relay. Set `PROSA_DOMAIN`, `CLIENT_ORIGIN`, `TURN_URL`, `TURN_EXTERNAL_IP`, and a private `TURN_SHARED_SECRET` in `.env.production`; use an absolute persistent `PROSA_DATA_DIR`. Production startup rejects a missing or wildcard client origin. The API handles `SIGINT` and `SIGTERM` by stopping new connections before closing the database. `GET /api/health` checks the database connection and returns 503 when it is unavailable.

`deploy/compose.yaml` provides a single-server Docker deployment with persistent SQLite storage, Caddy-managed HTTPS, a static web client, and time-limited TURN credentials for Coturn. Follow [docs/deployment.md](docs/deployment.md) to set the domain, public IP, firewall, and allowed origins before starting it. This repository does not provision or operate the server; the operator must provide the machine, DNS, network access, off-server backups, and restore checks. The SQLite deployment supports one API instance.

Run the account, connection-request, access-control, message-persistence, and live-delivery integration check with `npm test`.

Latest published release: **0.1.3**. Version 1.4.0 is being prepared with one-to-one calls and public-server deployment; see [deployment instructions](docs/deployment.md).

Account export and deletion behavior is described in [docs/account-data.md](docs/account-data.md).

Run a reproducible local API write benchmark with `npm run benchmark:service -- --messages=300 --concurrency=10`. Methodology and measurement limits are described in [benchmarks/README.md](benchmarks/README.md); each run prints its actual measurements as JSON.

## License

MIT. See [LICENSE](LICENSE).
