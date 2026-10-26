---
name: env-running-tests
description: How to run CRM vitest from the Bash tool on this Windows machine (node missing from PATH)
metadata:
  type: reference
---

In the Bash tool, `pnpm -F @abm/crm exec vitest run <files>` fails with "'node' is not recognized" unless node is put on PATH first:
`export PATH="/c/Program Files/nodejs:$PATH" && pnpm -F @abm/crm exec vitest run test/x.test.ts` (run from D:/TQD/CRM).
Node is v24, so `node:sqlite` (DatabaseSync) works for offline simulation: apply apps/crm/migrations/*.sql in order, then load seed SQL and run invariant/cleanup queries without touching D1. Keep scratch scripts in /tmp, never in the repo.
Bash heredocs mangle backslashes/quotes; write scratch scripts with the Write tool to C:\Users\ABM\AppData\Local\Temp\... (= /tmp) and import repo .ts via `file:///D:/...` URLs (node 24 strips types).
2026-10-14: the Bash tool itself failed on every call ("/usr/bin/bash: line 213: e: command not found", profile init). The PowerShell tool worked: `cd D:\TQD\CRM; pnpm -F @abm/crm typecheck; pnpm -F @abm/crm test` (full suite ~47 s, run in background).
A scout hook blocks reading anything under node_modules, so read versions from apps/crm/package.json instead.
2026-10-26: PowerShell `pnpm -r typecheck` / `pnpm -r test` (~60 s) / `pnpm --filter @abm/crm build` all work directly. Never call `python` from Bash: it hangs on stdin (left a stray python.exe to kill). A privacy hook blocks any command whose text matches `.env`/`vars` (e.g. `.dev.vars`); `git check-ignore` on it is fine.
To see console.log from a vitest test, pass `--reporter=verbose`.
