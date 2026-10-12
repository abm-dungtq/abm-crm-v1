-- When the Zalo bridge last made an authenticated GET /api/bridge/commands.
-- The channel-accounts page treats the bridge as online when this is within 90 seconds of Worker time.

ALTER TABLE inbox_setting ADD COLUMN bridge_last_seen_at TEXT;
