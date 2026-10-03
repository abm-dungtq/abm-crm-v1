---
phase: 1
title: "Khởi tạo repo và workspace"
status: pending
priority: P1
effort: "0.5 ngày"
dependencies: []
---

# Phase 01: Khởi tạo repo và workspace

## Goal

Repo `D:/TQD/CRM` có cấu trúc workspace pnpm, tài liệu nguồn nằm trong `docs/`, quy ước kỹ thuật cơ bản, và commit đầu tiên không chứa secret.

## Context

- Git đã `init` trên nhánh `main`, chưa có commit. Hiện có `.claude/`, `.orca/`, `plans/`.
- Gói nguồn: `D:/TQD/CRM/.orca/drops/abm-agentic-crm-cook-20261003-201748.zip`.
- Công cụ có sẵn: Node 24, pnpm 12, wrangler 4.x, git.
- Chỉ tạo Markdown trong `docs/` hoặc `plans/`.

## Files to Create / Modify

- Create: `D:/TQD/CRM/.gitignore`
- Create: `D:/TQD/CRM/package.json`
- Create: `D:/TQD/CRM/pnpm-workspace.yaml`
- Create: `D:/TQD/CRM/tsconfig.base.json`
- Create: `D:/TQD/CRM/README.md`
- Create: `D:/TQD/CRM/docs/README.md`
- Create: `D:/TQD/CRM/docs/source-package/` (nội dung giải nén từ zip)
- Create: `D:/TQD/CRM/docs/engineering/repository-structure.md`
- Create: `D:/TQD/CRM/docs/engineering/coding-conventions.md`

## Tasks

### Task 1.1 — Giải nén gói nguồn vào docs
- Goal: PRD, thiết kế, phản biện, GoClaw handoff nằm trong `docs/source-package/`.
- Steps:
  1. Chạy `cd /d/TQD/CRM && mkdir -p docs/source-package && unzip -o .orca/drops/abm-agentic-crm-cook-20261003-201748.zip -d .orca/extract` (`.orca/` sẽ bị gitignore).
  2. Chạy `cp -r .orca/extract/abm-agentic-crm-cook-20261003-201748/. docs/source-package/`.
  3. Kiểm hash: với mỗi file trong `docs/source-package/manifest.json`, so `sha256sum` với giá trị `sha256`.
- Success criteria: 7 file trong manifest có hash khớp (manifest.json không tự liệt kê chính nó).
- Verify: `cd /d/TQD/CRM/docs/source-package && node -e "const m=require('./manifest.json');const c=require('crypto'),f=require('fs');let bad=m.files.filter(x=>c.createHash('sha256').update(f.readFileSync(x.path)).digest('hex')!==x.sha256);console.log(bad.length?'MISMATCH '+bad.map(x=>x.path):'HASH_OK')"` in ra `HASH_OK`.

### Task 1.2 — .gitignore
- Goal: không commit secret, build output, dữ liệu local, zip gốc.
- Steps: tạo `.gitignore` gồm các dòng: `node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`, `.dev.vars.*`, `.env`, `.env.*`, `*.pem`, `*.key`, `coverage/`, `.orca/`, `*.sqlite`, `*.sqlite3`, `exports/`.
- Success criteria: `git status --short` không liệt kê `.orca/`.
- Verify: `cd /d/TQD/CRM && git status --short | grep -c '.orca'` in ra `0`.

### Task 1.3 — Workspace pnpm
- Goal: root workspace sẵn cho `apps/*`, `packages/*`, `poc/*`.
- Steps:
  1. `package.json`: `{"name":"abm-crm","private":true,"packageManager":"pnpm@<version từ pnpm -v>","engines":{"node":">=22"},"scripts":{"test":"pnpm -r test","typecheck":"pnpm -r typecheck"}}`.
  2. `pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*", "poc/*"]`.
  3. `tsconfig.base.json`: `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `noUncheckedIndexedAccess: true`, `skipLibCheck: true`.
  4. Chạy `pnpm install`.
- Success criteria: `pnpm install` thành công và tạo `pnpm-lock.yaml`.
- Verify: `cd /d/TQD/CRM && pnpm install && test -f pnpm-lock.yaml && echo LOCK_OK` in ra `LOCK_OK`.

### Task 1.4 — Tài liệu cấu trúc và quy ước
- Goal: executor sau biết đặt code ở đâu và theo quy ước nào.
- Steps:
  1. `docs/engineering/repository-structure.md` mô tả: `apps/web` (React PWA), `apps/api` (Hono Worker: REST + MCP), `packages/core` (domain, command/query, policy, approval, audit), `packages/contracts` (Zod: schema, scope, risk level mỗi command), `poc/*` (thử nghiệm, xóa sau MVP0), `docs/` (sản phẩm, kiến trúc, ADR, security, integrations), `plans/`. Ghi rõ: MCP schema sinh từ `packages/contracts`, không viết validator thứ hai.
  2. `docs/engineering/coding-conventions.md`: TypeScript strict; tên file kebab-case; migration D1 đánh số `NNNN_mo-ta.sql`, không sửa migration đã apply; mỗi command ghi audit + outbox trong cùng batch; không log secret/PII; conventional commits không nhắc AI.
  3. `README.md` root: mục tiêu dự án 3 câu và link `docs/README.md`.
  4. `docs/README.md`: mục lục link tới `source-package/README.md`, `engineering/`, và các thư mục sẽ có (`decisions/`, `architecture/`, `adr/`, `security/`, `integrations/`).
- Success criteria: bốn file tồn tại, link tương đối hợp lệ.
- Verify: `cd /d/TQD/CRM && for f in README.md docs/README.md docs/engineering/repository-structure.md docs/engineering/coding-conventions.md; do test -s $f || echo MISSING $f; done; echo DONE` chỉ in `DONE`.

### Task 1.5 — Commit đầu tiên
- Goal: commit baseline sạch.
- Steps:
  1. `git add -A && git status --short` và đọc danh sách; không được có `.dev.vars`, `.env`, `.orca/`.
  2. `git commit -m "chore: bootstrap repository and source package"` (thêm attribution theo quy định phiên).
- Success criteria: commit tồn tại trên `main`.
- Verify: `cd /d/TQD/CRM && git log --oneline | wc -l` in ra số ≥ 1 và `git ls-files | grep -E '\.env|\.dev\.vars|\.orca' | wc -l` in ra `0`.

## Risk

Commit nhầm file nhạy cảm. Giảm bằng `.gitignore` trước `git add` và kiểm danh sách file.

## Rollback

Trước khi push không có ảnh hưởng ngoài máy: `git reset --soft HEAD~1` nếu commit sai.

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
