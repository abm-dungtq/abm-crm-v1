# Phase 8: Import the old Zalo OA chat history

Executor: Opus runs everything. Grok may write `build-import.mjs` from this spec. Customer data never enters the repo: every data file lives in `D:\TQD\CRM\exports\` (git-ignored) or `/root/oa-export/` on the VPS, which is deleted afterwards.

## Context

- Phase 1's report `plans/reports/vps-inventory-261014.md` names the old tables and columns for OA conversations, messages and customer profiles.
- Phase 3 creates the target: `conversation` (`channel_account_id`, `kind='direct'`, `external_thread_id` = customer Zalo user id) and `message` (`UNIQUE (conversation_id, external_msg_id)`).
- The `zalo_oa` channel account exists only after the OAuth connect in phase 9. So the import runs in phase 9, after the connect step.

## Tasks

### Task 8.1: Export from the VPS

- Steps:
  1. Run a read-only `sqlite3 -json` query on the VPS against the phase 1 backup copy, not the live DB. Write `oa-history.json` with:
     - per conversation: OA id, customer user id, display name, avatar URL;
     - per message: external message id, direction, old source (customer / agent / manual / import / staff app), text, attachment URLs, platform time.
  2. `scp` it to `D:\TQD\CRM\exports\`.
- Verify: the JSON's conversation and message counts equal phase 1's inventory counts.

### Task 8.2: Build the SQL

- Target: `C:\Users\ABM\AppData\Local\Temp\zalo-ops\build-import.mjs` (outside the repo).
- Steps:
  1. Read the JSON and the CRM `channel_account.id` of the OA (pass it as an argument). Write `exports/oa-history-import.sql`.
  2. For each conversation, write `INSERT OR IGNORE INTO conversation`:
     - new id `oa-import-<sha1(oa:user)>`;
     - organization of the account;
     - `kind='direct'`, `mode='ai'`, `display_name`;
     - `last_message_at` = newest message time;
     - `staff_context_pending` = the last messages formatted `Khách: ...` / `Bot: ...` / `Nhân viên: ...`, trimmed to the last 1500 chars.
  3. For each message, write `INSERT OR IGNORE INTO message (...) SELECT ..., c.id ... FROM conversation c WHERE c.channel_account_id = ? AND c.external_thread_id = ?`. The conversation is looked up, never assumed, because a webhook may already have created it. Fields:
     - `sender_kind`: in → `customer`; out from the agent → `bot`; out from manual or the staff app → `staff_phone`; anything else → `system`;
     - `status`: `received` for in, `sent` for out;
     - `attachments_json` for images;
     - `created_at` = platform time.
  4. No `channel_command` rows, so nothing is sent and no bot runs.
  5. SQL-escape every value. Write batches of at most 500 rows per statement.
- Verify: `node build-import.mjs --dry-run` prints counts equal to Task 8.1's counts.

### Task 8.3: Rehearse locally, then import

- Steps:
  1. Load the latest remote export into a throwaway local D1, then apply the import file. Check the counts and `PRAGMA foreign_key_check`.
  2. In phase 9, back up D1 again, then run `wrangler d1 execute abm-crm-eval --remote --file exports/oa-history-import.sql`.
- Verify: the remote `SELECT COUNT(*)` of OA conversations and messages equals the JSON counts; `foreign_key_check` returns no rows; `channel_command` has no new rows (count before = after).

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Report to the supervisor (Opus) with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output (no customer data),
- the pass condition it failed to meet.
Never continue by self-reasoning.
