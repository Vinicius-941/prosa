# Prosa delivery status

A feature is marked implemented only when the behavior exists in the application and has been checked against its stated scope.

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Responsive conversation workspace | Implemented | React client with desktop and narrow-screen layouts |
| Account creation and sign-in | Implemented (local foundation) | API uses Argon2id password hashes; needs email verification, recovery, MFA, and security review |
| Session creation and revocation | Implemented (local foundation) | Random bearer value, digest stored in SQLite, 30-day expiry, logout endpoint; add device/session management and CSRF/origin review |
| Conversation listing | Implemented | Shows the personal space and accepted direct conversations |
| User discovery | Implemented (username search) | Authenticated prefix search, result limit, and search rate limit |
| Connection requests | Implemented | Requests can be sent, accepted, dismissed, and removed; requests are rate-limited |
| Direct conversations between connected accounts | Implemented (early) | A private, shared conversation is created on acceptance; removing a connection hides and revokes access to it |
| Persistent message create and history | Implemented | Messages are stored in SQLite and limited to authorized conversation participants |
| Real-time message delivery | Implemented (early) | Authenticated Socket.IO session and conversation membership; reconnect supported; no delivery receipts or offline queue yet |
| Conversation search and unread states | Not implemented | Add server-backed message search and persisted per-user read state |
| Communities, channels, roles, moderation | Not implemented | Data model and server-side authorization required |
| Attachments and media storage | Not implemented | Safe upload validation, limits, scanning policy, and object storage required |
| Voice, video, and screen sharing | Not implemented | Evaluate WebRTC/SFU architecture and platform support |
| Desktop installers | Not implemented | Select packaging/runtime and validate signed Windows build |
| Linux packages | Not implemented | Add Linux CI builds and validate artifacts |
| Android client | Not implemented | Design and implement an adapted mobile experience |
| Security and privacy review | In progress | Baseline password hashing, rate-limited auth endpoints, security headers, input limits; comprehensive threat model, transport deployment, data controls and independent review remain |
| Performance benchmarks | Not implemented | Define reproducible workloads and measure actual desktop, server, and mobile builds |
| CI checks | Implemented and passing | `.github/workflows/ci.yml` runs integration checks, lint, and client builds; GitHub Actions passed on Windows Server 2022 and Ubuntu for commit `dd8e9ea` |
| Release artifacts | Not implemented | Add signed installers, checksums, and release instructions |

## Milestones

1. Client foundation, accounts, connections, and local real-time messaging. **In progress.**
2. Multi-account identity hardening, read states, message operations, and deployment-ready storage.
3. Communities, files, and moderation.
4. Voice/video and adapted desktop, Linux, and Android clients.
5. Security review, automated platform builds, benchmarks, and release process.

The local SQLite service is for development and is not configured for production hosting. Current scope and limitations must remain visible in user-facing documentation.
