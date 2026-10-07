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
A scout hook blocks reading anything under node_modules, so read versions from apps/crm/package.json instead.
