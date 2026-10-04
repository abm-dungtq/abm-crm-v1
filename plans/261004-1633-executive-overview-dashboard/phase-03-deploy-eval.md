---
phase: 3
title: Deploy lên eval
status: pending
depends_on: [2]
---

# Phase 03 — Deploy lên eval (cần user đồng ý)

## Goal

Bản có trang "Toàn cảnh" chạy trên `https://abm-crm-eval.ngulongyquan.workers.dev`.

## Tasks

### Task 3.1 — Xin đồng ý

- Hỏi user bằng tiếng Việt và chờ một câu đồng ý rõ ràng.
- `--auto` không thay cho bước này.
- Không cần backup D1, vì phase này không có migration và không ghi dữ liệu.
- Verify: user đã trả lời đồng ý trong chat.

### Task 3.2 — Deploy

- Steps: `pnpm -F @abm/crm run deploy`. Không dùng `pnpm deploy`: đó là lệnh có sẵn của pnpm.
- Verify:
  - output có `Current Version ID`;
  - `curl.exe -s -o NUL -w "%{http_code}" https://abm-crm-eval.ngulongyquan.workers.dev/api/health` in `200`;
  - `curl.exe -s -o NUL -w "%{http_code}" https://abm-crm-eval.ngulongyquan.workers.dev/api/overview` in `401`, vì không có phiên đăng nhập.

### Task 3.3 — Cập nhật trạng thái

- Đặt `plan.md` và các phase thành `completed`, ghi version ID vào cuối `plan.md`.
- Commit `docs(plan): record overview board rollout on eval`.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
