# Phase 9: Cut over to the CRM and watch

Executor: Opus. Phases 1–8 must be done, and their tests and reviews passed. Every step that changes something has a check before the next step. Tell the user the start time: OA replies pause for a few minutes during step 5.

## Order (mandatory)

1. **Final checks.** All of these exit 0:
   - `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck`, `pnpm -F @abm/crm build`
   - `pnpm -F @abm/zalo-bridge test`, `pnpm -F @abm/zalo-bridge typecheck`
   
   Then a code-reviewer agent reviews the whole diff, and every High finding is fixed.
2. **Backups.**
   - D1: `wrangler d1 export abm-crm-eval --remote --output exports/abm-crm-eval-before-0020-<stamp>.sql`. Record the Time Travel bookmark.
   - VPS: `sqlite3 .backup` and `integrity_check` `ok` (phase 1 Task 1.2 again, fresh).
   - Copy the Caddyfile to `<Caddyfile>.bak-<stamp>`.
3. **Secrets, migration, deploy.**
   - Put the four secrets (phase 1 Task 1.5). `wrangler secret list` shows them.
   - `wrangler d1 migrations apply abm-crm-eval --remote` applies only `0020_zalo_oa.sql`.
   - `pnpm -F @abm/crm run deploy`, then record the version id.
   - Restart the bridge (kill the "ABM Zalo Bridge" powershell tree, then `Start-ScheduledTask`). Check `bridge.log` for `account.reconnected`.
4. **OAuth callback first.**
   - Add only the callback block to the `chatbot.abmedu.vn` site in Caddy:
     ```caddy
     handle /api/zalo/oauth/callback {
       rewrite * /api/channels/zalo-oa/oauth/callback?{query}
       reverse_proxy https://abm-crm-eval.ngulongyquan.workers.dev {
         header_up Host {upstream_hostport}
       }
     }
     ```
   - Run `caddy validate --config <Caddyfile>`, then `systemctl reload caddy`.
   - The user (admin) clicks `Kết nối Zalo OA` on `/channel-accounts` and allows it in Zalo.
   - Check: the page shows `Đã kết nối`, `zalo_oa_credential` has one row per OA, and `channel_account.agent_key = 'tu-van-oa'`. For each OA that had the marker in phase 1's inventory, turn on `Tự xác nhận đăng ký 199k` with `Link nhóm Zalo` = `https://zalo.me/g/wevfd8uqwhqnrkhiyl0e` on `/channel-accounts` (the `PUT /api/inbox/accounts/:id/registration-policy` route validates the link). Do not set it by SQL.
5. **History import** (phase 8 Task 8.3, remote). Then compare the counts.
6. **Stop the old app answering the OA.** Use the exact switch from phase 1 inventory item 5, for the OA only (Facebook untouched). Disable its OA token refresh the same way.
7. **Switch the webhook.** Add to the same site block, before the app's catch-all:
   ```caddy
   handle /webhooks/zalo {
     rewrite * /api/channels/zalo-oa/webhook
     reverse_proxy https://abm-crm-eval.ngulongyquan.workers.dev {
       header_up Host {upstream_hostport}
     }
   }
   ```
   Validate, then reload. Check: `curl -s -o /dev/null -w "%{http_code}" -X POST https://chatbot.abmedu.vn/webhooks/zalo -d '{}'` prints `400` (the body is missing `app_id`). The Worker answers, not the old app; confirm in `wrangler tail` or the Worker logs.
8. **Live test** (the user's personal Zalo messages the OA):
   - a text gets a reply in under 1 minute, and it is visible in CRM Inbox with label `Zalo OA`;
   - an image gets a reply that mentions the image content;
   - staff reply from CRM is received;
   - staff typing in the Zalo OA app switches the conversation to `human` with no bot reply;
   - a 199k receipt test confirms with the right name and link (only on an OA with the policy on);
   - the old app's DB has no new outbound OA message after step 7: `SELECT COUNT(*)` of out messages for the OA with time > the cutover time is 0.
9. **Watch for 24 h.** Check these:
   - `channel_command` failed rows for `send_zalo_oa`;
   - `channel_account.status`, which stays `connected`;
   - a token refresh happened (the `zalo_oa_credential.version` increased).
10. **Docs.**
    - Add a `zalo-oa` section to `docs/integrations/goclaw-inbox-agents.md` (agent `tu-van-oa`, guard, images) and an OA routing note to ADR-009.
    - Add a short runbook, `docs/integrations/zalo-oa.md`: Caddy blocks, secrets, reconnect, rollback.
    - Update the plan status. Commit only when the user asks.

## Rollback

- **Fast, no deploy:**
  1. Remove the `/webhooks/zalo` Caddy block and reload. Zalo traffic goes back to the old app.
  2. Re-enable the OA in the old app.
  3. If the old app's token was invalidated by the new authorization, click `Kết nối lại` in the old app's settings. Its callback path needs the Caddy callback block removed first.
- **Worker:** `wrangler rollback` to the version recorded in step 3. Stop the bridge first, or keep the bridge on the new code; the new Worker stays backward compatible with the bridge.
- **Data:** migration 0020 is forward only. Restore the D1 Time Travel bookmark only with user consent and only before Zalo traffic reached the Worker.

## Failure Protocol

If any check in this phase does not meet its stated pass condition, STOP.
Do not improvise a fix, retry blindly, or reason around the failure.
If customers could be affected (step 7 or later), run the fast rollback first.
Report to the user with:
- the step,
- what you ran,
- the exact output (secrets and customer data redacted),
- the pass condition it failed to meet.
Never continue by self-reasoning.
