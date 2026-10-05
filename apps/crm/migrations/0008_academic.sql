-- Academic: courses, classes, sessions, trial bookings and enrollments.
-- class_teacher is append-only (rewritten by the assign command) and has no version columns.
-- makeup_for_attendance_id is checked by the command in a later phase; attendance does not exist yet.

CREATE TABLE course (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  product_id TEXT NOT NULL REFERENCES product(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE class_group (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(id),
  name TEXT NOT NULL,
  schedule_text TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled', 'finished')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE class_teacher (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES class_group(id),
  user_id TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  UNIQUE (class_id, user_id)
);

CREATE TABLE class_session (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES class_group(id),
  starts_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  kind TEXT NOT NULL CHECK (kind IN ('regular', 'trial', 'makeup')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  note TEXT,
  makeup_for_attendance_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX class_session_class_start ON class_session(class_id, starts_at);

CREATE TABLE enrollment (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  lead_id TEXT NOT NULL REFERENCES lead(id),
  contact_id TEXT NOT NULL REFERENCES contact(id),
  class_id TEXT NOT NULL REFERENCES class_group(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'studying', 'deferred', 'transferred', 'completed', 'withdrawn', 'cancelled')),
  deferred_until TEXT,
  status_before_defer TEXT,
  transferred_from_enrollment_id TEXT,
  confirmed_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  CHECK (status <> 'deferred' OR deferred_until IS NOT NULL)
);
CREATE INDEX enrollment_class_status ON enrollment(class_id, status);
CREATE INDEX enrollment_contact ON enrollment(contact_id);

CREATE TABLE trial_booking (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES lead(id),
  session_id TEXT NOT NULL REFERENCES class_session(id),
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'done', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
