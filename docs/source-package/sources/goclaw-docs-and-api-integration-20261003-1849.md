> TÀI LIỆU NGUỒN LỊCH SỬ: Các chỉ dẫn bên dưới thuộc phiên vận hành GoClaw trước đây, không phải lệnh triển khai CRM. Trạng thái live chưa được kiểm tra trong phiên thiết kế CRM. Các đường dẫn Windows là tham chiếu tới máy GoClaw; các file đó không nằm trong ZIP này. Một định danh cá nhân đã được che.

---
handoff-version: 1
generated: 2026-10-03T11:49:00Z
generator: ak:handoff@2.0.0
focus: "viết lại tài liệu toàn bộ những gì đã làm + viết tài liệu hướng dẫn kết nối từ ứng dụng khác tới goclaw thông qua API (tham khảo document gốc của goclaw)"
workspace: D:/Goclaw (not a git repo); source repo D:/Goclaw/source
branch: main
head: 549c81f
---

# HANDOFF: GoClaw on Windows (public domain, OpenCode Go DeepSeek Flash, docs and API integration)

## Mission and current status

Focus: "viết lại tài liệu toàn bộ những gì đã làm + viết tài liệu hướng dẫn kết nối từ ứng dụng khác tới goclaw thông qua API (tham khảo document gốc của goclaw)"

Outcome: a native Windows GoClaw install reachable at https://goclaw.tqd.io.vn. Agent `tqd` runs on OpenCode Go `deepseek-flash`. Documentation describes everything done and how other applications integrate through the API.

Done:
- Public hostname `goclaw.tqd.io.vn` added to the existing tunnel `goclaw-server`. `goclaw.ngulongyquan.com` still works.
- Local provider type `opencode_go` built into `goclaw.exe`. Provider `deepseek-flash` fixed and verified. `tqd`, background workers and new-agent defaults all use `deepseek-flash`.
- Telegram session history and Claude-related memory for Telegram user [REDACTED:pii] cleared.
- Docs written: `docs/goclaw-system-overview.md` (everything done, operations, backups, rollback), `docs/application-integration-guide.md` (chat completions, responses, wake, webhooks, WebSocket, errors, security; based on upstream `source/docs`), `docs/agent-api-connection-guide.md`, `docs/README.md` index.

Remaining:
- User-supplied business info for `tqd` (name, products, prices, policies, human handoff contact). Pending since 2026-10-02.
- Optional: rotate the OpenCode API key (it was pasted in chat).
- Optional: commit or otherwise preserve the local source patches (nothing committed; user has not asked).

Urgency: none stated.

## Scope and guardrails

- Workspace: `D:\Goclaw` (Windows 11, PowerShell primary). Source repo `D:\Goclaw\source` (upstream nextlevelbuilder/goclaw).
- In scope: GoClaw config, docs under `D:/Goclaw/docs`, plans/reports under `D:/Goclaw/plans`, the local binary build.
- Out of scope: other Cloudflare tunnels (`zaplo-webhook` running as the Cloudflared Windows service, `messenger-crm`), the PostgreSQL service on port 5432, OpenClaw (npm install, unconfigured), Docker.
- Constraints: user communicates in Vietnamese. Back up the DB before any data or schema change. Markdown only under `plans/` or `docs/`. No commits unless asked; conventional commits without AI references.
- Safety boundaries:
  - Never print secrets: `data/gateway-token.txt`, `data/application-api-key.txt`, `.env.local`, `cloudflare/credentials.json`, the OpenCode key.
  - Do not use `git stash` in `source/` (an accidental stash was popped and fully recovered once).
  - Do not overwrite DNS for other hostnames. Do not create duplicate tunnels or gateways.
  - Run the start/stop scripts from PowerShell, not Bash: under Bash the `pg_ctl` wait hangs.

## Current state

- Branch: `main` (source repo).
- HEAD: `549c81fd2406875be34cec3d7274125238e7d4a0`.
- Working tree: dirty, intentional local patches, uncommitted.
- Changed files: `cmd/gateway_providers.go`, `cmd/migrate.go`, `cmd/migrate_test.go`, `internal/gateway/server.go`, `internal/http/provider_models.go`, `internal/http/providers.go`, `internal/mcp/bridge_server.go`, `internal/providers/adapter_openai.go`, `internal/providers/openai_chat.go`, `internal/providers/openai_config.go`, `internal/providers/openai_http.go`, `internal/store/provider_store.go`, `ui/web/src/constants/providers.ts`.
- Untracked files: `internal/gateway/bridge_tool_policy.go`, `internal/gateway/bridge_tool_policy_test.go`, `internal/mcp/bridge_authorization_test.go`, `internal/providers/openai_session_header.go`, `internal/providers/openai_session_header_test.go`, `internal/webui/dist/` (built UI).
- Intentional local modifications: yes. The three patches are the Windows migration path, the MCP bridge tool policy, and the `opencode_go` provider type. See `docs/goclaw-system-overview.md` §4.
- Running services (observed 18:49): GoClaw on 127.0.0.1:18790, public `/health` 200, tunnel `goclaw-server`, PostgreSQL cluster `data/postgres` on 5433, Telegram bot `@TQDOpenClaw_bot` polling.
- A stale `pg_ctl.exe` waiter (PID 4620) from a hung Bash start could not be killed (Access denied). It is harmless.
- `D:\Goclaw` itself is not a git repository.

## Decisions and rationale

| Decision | Rationale | Alternative rejected | Reference |
|---|---|---|---|
| Add `goclaw.tqd.io.vn` to the existing tunnel | Both zones are in the same Cloudflare account | Second tunnel | `plans/reports/deployment-261003-1459-goclaw-tqd-domain.md` |
| Isolated cloudflared login for the `tqd.io.vn` zone (`cloudflare/tqd-login`) | Keep the original `~/.cloudflared/cert.pem` untouched | Overwriting the global cert | same report |
| Add provider type `opencode_go` in source | OpenCode Go requires `x-opencode-session`. GoClaw had no configurable headers. Follows the `kimi_coding` pattern | Local header-injecting proxy (extra process) | `plans/reports/configuration-261003-1459-opencode-go-deepseek-flash.md` |
| Session header = `goclaw-` + SHA-256 (first 16 bytes) of the session key | Stable per-session routing without sending user IDs upstream | Raw session key, or one constant value | `internal/providers/openai_session_header.go` |
| Model `deepseek-flash` on `https://opencode.ai/zen/go/v1` | User chose it. The pay-per-use `/inference` endpoint returned 402/403 for this account | `deepseek-v4-flash` via `/inference` | config report |
| Explicit `background.provider` / `background.model` | The fallback path used a stale empty model, causing the 401 "Model  is not supported" banner | Leave fallback | config report, follow-up 15:26 |
| New-agent defaults set in both DB and `config.json` | Startup syncs `agents.defaults` from `config.json` | DB only | config report, follow-up 15:29 |
| Clear Telegram history through SQL plus restart | `sessions.reset` only cleared the cache; the DB kept 12 messages | Telegram `/reset` only | config report, follow-up 16:43 |
| Integration guide recommends Chat Completions; webhooks for external partners | Verified live. Webhook `ip_allowlist` is ineffective behind the tunnel (RemoteAddr is local) | — | `docs/application-integration-guide.md` |

## Work performed

- Cloudflare: `cloudflared tunnel --origincert <tqd cert> route dns <tunnel> goclaw.tqd.io.vn` created the CNAME. Added the ingress rule in `cloudflare/config.yml`. Added the origin in `start-goclaw.ps1`. Updated the URL message in `start-goclaw-tunnel.ps1`.
- Source:
  - Added `ProviderOpenCodeGo` with its defaults in `internal/store/provider_store.go`.
  - Added the `sessionHeader` field and `WithSessionHeader` to the OpenAI provider; header applied in `doRequest` and in the adapter `ToRequest`; context carries the session key from `Chat`/`ChatStream`.
  - Registered the type in `cmd/gateway_providers.go` and `internal/http/providers.go`; added models base and User-Agent in `internal/http/provider_models.go`; added the UI option.
  - Added tests in `openai_session_header_test.go`.
  - Rebuilt the UI (`pnpm build`, copied into `internal/webui/dist`) and the binary (`go build -tags embedui`, CGO off).
- GoClaw API:
  - Provider `deepseek-flash`: `api_base` → `https://opencode.ai/zen/go/v1`, `provider_type` → `opencode_go`.
  - Agent `tqd` → `deepseek-flash` / `deepseek-flash`.
  - System configs `background.*` and `agent.default_*` → `deepseek-flash`.
- `config.json`: `agents.defaults.provider` / `model` → `deepseek-flash`.
- DB cleanup (one transaction): Telegram session messages cleared, 1 episodic summary deleted, 6 KG entities deleted (relations cascaded), 1 entity description edited.
- Docs:
  - Created `docs/goclaw-system-overview.md`, `docs/application-integration-guide.md`, `docs/agent-api-connection-guide.md`, `docs/README.md`.
  - Updated `docs/application-api.md` and `docs/messaging-chatbot.md` (domain, provider/model).
  - Updated `README-local.md` (patch note).
  - Switched the samples (`integration-example.mjs`, `messaging-agent-client.mjs`, Postman collection) to the new domain.
- Backups under `backups/`: `goclaw-before-opencode-deepseek-20261003.dump`, `goclaw-before-opencode-go-20261003.exe`, `tqd-agent-before-opencode-20261003.json`, `config.json.bak-20261003-1529`, `goclaw-before-telegram-memory-cleanup-20261003.dump`, `cloudflare-config.yml.bak-20261003`, `start-goclaw.ps1.bak-20261003`.
- 0 redactions applied (no secret values were written into this artifact).

## Verification

| Check | Command | Outcome | When |
|---|---|---|---|
| Public health and UI | `curl https://goclaw.tqd.io.vn/health` and `/` | 200 | 2026-10-03 15:01, 18:49 |
| WebSocket via new domain | Node WS open `wss://goclaw.tqd.io.vn/ws` | open OK | 15:02 |
| Session header unit tests | `go test ./internal/providers/ -run 'SessionHeader\|ExtraHeaders\|OpenAI'` | ok | 15:16 |
| go vet | `go vet ./internal/providers/ ./internal/store/ ./internal/http/ ./cmd/` | providers/store/cmd ok; http test build fails (pre-existing) | 15:16 |
| Provider verify | `POST /v1/providers/{id}/verify {"model":"deepseek-flash"}` | `{"valid":true}` | 15:19 |
| Chat completions (non-stream + SSE) | public API, app key | 200, content + `[DONE]` | 15:19, 15:20 |
| Background workers | log after a test chat | episodic summary + semantic extract, no 401 | 15:27 |
| Defaults persisted after restart | `GET /v1/system-configs` | all four keys = `deepseek-flash`, no alert key | 15:31 |
| Telegram cleanup | psql counts after restart | 0 messages, 0 Claude rows for user | 16:45 |
| Integration guide endpoints | `/docs`, `/v1/openapi.json`, `/v1/sessions`, `/v1/responses` (with `messages`), `/v1/agents/tqd/wake`, WS `chat.send`, `/v1/webhooks` (app key → 403), `/v1/webhooks/llm` no auth → 401 | all as documented | 18:4x |
| Doc relative links | shell link check over `docs/*.md` | all exist | 18:49 |

Not run:
- Full `go test ./...`: known unrelated Windows and upstream failures (skill path tests, the `internal/http` mock missing `Upsert`, a POSIX fixture in `cmd`).
- Creating a new agent in the UI to confirm defaults: avoided creating test data.
- Webhook create/call end-to-end: would mint a secret; documented from upstream docs instead.
- A Telegram message after cleanup: requires the user's Telegram account.

## Open risks and blockers

- Type: risk. Owner: user. Impact: the OpenCode key was exposed in chat. Rotate it in the OpenCode console, then paste the new key into provider `deepseek-flash`.
- Type: risk. Owner: maintainer. Impact: the local patches are uncommitted. An upstream pull or rebuild without them breaks `deepseek-flash` (`missing x-opencode-session`) and Windows migrations.
- Type: risk. Owner: user. Impact: the rate limit (`gateway.rate_limit_rpm`=20) is per API key on chat completions. A shared app key caps every end user of that app together.
- Type: risk. Owner: unknown. Impact: OpenCode Go usage caps (5-hour, weekly, monthly) could cause 500s for chat and background workers.
- Type: question. Owner: user. Impact: business information for `tqd` is still missing, so the bot cannot answer pricing or policy questions.
- Type: risk. Owner: unknown. Impact: the WS `chat.send` payload includes model `thinking`. Integrators must not display it.
- Type: risk. Owner: user. Impact: no auto-start after reboot; the PC must stay on.

## Exact next actions

1. **First safe step**: read `docs/goclaw-system-overview.md` and check that it matches live state: `GET http://127.0.0.1:18790/health`, `git -C D:/Goclaw/source status --short`, and `GET /v1/system-configs` with the gateway token (do not print it).
2. Ask the user whether to rotate the OpenCode key now. If yes, update provider `deepseek-flash` via the UI or `PUT /v1/providers/{id}`, then `POST /v1/providers/{id}/verify`.
3. Ask the user whether to preserve the local patches in a git branch or commit (conventional commit, no AI references). Do not commit without approval.
4. When the user supplies business info, update `tqd` context files following `docs/messaging-chatbot.md`, after a DB backup.
5. If an external partner needs access, create a dedicated API key or an `llm` webhook with `require_hmac: true`, as described in `docs/application-integration-guide.md` §3 and §7.

## Source pointers

- `docs/README.md`: docs index.
- `docs/goclaw-system-overview.md`: everything done, operations, backups, rollback.
- `docs/application-integration-guide.md`: API integration guide.
- `docs/agent-api-connection-guide.md`, `docs/application-api.md`, `docs/messaging-chatbot.md`.
- `README-local.md`: install and rebuild.
- `plans/reports/configuration-261003-1459-opencode-go-deepseek-flash.md`, `plans/reports/deployment-261003-1459-goclaw-tqd-domain.md`, `plans/reports/deployment-261002-2142-cloudflare-api.md`, `plans/reports/configuration-261002-tqd-customer-service.md`.
- `cloudflare/config.yml`, `start-goclaw.ps1`, `stop-goclaw.ps1`, `start-goclaw-tunnel.ps1`, `config.json`.
- `source/internal/providers/openai_session_header.go`, `source/cmd/gateway_providers.go`, `source/internal/http/providers.go`.
- Upstream docs: `source/docs/18-http-api.md`, `source/docs/20-api-keys-auth.md`, `source/docs/webhooks.md`, `source/docs/19-websocket-rpc.md`, `source/api-reference.md`.
- https://opencode.ai/docs/go (OpenCode Go endpoints and header requirements). https://github.com/nextlevelbuilder/goclaw.
