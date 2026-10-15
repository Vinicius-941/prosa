# Prosa delivery status

A feature is marked implemented only when the behavior exists in the application and has been checked against its stated scope.

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Responsive conversation workspace | Implemented | React client with desktop and narrow-screen layouts |
| Account creation and sign-in | Implemented (local foundation) | API uses Argon2id password hashes; needs email verification, recovery, MFA, and security review |
| Session creation and revocation | Implemented (local foundation) | Random bearer value, digest stored in SQLite, 30-day expiry, logout endpoint; add device/session management and CSRF/origin review |
| Conversation listing | Implemented (personal conversation only) | Each new account receives a private starter conversation; no cross-account discovery yet |
| Persistent message create and history | Implemented (personal conversation only) | API writes messages into SQLite; HTTP validation confirmed a sent message is returned from history |
| Search and unread states | Not implemented | Search currently needs server-backed records and unread state model |
| Friends and multi-account private conversations | Not implemented | Relationship model, authorization, invitation flow, and integration coverage required |
| Real-time message delivery | Not implemented | Add authenticated event transport, reconnect/resume, and delivery state |
| Communities, channels, roles, moderation | Not implemented | Data model and server-side authorization required |
| Attachments and media storage | Not implemented | Safe upload validation, limits, scanning policy, and object storage required |
| Voice, video, and screen sharing | Not implemented | Evaluate WebRTC/SFU architecture and platform support |
| Desktop installers | Not implemented | Select packaging/runtime and validate signed Windows build |
| Linux packages | Not implemented | Add Linux CI builds and validate artifacts |
| Android client | Not implemented | Design and implement an adapted mobile experience |
| Security and privacy review | In progress | Baseline password hashing, rate-limited auth endpoints, security headers, input limits; comprehensive threat model, transport deployment, data controls and independent review remain |
| Performance benchmarks | Not implemented | Define reproducible workloads and measure actual desktop, server, and mobile builds |
| CI and release artifacts | Not implemented | Add build matrix, dependency review, checksums, and release instructions |

## Milestones

1. Client foundation and local account/message persistence. **In progress.**
2. Multi-account identity, relationships, and authenticated real-time messaging.
3. Communities, files, and moderation.
4. Voice/video and adapted desktop, Linux, and Android clients.
5. Security review, automated platform builds, benchmarks, and release process.

The local SQLite service is for development and is not configured for production hosting. Current scope and limitations must remain visible in user-facing documentation.
