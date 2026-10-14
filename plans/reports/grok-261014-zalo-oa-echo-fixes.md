# Zalo OA echo fixes before cutover

Date: 2026-10-14. Implements the supervisor's decisions for H1, H2, M1, M2, and the two low items named in the task (bridge image sweep at startup, 199k checkbox after a rejected enable).

## What changed

### 1. Own-send match is exact, per part, and does not change status (H2, M1)

`linkOwnSend` in `zalo-oa-webhook.ts` no longer uses `instr(...) > 0`, and it no longer calls `markMessageSent`.

It loads up to five candidate outbound rows of the conversation (`bot`, `staff_web`, `system`; `pending` or `sent`; inside the window below), newest send activity first. Each body is split with the sender's `splitZaloOaText`. Each part is normalized the same way as before (drop CR, collapse each pair of spaces once, trim) and compared for equality with the normalized echo. A short staff reply such as "Dạ" that only occurs inside a longer part does not match.

On a match, one update sets `external_msg_id` only when it is NULL and no other row of the conversation already holds that id. `status` is left alone. The send loop remains the only writer of `sent`.

`zalo-oa-send.ts` was not edited. It already marks the row sent after the parts are posted.

The test that reads the row while `/message/cs` is still in flight now expects `pending` plus the echoed id. After the send loop returns, the row is `sent`.

### 2. The 120s window follows the latest send activity (H1)

A candidate is inside the window when either of these is true:

- `message.created_at >= since`, or
- a `channel_command` with `kind = 'send_zalo_oa'`, the same `conversation_id`, and `json_extract(payload_json, '$.messageId') = message.id` has `updated_at >= since`.

`since` is 120 seconds before the webhook's clock. `claimCommands`, `failCommand`, `recordProgress`, and `completeCommand` all write `updated_at`, so a bot reply whose first attempt failed and whose retry runs minutes later is still recognised when Zalo echoes that retry. The five rows are ordered by that command's latest `updated_at` (then `created_at`), so the retried row is not dropped behind newer inserts.

The same `json_extract` join is already used for personal-Zalo echoes.

### 3. A resent customer event finishes a follow-up that stopped after the insert (M2)

The insert and `scheduleCompletion` were not put in one `db.batch`. `scheduleCompletion` reads the conversation, may extend a pending reply or insert a new one, and then clears staff context. Copying that into the insert batch would mean editing `conversation-flow.ts`, which this task does not allow. A batch of only the insert and the conversation update would still leave a committed message when the bot-run write throws.

The path that fits `ingest.ts`: when the insert conflicts, an Official Account customer message runs the same follow-up again. Facebook and personal Zalo do not pass `channel: 'zalo_oa'`, so a duplicate there still returns immediately.

The follow-up is skipped when it already landed:

- `ai`: a `run_completion` with dedupe key `completion:<message id>` exists, or the pending reply's text already ends with this turn and that command's `updated_at` is at or after the message `created_at`.
- any other mode: `last_inbound_at` is at or after the message, and the staff-context line is already present.

A pure redelivery therefore does not append the customer text twice. A first attempt that dies on the conversation update leaves the message, no bot run, and a null `last_inbound_at`; the next delivery touches the conversation and schedules one run.

### 4. Low items

- `apps/zalo-bridge/src/main.ts` runs the temp-image sweep once at startup, then on the same hourly timer. A missing directory is still not an error. The sweep is not awaited, same as the timer.
- `channel-accounts.tsx`: if saving the 199k policy fails, the checkbox returns to `account.registrationPolicy` and `dirty` is cleared, so a later refresh can replace the draft.

## Files

- `apps/crm/src/worker/inbox/zalo-oa-webhook.ts`
- `apps/crm/src/worker/inbox/ingest.ts`
- `apps/crm/test/inbox-zalo-oa.test.ts`
- `apps/zalo-bridge/src/main.ts`
- `apps/crm/src/web/pages/channel-accounts.tsx`

Nothing else was edited. Nothing was committed, pushed, deployed, or run with `wrangler`. No dev server was started.

## Verify

Commands from `D:\TQD\CRM`. All exited 0.

- `pnpm -F @abm/crm test zalo-oa` — **33 passed** (3 files). Duration 5.52s. The previous run of this filter was 29 passed. The four new tests are the retried send, the staff reply "Dạ", the pending part echo, and the follow-up 503.
- `pnpm -F @abm/crm typecheck` — exit 0.
- `pnpm -F @abm/crm build` — exit 0. Vite built in 4.50s. The existing chunk-size warning remains.
- `pnpm -F @abm/crm test` — **512 passed, 2 skipped** (514). Files: 41 passed, 1 skipped (42). Duration 47.91s. The previous full run was 508 passed and 2 skipped. The difference is the four new tests. No previously passing test failed.
- `pnpm -F @abm/zalo-bridge test` — **95 passed** (9 files). Duration 1.33s.
- `pnpm -F @abm/zalo-bridge typecheck` — exit 0.

The new cases: the first `/message/cs` returns HTTP 500, the outbound row and its command are aged 3 minutes and the retry is made due, the retry's echo arrives inside the mocked fetch, `mode` stays `ai`, and no staff row is added; staff echo "Dạ" 30 seconds after "Dạ, học phí khoá là 5 triệu ạ" is stored as `staff_phone` with `mode = 'human'`; an echo equal to part 1 of a still-pending two-part reply leaves that reply `pending`, then the send loop posts both parts; both echoes of a two-part reply still leave `mode = 'ai'` and one bot row; a throw on the `last_inbound_at` update after the insert returns 503, the same event again stores exactly one message and one `run_completion` whose text is the customer text once, and a third delivery keeps that count.

The 199k checkbox was not clicked in a browser. This task forbids starting a dev server.

Status: DONE
