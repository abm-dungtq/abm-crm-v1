# Phase 5: Bridge sends customer images to GoClaw

Executor: Grok via Paseo. Supervisor: Opus. Needs phase 4's payload field `images: string[]` on `run_completion`.

## Verified facts (`plans/reports/opus-261014-goclaw-vision.md`)

- GoClaw's `POST /v1/chat/completions` accepts **string content only**. An `image_url` part gets 400 `INVALID_REQUEST`.
- GoClaw's WebSocket `chat.send` accepts `media: [{ path, filename }]`, where `path` is a file on the GoClaw machine. The bridge runs on the same PC, so it can write the image to a temp file.
- When an image arrives, GoClaw exposes it to the agent through the `read_image` tool. The agent must be allowed that tool (phase 7).
- The working protocol, from `C:\Users\ABM\AppData\Local\Temp\zalo-ops\vision-probe-ws.mjs`:
  1. Open `ws://<goclaw>/ws`. Frames are `{type:'req', id, method, params}`, and replies are `{id, ok, payload|error}`.
  2. `connect` with `{ token, user_id, protocolVersion: 3 }`. The `token` is the same credential the bridge already uses (`GOCLAW_API_KEY`). Opus confirms in Task 5.0 that the sidecar API key is accepted by `connect`.
  3. `chat.send` with `{ agentId, sessionKey, stream: false, message, media }`. The reply text is `payload.content`.
  
  **`sessionKey` is required.** Without it GoClaw opens a new random session for every `chat.send`, and the image turn loses the conversation. `/v1/chat/completions` with `X-GoClaw-User-Id: <userId>` uses the session `agent:<agentKey>:http:direct:<userId>` (`D:\Goclaw\source\internal\http\chat_completions.go:162`). Pass exactly that key so text and image turns share one session.

Task 5.0 result (Opus, 14/10/2026, agent `tu-van-oa`): `connect` with the bridge's `GOCLAW_API_KEY` succeeds (role `operator`). After a text turn over HTTP, a `chat.send` with that `sessionKey` and an image answered both the earlier customer code and the image text. The probe session was deleted.

## Context (verified)

- `apps/zalo-bridge/src/command-runner.ts`:
  - the `run_completion` payload schema is a zod object near line 31;
  - `completionText()` is at about line 233;
  - the GoClaw call `this.options.goclaw.complete({...})` is at about line 210.
- `apps/zalo-bridge/src/goclaw-client.ts`: `GoClawClient.complete({ agentKey, userId, text })` posts to `/chat/completions`.
- `apps/zalo-bridge/src/goclaw-session-cleanup.ts` already speaks the WebSocket RPC (connect, sessions.list, sessions.delete). Reuse its frame helper; do not write a second one.

## Files you may modify

- `apps/zalo-bridge/src/command-runner.ts`, `apps/zalo-bridge/src/goclaw-client.ts`, `apps/zalo-bridge/src/goclaw-session-cleanup.ts` (only to share the RPC helper)
- New `apps/zalo-bridge/src/image-fetch.ts`
- `apps/zalo-bridge/test/command-runner.test.ts`, new `apps/zalo-bridge/test/image-fetch.test.ts`, the GoClaw client tests

## Tasks

### Task 5.0: Confirm the protocol (Opus only, before Grok starts)

- Steps: run the probe again with the sidecar API key instead of the gateway token. Then send a text through `/v1/chat/completions` and a follow-up through `chat.send` with the same user id, and check the second reply sees the first turn.
- Verify: `connect` succeeds with the API key, and the follow-up reply references the first message. Record the result in the vision report.

### Task 5.1: Safe image download to a temp file

- Target: `image-fetch.ts` `downloadImage(url, dir, fetchImpl = fetch): Promise<string | null>`. It returns the file path.
- Steps:
  1. Accept only `https:` URLs whose host is `zdn.vn` or ends with `.zdn.vn`. Use `redirect: 'error'` and a 15 s timeout.
  2. Read at most 10 MiB, and stop reading past the cap.
  3. Check the magic bytes for JPEG, PNG, GIF or WebP.
  4. Write the bytes to `<dir>/<uuid>.<ext>`, where `dir` is `<sessionsDir>/../media-tmp`. Return the path, or null on any failure.
  5. Never log the URL query or any bytes.
  6. Add `cleanupOldImages(dir, maxAgeMs = 24h)`, called hourly from `main.ts`, so temp images do not pile up.
- Verify: `pnpm -F @abm/zalo-bridge test -- image-fetch` exits 0. The tests cover:
  - an allowed PNG is written and its path returned;
  - a wrong host returns null;
  - a redirect returns null;
  - over 10 MiB returns null;
  - an HTML body returns null;
  - cleanup removes old files only.

### Task 5.2: Image turns go through `chat.send`

- Steps:
  1. Add optional `images: z.array(z.string().url()).max(3)` to the `run_completion` payload schema.
  2. Add `GoClawClient.completeWithMedia({ agentKey, userId, text, mediaPaths })`. It:
     - connects over WebSocket with the API key and `user_id = userId`;
     - sends `chat.send { agentId: agentKey, sessionKey: \`agent:${agentKey}:http:direct:${userId}\`, stream: false, message: text, media: mediaPaths.map(p => ({ path: p, filename: basename(p) })) }`;
     - returns `payload.content`;
     - uses the same timeout and error codes as `complete()`.
  3. In the runner:
     - download the images first. If at least one image downloaded, call `completeWithMedia`; otherwise call `complete`.
     - if any image failed, append `\n[Ảnh không tải được]` to the text.
- Verify: `pnpm -F @abm/zalo-bridge test` and `pnpm -F @abm/zalo-bridge typecheck` both exit 0. New tests prove:
  - a payload with one image calls `completeWithMedia` with one path;
  - a payload without images still calls `complete`;
  - a failed download falls back to `complete` with the note.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Report to the supervisor (Opus) with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Never continue by self-reasoning. Write the report to `plans/reports/grok-261014-zalo-oa-bridge.md` ending with `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`.
