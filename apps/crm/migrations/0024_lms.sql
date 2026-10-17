-- Learner LMS: learner accounts and sessions, one online program per class, lessons, Stream videos,
-- manual access grants/blocks and lesson progress. The abm-lms Worker shares this database but never
-- runs migrations; this directory owns the schema.

-- One hashed default password per organization. A learner_account with password_hash NULL signs in with it.
ALTER TABLE org_setting ADD COLUMN learner_default_password_hash TEXT;
ALTER TABLE org_setting ADD COLUMN learner_default_password_salt TEXT;
ALTER TABLE org_setting ADD COLUMN learner_default_password_iterations INTEGER;

CREATE TABLE learner_account (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  contact_id TEXT NOT NULL UNIQUE REFERENCES contact(id),
  -- Lower-cased, trimmed; the sign-in key.
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  CHECK ((password_hash IS NULL) = (password_salt IS NULL))
);
CREATE INDEX learner_account_org ON learner_account(organization_id);

-- The cookie carries a random token; only its SHA-256 is stored.
CREATE TABLE learner_session (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_account(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX learner_session_account ON learner_session(account_id);

CREATE TABLE lms_program (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  -- One program per class; NULL while published ahead of its class.
  class_id TEXT UNIQUE REFERENCES class_group(id),
  title TEXT NOT NULL,
  -- R2 key of the current handbook HTML in the abm-lms-content bucket; NULL until first publish.
  content_key TEXT,
  content_version INTEGER NOT NULL DEFAULT 0,
  review_days INTEGER CHECK (review_days IS NULL OR review_days >= 0),
  cloned_from_program_id TEXT REFERENCES lms_program(id),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX lms_program_org ON lms_program(organization_id);

CREATE TABLE lms_lesson (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES lms_program(id),
  -- The handbook's <section id>, e.g. b1p1.
  section_id TEXT NOT NULL,
  title TEXT NOT NULL,
  group_title TEXT,
  position INTEGER NOT NULL,
  -- Set when a later publish no longer contains this section; its videos are kept.
  hidden_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  UNIQUE (program_id, section_id)
);

CREATE TABLE lms_lesson_video (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lms_lesson(id),
  title TEXT NOT NULL,
  stream_uid TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX lms_lesson_video_lesson ON lms_lesson_video(lesson_id, position);

-- Manual exceptions on top of enrollment-derived access. A live block hides the program even from enrolled learners.
CREATE TABLE lms_access (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  contact_id TEXT NOT NULL REFERENCES contact(id),
  program_id TEXT NOT NULL REFERENCES lms_program(id),
  mode TEXT NOT NULL CHECK (mode IN ('grant', 'block')),
  expires_at TEXT,
  note TEXT,
  revoked_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX lms_access_contact ON lms_access(contact_id, program_id);
CREATE INDEX lms_access_program ON lms_access(program_id);

CREATE TABLE lms_progress (
  account_id TEXT NOT NULL REFERENCES learner_account(id),
  lesson_id TEXT NOT NULL REFERENCES lms_lesson(id),
  completed_at TEXT NOT NULL,
  PRIMARY KEY (account_id, lesson_id)
);
