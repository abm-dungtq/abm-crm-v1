# Release 2026-10-27: chat threads, topics, department groups and tasks from chat

Plan: [261026-1028-lark-style-threads-task-from-chat](../261026-1028-lark-style-threads-task-from-chat/plan.md). Opus ran the release on 2026-10-27 (Asia/Saigon), after the advisor's final review gave a GO and the user approved the deploy.

## Result
- Code pushed to `origin/main`: `19b78ac..14f45f7`, 11 commits.
- Worker `abm-crm-eval`:
  - New version: `1e0064e6-cb68-49d4-9020-2c450b80b57a`.
  - Previous version: `62d61a57-fa8f-49e9-9056-6f55f0f5aa49`.

## 10.1 Local gates (on `f633e75`, run again with the reports commit)
- `pnpm -r typecheck` exits 0.
- `pnpm -r test` passes: CRM 769 passed and 2 skipped; bridge 114; LMS 17; lms-core 12; PoCs 8 + 8.
- `pnpm --filter @abm/crm build` exits 0.
- Budgets measured in tests:
  - Message send: 14 D1 queries, 11 subrequests.
  - Task created from a thread with 20 members: 15 D1 queries, 25 subrequests (22 pushes).
  - Cron: 35 D1 queries.
- Secret scan on `origin/main..main`: only variable names and test-generated keys.

## 10.2 Backup
- Counts before the migration:

  | Messages | Replies | Notifications | Tasks | Departments |
  |---|---|---|---|---|
  | 1136 | 1 | 1 | 5 | 1 |

- Export: `exports/abm-crm-eval-before-0031-20261027.sql`, 3.8 MB, git-ignored.
- Time Travel bookmark before 0031: `0000015a-00000028-00005111-c2bd6904fa4185cd1533cc3cdd976d26`.

## 10.3 Migration
`0031_lark_threads_groups.sql` was applied remotely ✅. Checks after applying:
- `chat_thread` and `chat_thread_follower` both exist.
- Messages are still 1136, notifications 1, tasks 5.
- 0 replies have `reply_to_message_id` different from `parent_message_id`.
- `notification` accepts the `chat_thread` kind, and `notification_backup` is gone.
- `PRAGMA foreign_key_check` returns nothing.

## 10.4 Deploy
- `/api/health`, `/`, `/chat` and `/sw.js` return 200. `/api/chat/threads` returns 401 without a session.
- The reply copy was re-run after the deploy and changed 0 rows.
- `wrangler tail`: two every-minute cron runs were Ok, and a user's chat list load was Ok.
- Department group check after that first chat-list load:
  - `dept:` "Phòng Kinh doanh" exists with 5 members, which equals the department's 5 active staff.
  - It has no owner, because nobody in that department has the "Trưởng phòng" (`head`) role. The two Leaders are members.
  - So only a director or an Admin can switch that group to Chủ đề until a Trưởng phòng is set in Admin.
- `docs/engineering/deployment-baseline.md` and `environments.md` need no change: there is no new binding, var or secret.

## Not done by Opus
- **Headless smoke test with `[TEST]` data:** not done. Like the last release, I have no CRM login, so every check that needs a session is left for the user (10.6).
- **10.5, GoClaw `crm-group-assistant` prompt:** waiting for the user's approval. The new `[TASK]` block prompt is in `docs/integrations/goclaw-inbox-agents.md` section 7. Until it is applied, Trợ lý keeps proposing tasks in the old one-line `[TASK: …]` format, which still parses into a draft card.

## Waiting for the user
| Step | What |
|---|---|
| Announcement | Tell staff about the department groups. |
| 10.5 | Approve the GoClaw prompt change. Opus backs up GoClaw first. |
| 10.6 | Live checks 1–12 from phase 10, on a phone and on a desktop. |
| Earlier plan | 7.4, 7.5.3, 7.5.5, 7.6.2–3, 7.7 and 7.8 from the 26/10 release. |

## Rollback
- **Worker:** run `npx wrangler rollback 62d61a57-fa8f-49e9-9056-6f55f0f5aa49`. The old code runs on the new schema; thread replies then show as normal messages.
- **Database:** 0031 only adds tables and columns, and rebuilds `notification` keeping every row. Restoring the bookmark above discards every CRM write made since, so it needs the user's agreement.
