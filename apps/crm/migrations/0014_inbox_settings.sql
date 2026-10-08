-- Organization-wide inbox settings (single row, id = 1): how conversations are assigned to staff
-- and how many minutes a customer may wait for a staff reply before the Lark group is reminded.

CREATE TABLE inbox_setting (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  assign_mode TEXT NOT NULL DEFAULT 'manual' CHECK (assign_mode IN ('manual', 'round_robin')),
  sla_minutes INTEGER NOT NULL DEFAULT 15 CHECK (sla_minutes BETWEEN 1 AND 1440),
  updated_by_user_id TEXT REFERENCES app_user(id),
  updated_at TEXT
);
INSERT INTO inbox_setting (id, assign_mode, sla_minutes) VALUES (1, 'manual', 15);
