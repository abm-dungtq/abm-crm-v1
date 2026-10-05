-- Attendance for one learner on one session. Exactly one of enrollment or trial booking is set.
-- class_session.makeup_for_attendance_id stays a plain id; the makeup command checks it.

CREATE TABLE attendance (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES class_session(id),
  enrollment_id TEXT REFERENCES enrollment(id),
  trial_booking_id TEXT REFERENCES trial_booking(id),
  status TEXT NOT NULL CHECK (status IN ('unmarked', 'present', 'absent', 'excused', 'late')),
  marked_by_user_id TEXT NOT NULL REFERENCES app_user(id),
  marked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  CHECK ((enrollment_id IS NULL) <> (trial_booking_id IS NULL))
);

CREATE UNIQUE INDEX attendance_session_enrollment ON attendance(session_id, enrollment_id) WHERE enrollment_id IS NOT NULL;
CREATE UNIQUE INDEX attendance_session_trial ON attendance(session_id, trial_booking_id) WHERE trial_booking_id IS NOT NULL;
