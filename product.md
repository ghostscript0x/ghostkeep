# GhostKeep — Product Requirements Document (MVP)

**Document:** `product.md`  
**Version:** 1.0  
**Status:** MVP scope  
**Product type:** Multi-tenant WhatsApp anti-delete SaaS  
**Working tagline:** Deleted doesn't have to mean gone.

---

## 1. Product Summary

GhostKeep lets a user create an account, link a WhatsApp account, and receive a WhatsApp notification in the configured GhostKeep bot chat when a supported message deletion is detected. The notification includes the content GhostKeep captured before deletion, when available.

GhostKeep is privacy-first by design:

- Ordinary messages are processed temporarily and are **not written to persistent message storage**.
- Only messages matched to a supported deletion event are retained as recovery records.
- Recovery content is encrypted in persistent storage.
- Platform administrators must not have a dashboard or routine support tool that reveals recovered message content.
- Each customer's account, WhatsApp session, recovery records, and destination settings are isolated from every other customer.

### Important privacy limitation

The requested automatic forwarding experience requires a worker to access message plaintext temporarily so it can send the recovered content through WhatsApp. Because that worker runs on infrastructure operated by the service, the MVP cannot honestly guarantee that the operator is technically incapable of accessing plaintext during processing. Encryption at rest and hiding content from the admin dashboard do not by themselves provide end-to-end or zero-knowledge privacy. The product must document this limitation accurately.

---

## 2. Problem

People sometimes receive WhatsApp messages that are later deleted by the sender. They may want a simple way to see the content that was captured before deletion without searching through a separate web dashboard.

Existing anti-delete scripts can be difficult to install, keep running, and configure. GhostKeep packages account creation, WhatsApp linking, deletion detection, and recovery notifications into one minimal service.

## 3. Target Users

- Individuals who want deletion alerts for their own linked WhatsApp account.
- Early adopters comfortable linking a WhatsApp Web companion session to an unofficial integration.

The MVP is not designed for enterprise compliance, team collaboration, or monitoring other people's accounts without authorization.

## 4. Product Goals

1. A user can register and log in.
2. A user can link one WhatsApp account by scanning a QR code.
3. The system temporarily processes incoming messages but does not persist ordinary chat content.
4. The system detects supported message-revocation events and matches them to the corresponding temporary message copy.
5. The system forwards the recovered content to the user's configured, verified GhostKeep bot chat / recovery destination.
6. The user can see connection status and a minimal history of deletion events without exposing message content to platform administrators.
7. Tenant data and linked sessions are isolated and protected.

## 5. Non-Goals for the MVP

Do not build these in version one:

- Media recovery for photos, videos, audio, voice notes, and documents.
- Multiple WhatsApp sessions per user.
- Teams, organizations, or role-based customer accounts.
- AI features, analytics, message search, or chat-history import.
- Native mobile applications.
- Complex billing, coupons, or affiliate systems.
- Public APIs or customer webhooks.
- Microservices, Kubernetes, or multi-region infrastructure.
- An admin interface that displays or searches recovered message content.

## 6. Core User Journey

1. User opens GhostKeep and creates an account with email and password.
2. User verifies their email, then signs in.
3. User opens the dashboard and selects **Link WhatsApp**.
4. GhostKeep creates a session for that tenant and shows a QR code with an expiry and refresh option.
5. User scans the QR code with the WhatsApp account they want to connect.
6. Dashboard displays connected, connecting, disconnected, or needs-relink status.
7. User configures and verifies the recovery destination. The destination must be under the user's control. If the product uses a separate bot account, that account must be linked and configured according to the supported Baileys flow.
8. GhostKeep temporarily handles eligible incoming text messages in memory.
9. If a supported revocation event arrives while a matching temporary copy is available, GhostKeep creates a recovery record, sends a notification to the configured destination, and records delivery status without retaining ordinary chat history.
10. User can disconnect WhatsApp or delete their GhostKeep account and associated records.

### Destination behavior

The preferred UX is a WhatsApp bot chat that receives recovered messages automatically. Implementation must verify whether the chosen account/session arrangement can reliably send to that chat. Do not assume a WhatsApp account can message itself in every supported setup; test this early. If self-chat is not reliable, use a separate dedicated bot number per deployment or another clearly configured destination. Do not route one customer's content to a shared destination visible to other customers.

## 7. MVP Features

### 7.1 Authentication

- Register, log in, log out, and password reset.
- Email verification before linking WhatsApp.
- Secure password hashing using a modern password-hashing algorithm.
- Rate limiting for authentication endpoints.
- Secure, HTTP-only session cookies.

### 7.2 WhatsApp Session Linking

- One linked WhatsApp session per user in the MVP.
- QR code pairing with expiration and controlled refresh.
- Session status and last-connected timestamp.
- Reconnection handling and clear error states.
- Disconnect action that closes the worker and removes session credentials according to the deletion policy.
- Never return long-lived session credentials to the browser.

### 7.3 Temporary Message Processing

- Listen only to supported incoming message events required for deletion matching.
- Keep ordinary message content in short-lived memory only.
- Do not write ordinary message bodies, media, or full chat transcripts to PostgreSQL, files, analytics, traces, or logs.
- Use bounded cache size and TTL so messages are discarded after a short period if no deletion event arrives.
- Avoid storing message bodies in exception reports or debugging output.
- Do not download or archive media in the MVP.

### 7.4 Deletion Detection and Recovery

- Listen for the revocation/deletion event supported by the installed Baileys version.
- Match the event to the original message using stable message identifiers and chat context.
- If the original content is still in the temporary cache, create a recovery record.
- If the content is not available, record only a minimal event status and notify the user that content could not be recovered, if useful.
- Make processing idempotent so duplicate events do not produce duplicate notifications.
- Ignore GhostKeep's own outgoing notifications to prevent loops.
- Clearly distinguish confirmed deletion events from unsupported or unmatched events.

### 7.5 WhatsApp Recovery Notification

The notification should include, where available:

- A clear label such as **Deleted message detected**.
- Original sender display name or identifier.
- Original chat name or safe chat identifier.
- Original message timestamp, if available.
- Captured text content.
- A note that recovery depends on the message being captured before deletion.

Only send to the destination configured for that tenant. Verify destination ownership/configuration and never use a single shared destination that exposes different customers' recovered content to each other.

### 7.6 Minimal Customer Dashboard

Only three pages are required:

1. **Authentication:** register, login, password reset.
2. **Dashboard:** WhatsApp connection status, link/relink/disconnect controls, destination status, total deletion events and last activity. Counts must not reveal message content.
3. **Recovery history:** minimal event metadata and delivery status for the signed-in user. Message content should be displayed only to the customer if the chosen encryption and key-handling model supports this; it must never be available to platform administrators through the admin dashboard.

### 7.7 Account and Data Controls

- Disconnect WhatsApp.
- Delete account.
- Delete retained recovery records.
- Set a retention period for recovery records; use a conservative default and document it.
- Show a clear privacy explanation before linking WhatsApp.

---

## 8. Admin Dashboard (Required)

The admin dashboard is for **service operations**, not for reading customer content.

### Admin capabilities

- View aggregate counts: registered accounts, connected sessions, disconnected sessions, deletion-event counts, notification failures, and service health.
- Search accounts by internal user ID or email for support purposes.
- View operational status and timestamps needed to troubleshoot connection failures.
- Suspend an account for abuse or security reasons, with an audit trail.
- View queue/worker health, error categories, application version, and resource usage.
- Trigger safe operational actions such as request reconnect or invalidate a session, without exposing session credentials.
- View audit events for administrator actions.

### Admin restrictions

- No view of recovered message bodies or media.
- No search over message content.
- No ability to decrypt recovery records.
- No display of WhatsApp session keys, QR payloads, authentication tokens, or encryption keys.
- No raw message payloads in logs or error reports.
- Support tooling must use redacted metadata only.

### Admin dashboard pages

1. **Overview:** aggregate metrics and system status.
2. **Users:** account metadata, status, created date, connected/disconnected state.
3. **Sessions:** status and operational errors, with secrets redacted.
4. **Events & delivery:** event counts, timestamps, and delivery status only.
5. **System health:** worker status, database status, queue status, error rates.
6. **Audit log:** who performed an admin action, when, and what operational action occurred.

Use least-privilege administrator roles even if only one admin exists initially. All privileged actions must be audited.

---

## 9. Privacy and Security Requirements

### Data minimization

- Ordinary chat content is never persistently stored.
- No full conversation history, message-content analytics, or message-content search.
- Only deletion-confirmed content becomes a persistent recovery record.
- Keep metadata to the minimum needed for recovery, delivery, account security, and abuse prevention.

### Encryption

- Use TLS for traffic in transit.
- Encrypt recovery records before persistent storage using authenticated encryption such as AES-256-GCM or an equivalent well-reviewed scheme.
- Use envelope encryption and separate key material from the database.
- Encrypt WhatsApp session credentials separately from recovery records.
- Never store encryption keys in source control or expose them to the frontend.
- Document key rotation, backup, and deletion behavior.

**Privacy claim boundary:** if the server-side worker can decrypt or handle plaintext to forward it through WhatsApp, the service operator may technically be able to access plaintext during processing. Do not market this MVP as zero-knowledge, end-to-end encrypted, or technically inaccessible to the operator unless the architecture is redesigned and independently verified to provide that property. The admin dashboard itself must not expose content.

### Logging and observability

- Logs may include internal IDs, event type, timestamps, processing status, and redacted error codes.
- Logs must never include message text, full message payloads, session credentials, QR contents, destination verification secrets, or encryption keys.
- Use short log retention and restrict access to production logs.

### Tenant isolation

- Every tenant-owned row must be scoped to the authenticated tenant/user.
- Enforce authorization server-side for every request; never trust a tenant ID supplied by the client.
- Consider PostgreSQL row-level security as defense in depth.
- Use per-tenant session ownership and destination configuration.
- Add tests proving that Tenant A cannot read, update, delete, or forward Tenant B's records.

### WhatsApp risk disclosure

Baileys is an unofficial WhatsApp Web integration and is not the official WhatsApp Business Platform API. Sessions can disconnect, protocol behavior can change, and WhatsApp may restrict accounts using unofficial automation. Inform users before pairing and do not promise uninterrupted availability.

---

## 10. Suggested Technology Stack

- **Frontend:** Next.js with TypeScript.
- **Backend/API:** Node.js with TypeScript.
- **WhatsApp integration:** Baileys, pinned to a tested version.
- **Database:** PostgreSQL.
- **Initial deployment:** Docker on one VPS.
- **Worker:** a dedicated process or isolated worker module for WhatsApp event handling.
- **Cache:** bounded in-memory TTL cache for ordinary messages; do not persist this cache.
- **Secrets:** environment-based deployment secrets for initial MVP, with a clear path to a dedicated secret manager.

Do not add Redis, BullMQ, Kubernetes, or microservices until actual reliability or scale requirements justify them. A durable job mechanism may be added for notification retries, but queued payloads must not accidentally persist ordinary chat content.

---

## 11. Initial Data Model

### `users`
- `id`
- `email`
- `password_hash`
- `email_verified_at`
- `status`
- `created_at`
- `updated_at`

### `whatsapp_sessions`
- `id`
- `user_id` (unique in MVP)
- `encrypted_session_credentials`
- `connection_status`
- `last_connected_at`
- `last_error_code` (redacted; no raw payloads)
- `created_at`
- `updated_at`

### `recovery_destinations`
- `id`
- `user_id`
- `destination_identifier` (minimized/protected)
- `verification_status`
- `created_at`
- `updated_at`

### `recovery_records`
- `id`
- `user_id`
- `encrypted_content`
- `encryption_key_reference` (not the key itself)
- `source_chat_reference` (minimized or encrypted where feasible)
- `sender_reference` (minimized or encrypted where feasible)
- `original_message_timestamp` (if available)
- `detected_at`
- `retention_expires_at`
- `delivery_status`
- `delivered_at`

Only create a recovery record after matching a deletion event. Do not create a persistent `messages` table for ordinary chats.

### `deletion_events`
- `id`
- `user_id`
- `recovery_record_id` (nullable if content unavailable)
- `event_status`
- `detected_at`
- `delivery_attempt_count`
- `last_delivery_error_code` (redacted)

### `admin_audit_logs`
- `id`
- `admin_user_id`
- `action_type`
- `target_user_id` (nullable)
- `timestamp`
- `result`
- `metadata_redacted`

Do not store secrets or message bodies in audit logs.

---

## 12. API Surface (Initial)

Example routes; exact naming can change during implementation.

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/forgot-password`
- `GET /me`
- `POST /whatsapp/session/start`
- `GET /whatsapp/session/status`
- `POST /whatsapp/session/reconnect`
- `DELETE /whatsapp/session`
- `GET /recovery/events`
- `GET /settings/recovery-destination`
- `PUT /settings/recovery-destination`
- `DELETE /account`

Admin routes must be separately protected, role-checked, rate-limited where appropriate, and audited. No route may return raw WhatsApp session credentials or server-side decryption keys.

---

## 13. MVP Acceptance Criteria

- Two independent users can register and connect separate WhatsApp sessions.
- Tenant isolation tests pass for every customer-owned resource.
- Ordinary message bodies never appear in database records, persistent queues, logs, traces, or analytics.
- Ordinary message cache entries expire and are discarded if no deletion event arrives.
- A supported deletion event matches the correct cached message when available.
- Duplicate revocation events do not create duplicate recovery notifications.
- Notifications are sent only to the configured tenant destination.
- One tenant's notification can never be routed to another tenant's destination.
- Admin dashboard shows operational metadata but no recovered message content or secrets.
- Sessions survive ordinary application restarts where supported, and users can reconnect after disconnects.
- Users can disconnect and delete their accounts and retained recovery records.
- Retention expiry is enforced and tested.
- Privacy disclosures accurately explain temporary processing, persistent recovery storage, and the operator-access limitation during automatic forwarding.

---

## 14. Delivery Plan

### Phase 1 — Foundation
- Set up repository, environment configuration, PostgreSQL, migrations, authentication, and tenant ownership checks.

### Phase 2 — WhatsApp linking
- Implement Baileys session creation, QR display, secure credential persistence, connection status, reconnect, and disconnect.

### Phase 3 — Privacy-first event pipeline
- Implement bounded in-memory message cache, deletion-event matching, deduplication, redacted logs, and tests proving ordinary messages are not persisted.

### Phase 4 — Recovery delivery
- Implement per-tenant destination configuration, destination validation, notification formatting, retries, and loop prevention.
- Test whether self-chat is reliable in the actual linked-account arrangement; if not, use a clearly configured dedicated destination.

### Phase 5 — Customer and admin dashboards
- Build the three customer pages and the operational admin dashboard with strict content and secret redaction.

### Phase 6 — Hardening and pilot
- Test two or more tenants, session restarts, disconnects, deletion events, notification failures, retention expiry, account deletion, and access-control boundaries.
- Run a small pilot with consenting users before broader launch.

A 1–2 week implementation target may be possible for a focused developer, but Baileys session behavior, deletion-event handling, and reliable forwarding need real-world testing and may extend the schedule.

---

## 15. Success Metrics

Track only operational metadata, not ordinary chat content:

- Account registration completion rate.
- WhatsApp linking success rate.
- Connected-session uptime.
- Supported deletion-event detection rate in controlled tests.
- Recovery notification delivery success rate.
- Duplicate notification rate.
- Reconnection success rate.
- Number of privacy/security incidents.
- Number of ordinary message bodies accidentally persisted (**target: zero**).

---

## 16. MVP Definition of Done

GhostKeep is ready for a limited pilot when a user can create an account, link one WhatsApp number, receive recovered text in the configured bot chat after a supported deletion, and manage the connection from a minimal dashboard; ordinary chats are not persistently stored; customer data is isolated; the admin dashboard cannot display recovered content; and privacy disclosures accurately describe the limits of server-side automatic forwarding.

**Build principle:** ship the smallest reliable version of this workflow. Do not add features until the core flow and privacy boundaries have been tested.
