# Phase 7: GoClaw agent `tu-van-oa`

Executor: Opus. Outside the repo. The user approved this plan, which covers creating the agent. Show the built SOUL and CAPABILITIES summary to the user before applying.

## Context

- The source content is phase 1's export, `D:\Goclaw\plans\261014-tu-van-oa\source\` (live DB copy of the OA agent: instructions, knowledge, Zalo override, 199k policy).
- The models to copy are `D:\Goclaw\plans\261013-cham-soc-hoc-vien\`:
  - `build-kb.mjs` builds the content files;
  - `apply-agent.mjs` does `POST /v1/agents` and writes the context files, then reads them back to check;
  - `run-group-tests.mjs` runs test cases and deletes the probe sessions.
- The old agent returned JSON (`reply`, `citations`, `actions`, `handoff`). GoClaw agents reply in plain text. A handoff is a last line `[HANDOFF: <lý do>]`; see `docs/integrations/goclaw-inbox-agents.md` § 1.
- The model is the one chosen in phase 2.

## Tasks

### Task 7.1: Build the content

- Steps:
  1. Write `build-agent.mjs`. Its output goes to `out/`.
  2. `SOUL.md` holds the old instructions, plus the Zalo override, plus a CRM channel section. Take the CRM section from the `sale-tu-van` SOUL: plain text with no Markdown; how to read `[Tệp đính kèm]`, `[Nhân viên đã trao đổi: ...]` and `[Ảnh không tải được]`; the HANDOFF marker rule; and the handoff cases of the old instructions.
  3. Rewrite every instruction that asks for JSON output as plain-text output. Keep the business rules unchanged.
  4. The 199k policy section is copied verbatim, including the exact program name `Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa` and the group link `https://zalo.me/g/5fsvz1vdhrewdka7uxuk`. The Worker guard checks those literally.
  5. `CAPABILITIES.md` holds the old knowledge: the 9 published docs exported to `source/knowledge/` (about 104k characters, see `source/manifest.md`). If that is too large for one context file, follow the `sale-tu-van` v8 knowledge setup in `docs/integrations/goclaw-inbox-agents.md`.
- Verify: `out/SOUL.md` contains both the exact program name and the exact link, and contains no `"reply"` JSON instruction. Check with `Select-String`; the expected counts are 1+, 1+ and 0.

### Task 7.2: Apply

- Steps: `apply-agent.mjs` creates agent `tu-van-oa`:
  - `agent_type: 'predefined'`, provider and model `deepseek-flash`;
  - tools allow `datetime` and `read_image` (without `read_image` the agent cannot see customer images);
  - memory disabled;
  - writes the context files, then reads them back.
- Verify: the script prints `ok` for each context file. `GET /v1/agents` lists `tu-van-oa`.

### Task 7.3: Test cases

- Steps:
  1. Port the old eval cases (`plans/261003-1333-chatbot-content-v4-2/content/eval-cases*.json` in the old repo) into `run-oa-tests.mjs`. Each case uses its own probe user, and the session is deleted afterwards.
  2. Add 199k cases:
     - (a) a text "em đã chuyển 199k" with the right program → the reply confirms with the exact name and link;
     - (b) a receipt image sent through WebSocket `chat.send` with `media` (as in `vision-probe-ws.mjs`) → confirms;
     - (c) the wrong amount → no confirmation;
     - (d) asking for a refund → HANDOFF.
  3. Run every reply through the CRM guard. Import it from `apps/crm/src/worker/inbox/zalo-oa-registration-guard.ts` with `tsx`, or copy the compiled function.
- Verify: the report `D:\Goclaw\plans\261014-tu-van-oa\test-results-*.md` shows all 199k cases matching their expectation, the guard throwing for none of the good confirmations, and at least 90% of the ported eval cases passing. List each failing case for Opus review.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Report to the supervisor (Opus) and the user with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output (keys redacted),
- the pass condition it failed to meet.
Never continue by self-reasoning.
