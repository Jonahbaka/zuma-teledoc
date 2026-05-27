-- =============================================================================
-- 016_ng_conferencing.sql
-- DoctaRx Nigeria — Multi-party conferencing
--
-- Healthcare-grade rooms supporting consultations, case conferences,
-- teaching rounds, board reviews, and emergency coordination — with
-- role-based permissions, waiting rooms, chat, attendance, and a
-- recording metadata layer.
--
-- This migration covers the CONTROL plane (state, roles, audit). The
-- MEDIA plane is intentionally pluggable: ≤3 participants degrade
-- gracefully to peer-mesh; SFU integration (LiveKit / Mediasoup /
-- Janus) takes over for larger rooms and is wired through the
-- `media_server` columns below.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE ng_conf_kind AS ENUM (
  'consultation',           -- doctor + patient, optionally specialist
  'case_conference',        -- multi-doctor case review
  'teaching_round',         -- consultant + residents + interns
  'board_review',           -- hospital board / multidisciplinary team
  'emergency_room'          -- emergency coordination
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_conf_status AS ENUM (
  'scheduled','live','ended','cancelled'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_conf_role AS ENUM (
  'host',          -- room creator; full controls
  'consultant',    -- senior; can prescribe, finalize Dx, approve referrals
  'doctor',        -- can document, escalate, invite specialists
  'nurse',         -- can update vitals, upload observations
  'pharmacist',    -- can review prescriptions, confirm dispense
  'patient',       -- speaks; sees only their own data
  'family',        -- patient family rep; speaks with patient consent
  'observer'       -- intern / silent reviewer; read-only, no Rx authority
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_conf_participant_status AS ENUM (
  'invited','waiting','admitted','left','removed','denied'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_conf_media_server AS ENUM (
  'peer_mesh','livekit','mediasoup','janus','none'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_conf_rooms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code           TEXT UNIQUE NOT NULL,                 -- short shareable code e.g. CONF-2026-A8K3PQ
  title               TEXT NOT NULL,
  kind                ng_conf_kind NOT NULL DEFAULT 'consultation',
  status              ng_conf_status NOT NULL DEFAULT 'scheduled',
  host_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  host_provider_id    UUID REFERENCES ng_providers(id) ON DELETE SET NULL,
  hospital_id         UUID REFERENCES ng_hospitals(id) ON DELETE SET NULL,
  appointment_id      UUID REFERENCES ng_appointments(id) ON DELETE SET NULL,
  patient_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  patient_name_snapshot TEXT,

  max_participants    INTEGER DEFAULT 10,
  requires_waiting_room BOOLEAN DEFAULT TRUE,
  recording_enabled   BOOLEAN DEFAULT FALSE,
  allow_chat          BOOLEAN DEFAULT TRUE,
  allow_private_dm    BOOLEAN DEFAULT TRUE,

  media_server        ng_conf_media_server DEFAULT 'peer_mesh',
  media_server_url    TEXT,                                 -- e.g. wss://livekit.local
  media_server_token  TEXT,                                 -- ephemeral, optional
  signaling_namespace TEXT,                                 -- e.g. /telehealth or /conf:{id}

  scheduled_start     TIMESTAMPTZ,
  scheduled_end       TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,

  metadata_json       JSONB DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conf_room_status   ON ng_conf_rooms (status, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_conf_room_host     ON ng_conf_rooms (host_user_id);
CREATE INDEX IF NOT EXISTS idx_conf_room_patient  ON ng_conf_rooms (patient_user_id);
CREATE INDEX IF NOT EXISTS idx_conf_room_kind     ON ng_conf_rooms (kind, status);
CREATE INDEX IF NOT EXISTS idx_conf_room_hospital ON ng_conf_rooms (hospital_id);

-- ---------------------------------------------------------------------------
-- Participants
-- permissions_json overrides the role default when set; empty = role default.
-- Standard permission keys:
--   speak, see_video, share_screen, send_chat, send_private_dm,
--   raise_hand, mute_others, kick_others, admit_others, end_room,
--   prescribe, finalize_diagnosis, approve_referrals,
--   update_vitals, upload_observations,
--   review_prescriptions, confirm_dispense
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_conf_participants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          UUID NOT NULL REFERENCES ng_conf_rooms(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  display_name     TEXT NOT NULL,
  role             ng_conf_role NOT NULL DEFAULT 'observer',
  permissions_json JSONB DEFAULT '{}'::JSONB,
  status           ng_conf_participant_status NOT NULL DEFAULT 'invited',

  admitted_by_user UUID REFERENCES users(id) ON DELETE SET NULL,
  joined_at        TIMESTAMPTZ,
  left_at          TIMESTAMPTZ,
  removed_by_user  UUID REFERENCES users(id) ON DELETE SET NULL,
  removed_at       TIMESTAMPTZ,
  hand_raised_at   TIMESTAMPTZ,
  muted_audio      BOOLEAN DEFAULT FALSE,
  muted_video      BOOLEAN DEFAULT FALSE,

  attended_seconds INTEGER DEFAULT 0,
  last_seen_at     TIMESTAMPTZ,

  client_ip        TEXT,
  user_agent       TEXT,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conf_part_room   ON ng_conf_participants (room_id, status);
CREATE INDEX IF NOT EXISTS idx_conf_part_user   ON ng_conf_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_conf_part_role   ON ng_conf_participants (room_id, role);

-- ---------------------------------------------------------------------------
-- Invites (pre-room, hashed token like portal_access_tokens)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_conf_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES ng_conf_rooms(id) ON DELETE CASCADE,
  email         TEXT,
  phone         TEXT,
  role          ng_conf_role NOT NULL,
  display_name  TEXT,
  token_hash    TEXT NOT NULL UNIQUE,
  token_prefix  TEXT NOT NULL,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  used_by_user  UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conf_invite_room ON ng_conf_invites (room_id);
CREATE INDEX IF NOT EXISTS idx_conf_invite_exp  ON ng_conf_invites (expires_at);

-- ---------------------------------------------------------------------------
-- Chat — room-wide + private DM (private_to_user_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_conf_chat (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id           UUID NOT NULL REFERENCES ng_conf_rooms(id) ON DELETE CASCADE,
  sender_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_display    TEXT,
  message           TEXT NOT NULL,
  private_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  attached_json     JSONB DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conf_chat_room ON ng_conf_chat (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conf_chat_dm   ON ng_conf_chat (room_id, private_to_user_id);

-- ---------------------------------------------------------------------------
-- Per-room audit / control events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_conf_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES ng_conf_rooms(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES ng_conf_participants(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role    ng_conf_role,
  event_kind    TEXT NOT NULL,
  -- room_started | room_ended | participant_invited | participant_joined |
  -- participant_left | hand_raised | hand_lowered | muted | unmuted |
  -- promoted | demoted | admitted | denied | removed | screen_share_started |
  -- screen_share_stopped | recording_started | recording_stopped | dm_sent
  payload_json  JSONB DEFAULT '{}'::JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conf_event_room ON ng_conf_events (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conf_event_kind ON ng_conf_events (event_kind);

-- ---------------------------------------------------------------------------
-- Recordings — metadata only. Media files live in object storage and
-- are referenced via storage_url. Indexed by room.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_conf_recordings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES ng_conf_rooms(id) ON DELETE CASCADE,
  storage_url   TEXT,
  storage_backend TEXT,                       -- s3 | gcs | azure | local
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  duration_seconds INTEGER,
  file_size_bytes BIGINT,
  status        TEXT DEFAULT 'recording',     -- recording | finalised | failed | deleted
  initiated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  consent_recorded_at TIMESTAMPTZ,             -- when all participants consented
  consent_participants_json JSONB DEFAULT '[]'::JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conf_rec_room ON ng_conf_recordings (room_id);

-- ---------------------------------------------------------------------------
-- Breakout rooms — sub-rooms of a parent room (parent_room_id != NULL).
-- We reuse ng_conf_rooms and add a parent column.
-- ---------------------------------------------------------------------------
ALTER TABLE ng_conf_rooms
  ADD COLUMN IF NOT EXISTS parent_room_id UUID REFERENCES ng_conf_rooms(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_conf_room_parent ON ng_conf_rooms (parent_room_id);
