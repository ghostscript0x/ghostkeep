# GhostKeep Privacy Disclosure (MVP) — must be shown before linking WhatsApp

## What we temporarily process
When your WhatsApp session is connected, the worker holds eligible incoming **text** messages in a bounded in-memory cache (default max 1000 entries, TTL 15 minutes) so a later deletion (revocation) event can be matched. Entries expire and are discarded if no deletion arrives.

**Media (owner-requested, beyond MVP scope):** incoming images, videos, voice notes, audio, documents, and stickers are **instantly forwarded server-side** to your verified recovery destination at receipt time — media bytes are never downloaded, staged, or persisted by GhostKeep, so there is nothing to delete afterwards. Only a caption/placeholder text is cached transiently so a later deletion still produces the "Deleted message detected" label pointing at the forwarded copy. If no verified destination is set, only caption text is kept.

## What we persist
Only when a supported deletion event matches a cached copy do we create an encrypted recovery record and a minimal deletion-event row (timestamps, delivery status, redacted error codes). Ordinary chat content is never written to Postgres, files, queues, logs, traces, or analytics. Target: zero ordinary bodies persisted.

## Encryption
Recovery records and WhatsApp session credentials are encrypted with AES-256-GCM envelope encryption. Key IDs are stored; keys live only in environment/secret-manager, never in git or the frontend. See `backend/src/crypto/envelope.ts`.

## Operator-access limitation (important)
Automatic forwarding requires the server-side worker to handle message plaintext briefly to send it to your configured destination. Because the worker runs on service-operated infrastructure, **the operator may technically be able to access plaintext during processing**. Encryption at rest + hiding content from the admin dashboard do not make this end-to-end or zero-knowledge. Do not rely on GhostKeep where this is unacceptable.

## Admin visibility
Administrators see aggregate counts, connection statuses, delivery statuses, and redacted errors only. There is no admin view, search, decrypt, or log path for recovered message content, session keys, QR payloads, or encryption keys. All admin actions are audit-logged.

## Your controls
Dashboard lets you disconnect WhatsApp, delete recovery records, set a retention period (default 30 days, expiry enforced by worker), and delete your account and associated records.

## WhatsApp risk
Baileys is an unofficial WhatsApp Web integration, not the official Business Platform API. Pairing is a companion session; it can disconnect, break on protocol changes, and WhatsApp may restrict accounts using unofficial automation. No uninterrupted availability is promised.
