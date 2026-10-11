# GhostKeep (MVP)

Deleted doesn't have to mean gone.

Multi-tenant WhatsApp anti-delete SaaS. See `product.md` for scope and `PRIVACY.md` for privacy limits.

## Layout

- `backend/` — Node + TypeScript API + Baileys worker, PostgreSQL migrations
- `web/` — Next.js + TypeScript minimal customer + admin dashboards
- `docker-compose.yml` — lean deploy: backend + web only (Postgres/Redis stay on CasaOS)

## Quick start (local)

1. Copy env: `cp .env.example .env` and fill the two 32-byte base64 master keys.
2. Migrate: `cd backend && npm install && npm run migrate`
3. Run everything: `npm run dev:all` (from repo root)

## Deploy with Docker (low resource)

Designed for the smallest box that can run Node: Postgres and Redis stay on
CasaOS (already in `.env`), so only two small alpine services ship.
Expected footprint: **~150–250MB RAM total**.

```bash
cp .env.example .env   # fill secrets, CasaOS hosts, public WEB_URL
docker compose up -d --build
docker compose logs -f
```

- Images are multi-stage: build tools and devDeps never reach runtime.
- Web ships as a Next.js standalone bundle (no npm at runtime).
- Hard caps: backend 384MB/1 CPU, web 256MB/0.5 CPU, log rotation on.
- Healthchecks on both services; `restart: unless-stopped`.
- **Phones need LAN-reachable URLs:** set `WEB_URL=http://<host-ip>:3000` in
  `.env` and build web with
  `docker compose build --build-arg NEXT_PUBLIC_API_URL=http://<host-ip>:4000 web`
  (`NEXT_PUBLIC_*` is baked into client JS at build time).
- One process owns the WhatsApp sockets (inside backend). Never run a
  second socket-owning service — they knock each other offline.

## Privacy model (summary)

- Ordinary messages live only in a bounded in-memory TTL cache, never in Postgres/files/logs.
- Only deletion-matched content becomes an encrypted `recovery_records` row (AES-256-GCM envelope).
- Admin API/UI exposes counts and statuses only — never message bodies, session keys, QR payloads, or encryption keys.
- Limitation: the worker briefly holds plaintext to forward via WhatsApp on operator-run infra, so the operator may technically access plaintext during processing. This is **not** zero-knowledge. See `PRIVACY.md`.

## WhatsApp risk

Baileys is unofficial. Sessions can disconnect, behavior can change, accounts using automation may be restricted. The UI shows this before pairing.

## Media recovery (post-MVP extension, owner-requested)

Beyond the text-only MVP scope in `product.md`, GhostKeep also covers images, videos, voice notes, audio, documents, and stickers: each is instantly forwarded server-side to the verified destination on receipt (no download, no staging, no persistence — nothing to delete afterwards), and a later deletion produces the usual label pointing at the forwarded copy. Quicker than text recovery and strictly more private, since media bytes never touch our infrastructure. View-once messages are intentionally skipped.
