-- GhostKeep MVP schema. No `messages` table by design (ordinary chats stay in memory only).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  email_verify_token TEXT,
  password_reset_token TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  tos_accepted_at TIMESTAMPTZ,
  privacy_accepted_at TIMESTAMPTZ,
  wa_risk_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- CITEXT may be unavailable; fallback:
-- If CITEXT missing, run: CREATE EXTENSION citext; (image includes it via contrib? use text + lower index)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  encrypted_session_credentials TEXT NOT NULL,
  session_key_reference TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (connection_status IN ('connecting','connected','disconnected','needs_relink')),
  last_connected_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  destination_identifier TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified')),
  verify_code_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_content TEXT NOT NULL,
  encryption_key_reference TEXT NOT NULL,
  -- Minimized references stored as salted hashes where possible; encrypted blobs hold display values.
  source_chat_reference TEXT NOT NULL,
  sender_reference TEXT NOT NULL,
  original_message_timestamp TIMESTAMPTZ,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_expires_at TIMESTAMPTZ NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','delivered','failed')),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recovery_records_user_idx ON recovery_records (user_id, detected_at DESC);

-- Media extension (owner-requested, post-MVP): encrypted blob + minimized metadata.
ALTER TABLE recovery_records ADD COLUMN IF NOT EXISTS encrypted_media TEXT;
ALTER TABLE recovery_records ADD COLUMN IF NOT EXISTS media_type TEXT CHECK (media_type IN ('image','video','audio','document','sticker'));
ALTER TABLE recovery_records ADD COLUMN IF NOT EXISTS media_mimetype TEXT;
ALTER TABLE recovery_records ADD COLUMN IF NOT EXISTS media_file_name TEXT;
ALTER TABLE recovery_records ADD COLUMN IF NOT EXISTS media_size INT;

-- Legal consent timestamps (nullable for pre-existing rows).
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_risk_accepted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS deletion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_message_id TEXT NOT NULL,
  recovery_record_id UUID REFERENCES recovery_records(id) ON DELETE SET NULL,
  event_status TEXT NOT NULL CHECK (event_status IN ('recovered','unmatched','unsupported','duplicate')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_attempt_count INT NOT NULL DEFAULT 0,
  last_delivery_error_code TEXT,
  UNIQUE (user_id, wa_message_id)
);
CREATE INDEX IF NOT EXISTS deletion_events_user_idx ON deletion_events (user_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users(id),
  action_type TEXT NOT NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT NOT NULL,
  metadata_redacted JSONB NOT NULL DEFAULT '{}'
);
