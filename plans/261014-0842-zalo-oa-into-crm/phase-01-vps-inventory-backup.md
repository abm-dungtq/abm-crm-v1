# Phase 1: VPS access, inventory, backup, old agent content

Executor: Opus. Read-only on the VPS except for the backup file. Never print secrets, tokens or customer data; print counts, names of keys, and file paths only.

## Context

- VPS `root@180.93.50.84`. The app lives in `/root/webapp-chatbot`. Its DB is `data/webapp.db` (SQLite, WAL). The systemd unit is `webapp-chatbot`. Caddy serves `chatbot.abmedu.vn` and proxies to `:8787`. Source: `docs/deployment.md` in the old repo.
- Old repo clone (read only): `C:\Users\ABM\AppData\Local\Temp\webapp-chatbot-src`. The schema reference is `docs/vps-schema-snapshot.sql`.
- SSH key on this PC: `C:\Users\ABM\.ssh\abm_vps_ed25519`. The user must first append its `.pub` line to `/root/.ssh/authorized_keys` on the VPS.

## Tasks

### Task 1.1: SSH works

- Steps: run `ssh -i C:\Users\ABM\.ssh\abm_vps_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new root@180.93.50.84 "hostname; systemctl is-active webapp-chatbot caddy"`.
- Verify: exit 0, and the output has two lines `active`.

### Task 1.2: Backup the old DB

- Steps:
  1. On the VPS, run `sqlite3 /root/webapp-chatbot/data/webapp.db ".backup /root/pre-oa-to-crm-$(date -u +%Y%m%dT%H%M%SZ).db"`.
  2. Run `PRAGMA integrity_check` on the backup.
  3. `scp` the backup to `D:\TQD\CRM\exports\` (git-ignored).
- Verify: `integrity_check` prints `ok`, and the local file exists with size > 0.

### Task 1.3: Inventory (record in `plans/reports/vps-inventory-261014.md`, no secrets)

Record each item:

1. The Caddyfile path and the full site block for `chatbot.abmedu.vn`. Paste it with any secrets removed.
2. The Zalo OA channel accounts:
   - for each: id, OA id, display name, status;
   - whether its override contains the line `registration_policy: abm-agent-199k-v1`.
3. Counts per OA:
   - Zalo conversations, messages and customer profiles;
   - the oldest and newest message time.
4. How the app stores settings and secrets:
   - the table and key names for `zalo_app_id`, `zalo_app_secret` and `zalo_oa_secret`, and the OA access/refresh tokens;
   - the encryption helper used (`src/lib/crypto.ts`).
5. How to stop the old app answering the OA without touching Facebook. Find the exact switch: channel account status, the agent toggle per channel account, or a setting. Then the token refresh: name the cron function (`refreshZaloTokenIfNeeded`) and how to disable it for the OA.
6. The tables and columns that hold OA history: conversations, messages (direction, source, external ids, attachments) and customer profile (name, avatar). Compare them with `docs/vps-schema-snapshot.sql`.

- Verify: the report file exists and has a section for each of the six items.

### Task 1.4: Export the live agent content for the OA

- Steps:
  1. With a read-only `sqlite3` query, export the effective agent content for the OA channel account(s) as files into `D:\Goclaw\plans\261014-tu-van-oa\source\`:
     - base instructions;
     - knowledge;
     - the channel override (Zalo override);
     - the 199k policy text.
  2. Prefer the DB copy over the repo files, because the DB holds what runs live.
  3. Write `source/manifest.md`: each file, its source table and row, size, and last updated time.
- Verify: `source/manifest.md` exists and lists at least the instructions file and the Zalo override file.

### Task 1.5: Move the secrets into the Worker without printing them

- Steps:
  1. On the VPS, write a one-off `bun` script under `/root/oa-export/`. It decrypts `zalo_app_id`, `zalo_app_secret` and `zalo_oa_secret` with the app's own crypto helper and `ENCRYPTION_KEY` from `.env`.
  2. Pipe each value over ssh straight into `pnpm exec wrangler secret put <NAME>` (stdin) in `D:\TQD\CRM\apps\crm`. The names are `ZALO_OA_APP_ID`, `ZALO_OA_APP_SECRET` and `ZALO_OA_WEBHOOK_SECRET`.
  3. Generate `ZALO_OA_TOKEN_KEY` locally as 32 random bytes in base64, and pipe it into `wrangler secret put` the same way.
  4. Delete `/root/oa-export/`.
- Do this only in phase 9, step 2, after the user has seen the plan. In phase 1, just prove the script prints the **lengths** of the three values.
- Verify: phase 1 output is three positive integers. Phase 9: `wrangler secret list` shows the four names.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Report to the supervisor (Opus) with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output (secrets redacted),
- the pass condition it failed to meet.
Never continue by self-reasoning.
