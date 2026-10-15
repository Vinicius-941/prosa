# Prosa delivery status

A feature is marked implemented only when the behavior exists in the application and has been checked against its stated scope.

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Responsive conversation workspace | Implemented | React client with desktop and narrow-screen layouts |
| Account creation and sign-in | Implemented (local foundation) | API uses Argon2id password hashes; needs email verification, recovery, MFA, and security review |
| Session creation and revocation | Implemented (early) | Random bearer value, digest stored in SQLite, 30-day expiry, per-device labels, last-use timestamps, active-session listing, remote revocation, password changes and automatic revocation of other sessions; email recovery, MFA, broader device security and CSRF/origin review remain |
| Conversation listing | Implemented | Shows the personal space and accepted direct conversations |
| User discovery | Implemented (username search) | Authenticated prefix search, result limit, and search rate limit |
| Connection requests | Implemented | Requests can be sent, accepted, dismissed, and removed; requests are rate-limited |
| Direct conversations between connected accounts | Implemented (early) | A private, shared conversation is created on acceptance; removing a connection hides and revokes access to it |
| Persistent message create and history | Implemented | Messages are stored in SQLite, restricted to authorized participants, fetched with stable cursor pagination, support same-conversation replies, curated emoji reactions, and pinning, and can be edited or removed by their author |
| Pinned messages | Implemented (early) | Authorized members can pin and unpin messages, view the latest 100 pins, navigate to a pinned message, and see changes live; deleting a message clears its pin |
| Notification controls | Implemented (early) | Live notification events are emitted for other conversation members; each account can mute a conversation for one hour, eight hours, one day, or seven days; platform push delivery and notification preferences remain |
| Real-time message delivery | Implemented (early) | Authenticated Socket.IO session and conversation membership; new, edited, removed, reacted, and pinned messages sync live; reconnect supported; offline messages and reply context remain available in paginated history |
| Per-user read states | Implemented (early) | Read position is persisted per account; conversation list provides unread counts |
| Conversation search | Implemented (early) | Authenticated, rate-limited message search covers only conversations the account can still access; selecting a match opens its message context |
| Communities and text channels | Implemented (early) | Invite-code entry, owner/member access, owner-only channel creation, persisted channel messages; admin controls, leaving communities, moderation, and broader role management remain |
| Attachments and media storage | Not implemented | Safe upload validation, limits, scanning policy, and object storage required |
| Voice, video, and screen sharing | Not implemented | Evaluate WebRTC/SFU architecture and platform support |
| Desktop app shell | Implemented (early) | Electron starts the local API, binds it to loopback, and keeps account data in the user's application-data folder; verify packaged app launch and upgrades |
| Windows installers | Implemented (early) | NSIS installer build is wired into Windows CI and tagged releases; signing and clean-machine install/upgrade checks remain |
| Linux packages | Implemented (early) | AppImage and Debian targets are wired into Linux tagged releases; clean-machine launch and upgrade checks remain |
| Android client | Implemented (early) | Capacitor Android application with touch-sized bottom navigation, conversation picker, secure API endpoint setup, Android 8+ minimum, and CI debug APK build; requires a deployed HTTPS API, signed release APK/AAB, native secure session storage, notifications, and device validation |
| Service operations foundation | Implemented (early) | Production origin validation, health endpoint checks SQLite, graceful process shutdown, Docker image, persistent Compose volume, Caddy HTTPS proxy, and CI container health check; operator-provided host, off-server backups/restore drills, monitoring, multi-instance design, and security review remain |
| Security and privacy review | In progress | Baseline password hashing, password updates, per-device revocation, rate-limited auth endpoints, security headers, input limits, authenticated JSON export, and password-confirmed account erasure with community ownership transfer; comprehensive threat model, retention controls, independent review, and legal review remain |
| Performance benchmarks | In progress | Reproducible local API write workload reports startup time, throughput and p50/p95/p99 latency, checks persisted history, and records a Windows run in `benchmarks/results/`; desktop idle memory, mobile battery, media and cross-product comparisons remain |
| CI checks | Implemented | `.github/workflows/ci.yml` runs integration checks, lint, client/service builds, and unpacked desktop packaging on Windows and Linux |
| Release artifacts | Implemented (early) | `.github/workflows/release.yml` packages Windows NSIS, Linux AppImage, and Debian assets for version tags; signing, checksums, provenance, and a first end-to-end release remain |

## Milestones

1. Client foundation, accounts, connections, and local real-time messaging. **In progress.**
2. Multi-account identity hardening, message operations, and deployment-ready storage.
3. Communities, files, and moderation.
4. Voice/video and adapted Android client; validate desktop and Linux packages.
5. Security review, automated platform builds, benchmarks, and release process.

The desktop SQLite service remains local to each installation. The repository includes a reproducible single-server deployment configuration, but no public hosting environment has been provisioned. Current scope and limitations must remain visible in user-facing documentation.
