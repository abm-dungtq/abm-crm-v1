# Release 2026-10-27: chat and tasks UI upgrade

The user approved commit, push and deploy after the second re-audit passed every bar.

## Result
- **Code:** pushed `461d6e0..d8e2fb6` (4 commits).
- **Worker `abm-crm-eval`:** new version `774be1dd-715f-499d-a778-a395553b0962`. The previous version was `1e0064e6-cb68-49d4-9020-2c450b80b57a`.
- **Database:** no migration, so no D1 backup was needed.
- **Checks after deploy:** `/api/health`, `/`, `/chat`, `/tasks` and `/sw.js` return 200. `/api/chat/conversations` returns 401 without a session.

## Quality evidence
- **Rubric:**

  | Screen | Baseline | After the upgrade |
  |---|---|---|
  | Chat | 12/24 | 22/24 |
  | Tasks | 13/24 | 22/24 |

  - The independent re-audit is [ux-reaudit2-261027-chat-tasks.md](ux-reaudit2-261027-chat-tasks.md); the baseline is [ux-audit-261027-chat-tasks.md](ux-audit-261027-chat-tasks.md).
  - The before and after screenshots are kept locally next to those reports and are not committed (24 MB).
- **Gates:** `pnpm -r typecheck` exits 0, crm tests 819 passed and 2 skipped, and the build exits 0.
- **Security fix:** the trailing-mention trimming used in task drafts is now linear. A timing test covers 200 mentions plus 10 kB of text.

## Deferred
- **T-03:** a read-first task detail page.
- **B8:** a mobile bottom bar.
- **B10:** a token sweep and a design-guidelines doc.
- **B11:** a command palette.
- **Open items from the second re-audit:**
  - N-09: a task created from a thread copies the system line "Đã tạo việc".
  - N-10: on mobile, the comment box sits below the fold in the comments tab.
  - Three Polish items.

## Not verified
- Touch target sizes on a real phone.
- Screen reader behaviour.
- The "Tin mới" divider when a message arrives just as the chat opens.

## Rollback
`npx wrangler rollback 1e0064e6-cb68-49d4-9020-2c450b80b57a`. No schema changed.
