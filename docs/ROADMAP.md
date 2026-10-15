# Prosa roadmap

This is a working status record. A feature is only marked complete when its real behavior has been implemented and verified.

| Area | Status | Evidence / next step |
| --- | --- | --- |
| Responsive conversation workspace | Implemented (client foundation) | React client build; responsive rail, conversation list, and chat view |
| Conversation search and unread filter | Implemented (client foundation) | Filters seeded conversations in the current client |
| Message composition | Local only | Appends to in-memory client state; implement API and persistent storage |
| Accounts and identity | Not implemented | Design secure account and session services |
| Friend requests and private groups | Not implemented | Define identity and relationship model |
| Persistent real-time messaging | Not implemented | Backend, database, authorization, and live event delivery required |
| Communities, channels, roles, moderation | Not implemented | Define data model and server-side permissions |
| Attachments and media storage | Not implemented | Add validated uploads and object storage |
| Voice, video, and screen sharing | Not implemented | Evaluate WebRTC/SFU architecture and platform support |
| Desktop installers | Not implemented | Select packaging/runtime and set up Windows build |
| Linux packages | Not implemented | Add Linux CI builds and validate artifacts |
| Android client | Not implemented | Assess native/mobile requirements and implement adapted client |
| Security and privacy | Not implemented | Threat model, secure authentication, privacy controls, and review |
| Performance benchmarks | Not implemented | Establish reproducible workloads and measure real builds |

## Milestones

1. Client foundation and product decisions.
2. Accounts, identity, persistent messaging, and a real-time backend.
3. Communities, files, and moderation.
4. Voice/video and adapted mobile clients.
5. Security review, platform packaging, CI, benchmarks, and release process.

No release readiness or feature parity is implied by the current interface foundation.
