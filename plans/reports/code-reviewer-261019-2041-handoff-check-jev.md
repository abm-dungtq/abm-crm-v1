# Code review: handoff check on customer turns (rules + TypeSafe Jev)

Date: 2026-10-19. Reviewer: code-reviewer. Scope: uncommitted change only (LMS work in the tree ignored).

## Scope
- `apps/crm/src/worker/inbox/decision-layer.ts` (new, 171 LOC)
- `apps/crm/src/worker/inbox/conversation-flow.ts` (scheduleCompletion SQL, `customerText`, `checkHandoff`, `applyCompletionResult`)
- `apps/crm/src/worker/env.ts`, `apps/crm/wrangler.jsonc`, `apps/crm/vitest.config.ts`
- `apps/crm/test/inbox-handoff-check.test.ts` (new), `apps/crm/test/inbox-flow.test.ts`
- `apps/crm/scripts/eval-handoff-check.mjs`, `apps/crm/scripts/fixtures/handoff-labels.jsonl` (new)
- Also touched by the change: `docs/integrations/goclaw-inbox-agents.md` (+19 lines)

## Verification run
- `npx vitest run test/inbox-handoff-check.test.ts test/inbox-flow.test.ts`: 29/29 pass.
- `npx vitest run test/inbox`: 16 files, 218/218 pass.
- `tsc -p tsconfig.worker.json --noEmit`: clean.
- Eval script loads under Node 24 (type stripping) and stops at the `TYPESAFE_API_KEY is not set` guard. I did not call the API.
- I probed the rules and the masking locally against `decision-layer.ts` with hand-written strings. The probe made no network calls.

## Verified correct (no action)
- **scheduleCompletion SQL bind order.** OA branch placeholders run `$.text ?` -> `json(?)` -> APPEND `?` -> `next_run_at` -> `updated_at` -> `conversation_id`, and the binds are `turn, images, customerText, runAt, nowIso, conversationId`. The non-OA branch is the same without images. Inside `json_set`, `json_extract(payload_json,'$.customerText')` reads the row's old value, so appending is correct.
- **Double handoff and duplicate Lark notices.** With a marker, `botHandedOff=true` so `applied=false`, and only one `send_lark` is queued (the test covers this). The check calls `handoff(..., {onlyFromAi:true})`, so if staff took over during the Jev wait, `changes !== 1` and nothing happens: no Lark notice and no audit.
- **Mode env during the check.** `HANDOFF_NET_MODE` is read once per call and is a deploy-time var, so it cannot change mid-request. Conversation mode changes are covered by `onlyFromAi`.
- **Bridge retry.** `completeCommand` runs before `applyCompletionResult` (bridge-routes.ts:215), so a retried result is `ignored` and cannot double-apply. The bridge client timeout is 30 s (`apps/zalo-bridge/src/crm-client.ts:46`), far above 1.5 s.
- **Secrets.** The key appears only in the `Authorization` header (decision-layer.ts:115). Errors are mapped to fixed codes (`http_529`, `timeout`, `network`, ...). `console.error` logs only `error.message` of D1/handoff failures. The audit row stores no text and no key. The vitest bindings set the key to `''`, so tests cannot reach the network even though `.dev.vars` is loaded.
- **Audit visibility.** `AUDIT_SELECT` (queries.ts:340) inner-joins `lead`, so `entity='conversation'` rows never appear in the business audit UI. The overview counters filter `actor_kind='agent'`, and these rows use `'system'`.

## Findings (ranked)

### High

**H1. The Jev call delays Zalo OA and Facebook replies to the customer, even in shadow mode** (conversation-flow.ts:571-583, bridge-routes.ts:224-226)
- Cause: OA and Messenger sends are `target: 'worker'` (conversation-flow.ts:133-134). They only go out when `processWorkerCommands` is kicked at bridge-routes.ts:226, after `applyCompletionResult` returns. `checkHandoff` is awaited inside it: Jev takes up to 1500 ms, plus two D1 writes.
- Scenario: deploy with the committed defaults (`HANDOFF_NET_MODE=shadow`, `JEV_INTENT_MODE=shadow`) and the secret set. Every OA/FB bot reply now waits for TypeSafe before it is sent. When TypeSafe is slow, that is a 1.5 s added delay on every turn, and this is in shadow mode, where the result is thrown away. Personal Zalo (`send_zalo`, target bridge) is not affected because the bridge polls the queued send on its own.
- Fix (either):
  - Run the check off the response path: return `customerText` and `botHandedOff` to the route and call `background(c, checkHandoff(...).then(o => o.workerCommandQueued && processWorkerCommands(env)))`.
  - Or kick `processWorkerCommands` for the queued reply before awaiting the check.
- Add a test that asserts the OA send command is processed while a Jev fetch mock is still pending.

**H2. Rule false positives would hand off ordinary pre-sales chats in active mode, and Jev cannot overrule a rule hit** (decision-layer.ts:50-59, 157-158)
- These results come from running `matchHandoffRule`:
  - `"Chính sách hoàn tiền thế nào ạ"`, `"Có cam kết hoàn lại tiền không"`, `"Bao giờ thì hoàn tiền nếu lớp huỷ"` -> `complaint`. These are common pre-sales FAQ questions. Lark says "Khách khiếu nại" (customer complaint) and the bot goes silent.
  - `"Bên mình có lừa đảo không vậy"`, `"Sợ lừa đảo quá"` -> `complaint`. This is a sales objection the bot is meant to handle.
  - `"Có xuất hoá đơn không, cần bill cho công ty"`, `"Gửi em bill để em check"` -> `payment_done` (the bare `\bbill\b` at line 53).
  - `"Nếu em đã chuyển khoản thì bao lâu có link"` (conditional) and `"Em đã thanh toán chưa nhỉ, kiểm tra giúp"` -> `payment_done`.
  - `"Em đã đóng tiền tháng trước, giờ muốn hỏi khoá mới"` -> `payment_done`.
  - `"Có phải người thật không hay bot"` -> `wants_human`. This is a frequent probe. On a personal Zalo nick, a handoff here is a strong tell.
  - `"Chị muốn gặp admin nhóm"` -> `wants_human`.
- Scenario: active mode at 22:00 with no one on duty. A prospect asks about the refund policy. The bot answers, then the conversation flips to `human` with reason "Khách khiếu nại". Every later customer message gets no bot reply until a person picks it up, and the Lark notice gives staff the wrong label.
- Why it is worse here: rules decide before Jev and regardless of `JEV_INTENT_MODE`, so the comment "a false hit hands a conversation off" (line 48) describes exactly this exposure. The fixture file (36 lines) has none of these hard negatives, so the eval script cannot show the problem.
- Fix:
  - Narrow `complaint` to explicit demands (`(doi|yeu cau|muon) (hoan|tra lai) tien`, `khieu nai`). Move `lua dao` and refund-policy questions to Jev.
  - Drop bare `bill` or require `(gui|chup|anh) bill`.
  - Reject a match when a `neu|se|mai|chua|chua nhi` qualifier appears within a few tokens before it.
  - Remove `nguoi that` alone (keep `gap/noi chuyen voi nguoi that`).
  - Add these strings as `none` labels in `handoff-labels.jsonl` and as `toBeNull()` cases in the rule test.

### Medium

**M1. PII masking gaps** (decision-layer.ts:72-77). Verified unmasked outputs:
- `STK 1903,6688,9999`, `stk: 1903_6688_9999`: comma and underscore separators are not in `[\d\s.-]`.
- `sdt 0912/345/678`: slash separator.
- Full-width digits `０９１２３４５６７８`: `\d` is ASCII only.
- Names, street addresses and Facebook profile URLs pass through. The docs acknowledge this.

Scenario: a customer pastes the bank account they paid from as `1903,6688,9999`, and it is sent to TypeSafe in clear, in shadow mode too. Fix: add `,_/` to the separator class, NFKC-normalise first (`text.normalize('NFKC')`), and add those cases to the masking test.

**M2. `applied` is written before the handoff and can be false-positive in the audit** (conversation-flow.ts:600-605)
- What happens: the audit says `applied: true` before `handoff()` runs. If the conversation left `ai` meanwhile, `onlyFromAi` makes it a no-op. If `handoff` throws (D1, `autoAssignOnHandoff`, `enqueueCommand`), the error is swallowed at line 607 and the row still says applied.
- Why it matters: shadow/active comparison is the stated purpose of these rows ("So sánh với lý do HANDOFF của bot"), so they over-count.
- A partial handoff failure is also swallowed after `mode='human'` is set but before `send_lark` is enqueued. Staff get no Lark notice, and nothing propagates to the bridge.
- Fix: write the audit after `handoff`, with `applied: outcome.workerCommandQueued` (true only when the guarded UPDATE changed a row), or have `handoff` return a `handedOff` flag. Consider letting handoff errors propagate like the marker path does instead of catch-and-swallow.

**M3. Jev is called even when its answer cannot matter** (conversation-flow.ts:581, decision-layer.ts:159-161)
- Cases: when `botHandedOff=true` in active mode, and on attachment-only turns (`customerText === '[Tệp đính kèm]'`, conversation-flow.ts:231).
- Cost: each case spends a paid call, sends data out of the CRM and adds latency (see H1).
- Attachment-only turns: a payment receipt sent as an image is the most common "đã CK" signal, and neither layer can see it, so the Jev call buys nothing.
- Fix:
  - Skip Jev when `mode==='active' && botHandedOff`, unless shadow evaluation of that case is wanted. If it is, state that.
  - Skip both layers when `customerText` is only `ATTACHMENT_ONLY_TEXT` lines.

**M4. No test covers the OA branch of the new SQL** (conversation-flow.ts:236-243). The handoff-check tests only use `channel='zalo'`. The `json(?)` + APPEND bind order is right today (verified by reading), but a later reorder would silently swap `images` and `customerText`. Add one OA extension test asserting both `images` and `customerText`.

### Low

**L1. `choice in HANDOFF_CATEGORIES` walks the prototype** (decision-layer.ts:165). If Jev returns `"toString"` or `"constructor"`, the choice counts. `HANDOFF_CATEGORIES[...].reason` is then `undefined`, the D1 bind throws, and the error is swallowed after the audit says `applied: true`. This is unlikely with choice-constrained output. Use `Object.hasOwn(HANDOFF_CATEGORIES, choice)`. The eval script (line 26) uses `choice !== 'none'` instead, so it can disagree with the runtime for an unknown label. Use the same predicate in both.

**L2. No length cap on `customerText`** (conversation-flow.ts:220, decision-layer.ts:118). A long burst is appended without limit into the payload and into the Jev `state`, so input tokens and cost are unbounded. Rules also run over the whole burst, which widens the H2 matches. Clip, for example to the last 1000 chars, before sending to Jev.

**L3. Breaker recovery behaviour** (decision-layer.ts:102-110).
- After 30 s open, failures reset to 0, so a still-down Jev costs 5 more full 1.5 s timeouts per isolate before it reopens.
- `res.json()` on a non-JSON 200 is reported as `network`, not `bad_response`.

Acceptable as is. Consider reopening on the first failure after a half-open.

**L4. Transition gap.** A pending reply queued before deploy has no `customerText`. If it is extended after deploy, `COALESCE(...,'')` stores only the newer lines (conversation-flow.ts:220). If it is not extended, the check is skipped. This only affects the deploy minute. Note it in the release notes, no code change.

**L5. Audit volume.** Shadow mode writes one `audit_log` row (about 300 B) per direct bot reply, with no retention job for `entity='conversation'`. This is fine at current scale. Add a retention or prune step before running this for months, or log to Workers Analytics Engine instead.

## Edge cases found while scouting
- Concurrent results (command 1 claimed, command 2 created by a later message): `onlyFromAi` serialises them. A residual race remains: a marker handoff, which has no `onlyFromAi`, can still send a second Lark notice if it loads the conversation before the check's UPDATE. This race already existed, but the Jev await keeps result 1's request open longer.
- `bot_switch`/`bot_enabled` turned off during the Jev wait does not stop the check's handoff, because only `mode='ai'` is guarded. This is probably the intended outcome (people get the conversation).
- Group conversations return early at conversation-flow.ts:546, so the check never runs for them. That is correct.

## Recommended actions
1. H1: move `checkHandoff` off the response path, or kick worker commands first, before deploying with shadow plus a key set.
2. H2: tighten the RULES and add hard-negative fixtures and tests before any switch to `active`.
3. M1: widen the masking separators and NFKC-normalise.
4. M2: audit `applied` from the actual handoff outcome.
5. M3 and M4: skip pointless Jev calls; add the OA SQL test.
6. L1: `Object.hasOwn`.

## Metrics
- Type check: clean (worker tsconfig).
- Tests: 218/218 inbox tests pass. New tests behave like real tests (they assert DB state, the fetch body and the audit rows), but they lack hard-negative and OA coverage.
- Lint: not run (no lint script in `apps/crm/package.json`).

## Unresolved questions
- Data protection: shadow mode sends masked customer text to TypeSafe for every turn, and the docs say TypeSafe commits to no retention only on the enterprise plan. Has a cross-border transfer and impact assessment under Vietnam Decree 13/2023 been accepted, or should Jev stay `off` until it has? This is a business decision for the user.
- Should a "are you a real person?" probe really hand off on a personal Zalo nick, given the existing decision that the bot never reveals a handoff?

Status: DONE_WITH_CONCERNS
Summary: The SQL bind order, the double-handoff guard and secret handling are correct, and the tests and typecheck pass. Two problems block `active` and need a decision before shadow goes live: Jev latency is on the OA/Facebook reply path even in shadow mode, and the rules hand off common pre-sales questions (refund policy, scam worries, "bill", conditional payment phrasing).
