# Phase 2: Can GoClaw read images through chat completions?

Executor: Opus. No GoClaw config change: test calls only, on a throwaway agent session.

## Context

- GoClaw: `http://127.0.0.1:18790`, OpenAI-compatible `POST /v1/chat/completions`. The sidecar API key lives in the bridge `.env` (`GOCLAW_API_KEY`); never print it.
- The bridge sends text only today (`apps/zalo-bridge/src/goclaw-client.ts`, `CompletionRequest`).
- The old app read receipts with DeepSeek `deepseek-flash` vision, sending a base64 data URL (`src/lib/deepseek.ts`, `src/lib/agent-context.ts` in the old repo).

## Tasks

### Task 2.1: Image probe

- Steps:
  1. Write `C:\Users\ABM\AppData\Local\Temp\zalo-ops\vision-probe.mjs`. It sends to agent `sale-tu-van`:
     - with user id `vision-probe:<uuid>`;
     - one user message whose content is `[{type:'text', text:'Ảnh này có chữ gì? Trả lời đúng chữ đó.'}, {type:'image_url', image_url:{url:'data:image/png;base64,...'}}]`.
  2. Generate the PNG in the script: a 300×80 image with the black text `ABM 199000`. Use the `pngjs`-free approach of drawing via an SVG→PNG step, or a small checked-in fixture under `C:\Users\ABM\AppData\Local\Temp\zalo-ops\`.
  3. Delete the probe session afterwards, the same way `run-kb-tests.mjs` does.
- Verify: the reply contains `199000`. If it does not, or GoClaw returns 4xx, record the status and body (no key) and go to Task 2.2.

### Task 2.2: Choose the vision path (only if 2.1 fails)

- Steps:
  1. List the GoClaw providers and models (read only). Find one with vision, for example a DeepSeek-direct or OpenAI-compatible vision model.
  2. Record the options in `plans/reports/opus-261014-goclaw-vision.md`.
  3. Ask the user which model `tu-van-oa` uses. This is a GoClaw config change and needs consent.
- Verify: the report exists, and the user's choice is written in it.

## Output

`plans/reports/opus-261014-goclaw-vision.md` holds:
- the result;
- the exact content-part shape GoClaw accepts;
- the model for `tu-van-oa`.

Phase 5 uses that shape.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Report to the supervisor (Opus) with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output (secrets redacted),
- the pass condition it failed to meet.
Never continue by self-reasoning.
