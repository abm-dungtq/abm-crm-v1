#!/usr/bin/env node
// Stores each PoC subject's MCP token as a GoClaw per-user credential for the abm-crm-poc server.
// Tokens come from ../.tokens.local and the gateway token from D:\Goclaw\data\gateway-token.txt;
// neither is printed. Only HTTP status and credential presence are reported.
//
// Usage (cwd poc/goclaw-identity):
//   node scripts/connect-goclaw-users.mjs --server <mcp server id> A=crm-poc-a CRM-PoC=crm-poc-group [B=<goclaw user_id>]
import { readFile } from 'node:fs/promises';

const GATEWAY = 'http://127.0.0.1:18790';
const GATEWAY_TOKEN_FILE = 'D:/Goclaw/data/gateway-token.txt';

const args = process.argv.slice(2);
const serverIndex = args.indexOf('--server');
const server = serverIndex >= 0 ? args[serverIndex + 1] : undefined;
const pairs = args.filter((a, i) => i !== serverIndex && i !== serverIndex + 1).map((a) => a.split('='));
if (!server || !pairs.length || pairs.some((p) => p.length !== 2 || !p[0] || !p[1])) {
  console.error('Usage: --server <id> SUBJECT=goclaw_user_id [...]');
  process.exit(1);
}

const subjects = JSON.parse(await readFile(new URL('../.tokens.local', import.meta.url), 'utf8'));
const gatewayToken = (await readFile(GATEWAY_TOKEN_FILE, 'utf8')).trim();
const headers = { Authorization: `Bearer ${gatewayToken}`, 'X-GoClaw-User-Id': 'system', 'Content-Type': 'application/json' };

let failed = false;
for (const [subject, userId] of pairs) {
  const entry = subjects.find((t) => t.subject_id === subject);
  if (!entry) { console.log(`${subject}: không có trong .tokens.local`); failed = true; continue; }
  const url = `${GATEWAY}/v1/mcp/servers/${server}/user-credentials?user_id=${encodeURIComponent(userId)}`;
  const put = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ headers: { Authorization: `Bearer ${entry.token}` } }) });
  const check = await fetch(url, { headers });
  const meta = check.ok ? await check.json() : {};
  console.log(`${subject} -> ${userId}: đặt ${put.status}, kiểm ${check.status}, has_credentials=${meta.has_credentials ?? '?'} has_headers=${meta.has_headers ?? '?'}`);
  if (!put.ok || !meta.has_credentials) failed = true;
}
// exitCode instead of exit(): Node on Windows asserts when exiting while fetch sockets are closing.
process.exitCode = failed ? 1 : 0;
