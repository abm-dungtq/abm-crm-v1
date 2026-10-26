-- Lark is no longer used (ADR-012). Close any Lark notice still queued; the kind stays in the CHECK so old
-- rows remain valid. app_user.lark_* columns are kept, unused, to avoid rebuilding app_user.
UPDATE channel_command SET status = 'failed', result_json = '{"error":"LARK_REMOVED"}',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE kind = 'send_lark' AND status IN ('pending', 'claimed');
UPDATE outbox SET status = 'skipped', last_error = 'LARK_REMOVED'
WHERE event_type = 'approval.requested' AND status IN ('pending', 'sending', 'failed');
