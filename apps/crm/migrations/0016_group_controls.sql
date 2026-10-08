-- Zalo group controls: an organization-wide switch for recurring group posts (off until the pilot
-- shows the shared numbers are safe), and the reason a recurring post last did not go out.

ALTER TABLE inbox_setting ADD COLUMN scheduled_sends_enabled INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_sends_enabled IN (0,1));
ALTER TABLE group_schedule ADD COLUMN last_skip_reason TEXT;
