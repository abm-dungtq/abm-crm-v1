#!/usr/bin/env node
// Issues a chat-bot (MCP) token for each active CRM user and stores it as that person's GoClaw credential
// under the key `crm-user:<app_user.id>`, the GoClaw user id the CRM uses for direct chats with the assistant
// (crm-assistant), so the agent acts with that person's own CRM rights. D1 keeps only the sha256 hash; the token
// goes straight to GoClaw and is never printed. The gateway token is read from D:\Goclaw\data\gateway-token.txt
// and never printed either.
//
// Usage (cwd apps/crm):
//   node scripts/issue-agent-tokens.mjs --server <goclaw mcp server id> --email <crm email> [--email ...]
// wrangler d1 execute has no parameter binding, so every value placed in SQL is validated first: emails cannot
// contain quotes or spaces, user ids come from D1 and must match a strict id pattern, the rest is generated here.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE = 'abm-crm-eval';
const GATEWAY = 'http://127.0.0.1:18790';
const GATEWAY_TOKEN_FILE = 'D:/Goclaw/data/gateway-token.txt';
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function usage(message) {
  console.error(message);
  console.error('Usage: --server <id> --email <crm email> [--email ...]');
  process.exitCode = 1;
}

/** Checked before an email reaches SQL: no whitespace, quotes or extra @ can appear in the literal. */
const EMAIL_RE = /^[^\s'"@]+@[^\s'"@]+$/;
/** app_user ids are interpolated into SQL and into the GoClaw key, so only plain id characters are accepted. */
const USER_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Shows enough of a key to recognise it without copying it whole into logs. */
const mask = (key) => (key.length > 10 ? `${key.slice(0, 7)}…${key.slice(-2)}` : key);

// ---------- arguments ----------
const argv = process.argv.slice(2);
let server;
const people = [];
for (let i = 0; i < argv.length; i += 2) {
  const [flag, value] = [argv[i], argv[i + 1]];
  if (!value) { people.length = 0; break; }
  if (flag === '--server') server = value;
  else if (flag === '--email') people.push({ email: value.trim().toLowerCase() });
  else { people.length = 0; break; }
}

function wrangler(extra) {
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--yes', ...extra], {
    cwd: appDir, shell: process.platform === 'win32', encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`wrangler d1 execute lỗi (mã ${result.status}). Kiểm tra đăng nhập Cloudflare.`);
  return result.stdout;
}

/** Remote --file returns only statistics, so reads use --command; Windows needs it quoted as one argument. */
function query(sql) {
  const out = wrangler(['--json', '--command', process.platform === 'win32' ? `"${sql}"` : sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

/** Writes go through a temp file so quoting never differs between shells; the file holds hashes only. */
function runSql(sql) {
  const file = join(tmpdir(), `abm-agent-token-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    wrangler(['--file', file]);
  } finally {
    rmSync(file, { force: true });
  }
}

async function main() {
  if (!server || !/^[\w-]+$/.test(server) || !people.length) return usage('Thiếu --server hoặc --email.');
  const badEmail = people.find((p) => !EMAIL_RE.test(p.email));
  if (badEmail) return usage('Email không hợp lệ (không được có khoảng trắng, dấu nháy hoặc thiếu @).');

  // Every GoClaw key must belong to exactly one person in this run, or one person's bot would act as another.
  for (const person of people) {
    const [user] = query(`SELECT id FROM app_user WHERE email = '${person.email}' AND status = 'active'`);
    if (!user?.id) {
      console.log(`${person.email}: không có người dùng đang hoạt động, bỏ qua.`);
      process.exitCode = 1;
      continue;
    }
    if (!USER_ID_RE.test(user.id)) {
      console.log(`${person.email}: mã người dùng có ký tự lạ, bỏ qua.`);
      process.exitCode = 1;
      continue;
    }
    person.userId = user.id;
    person.keys = [`crm-user:${user.id}`];
  }
  const ready = people.filter((p) => p.userId);
  const owners = new Map();
  for (const p of ready) {
    for (const key of p.keys) {
      if (owners.has(key) && owners.get(key) !== p.email) return usage(`Khóa ${mask(key)} bị gán cho cả ${owners.get(key)} và ${p.email}. Dừng, chưa ghi gì.`);
      owners.set(key, p.email);
    }
  }

  const gatewayToken = readFileSync(GATEWAY_TOKEN_FILE, 'utf8').trim();
  const headers = { Authorization: `Bearer ${gatewayToken}`, 'X-GoClaw-User-Id': 'system', 'Content-Type': 'application/json' };
  const credentialUrl = (key) => `${GATEWAY}/v1/mcp/servers/${server}/user-credentials?user_id=${encodeURIComponent(key)}`;
  // Fail before any token is replaced if the gateway or server id is wrong.
  if (ready.length) {
    const probe = await fetch(credentialUrl(ready[0].keys[0]), { headers });
    if (probe.status === 401 || probe.status === 403 || probe.status === 404) {
      console.error(`GoClaw từ chối (HTTP ${probe.status}). Kiểm tra gateway và --server. Chưa ghi gì.`);
      process.exitCode = 1;
      return;
    }
  }

  for (const p of ready) {
    const token = randomBytes(32).toString('base64url');
    const tokenId = randomUUID();
    const now = new Date().toISOString();
    const hash = createHash('sha256').update(token).digest('hex');
    // Only this person's earlier GoClaw key is replaced: their self-service MCP tokens and an LMS publish token stay
    // valid. created_via comes from migration 0030, so apply migrations before running this script.
    runSql(`UPDATE agent_token SET revoked_at = '${now}' WHERE user_id = '${p.userId}' AND revoked_at IS NULL AND label = 'goclaw' AND created_via = 'script';
INSERT INTO agent_token (id, user_id, token_hash, label, created_at) VALUES ('${tokenId}', '${p.userId}', '${hash}', 'goclaw', '${now}');
INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
  VALUES ('${randomUUID()}', NULL, 'system', 'issueAgentToken', 'agent_token', '${tokenId}', NULL, '{"userId":"${p.userId}"}', '${now}');
`);
    const [stored] = query(`SELECT COUNT(*) AS n FROM agent_token WHERE id = '${tokenId}' AND revoked_at IS NULL`);
    if (stored?.n !== 1) {
      console.log(`${p.email}: không ghi được chìa khóa bot vào D1.`);
      process.exitCode = 1;
      continue;
    }
    for (const key of p.keys) {
      const put = await fetch(credentialUrl(key), { method: 'PUT', headers, body: JSON.stringify({ headers: { Authorization: `Bearer ${token}` } }) });
      const check = await fetch(credentialUrl(key), { headers });
      const meta = check.ok ? await check.json() : {};
      console.log(`${p.email} -> ${mask(key)}: đặt ${put.status}, kiểm ${check.status}, has_credentials=${meta.has_credentials ?? '?'}`);
      if (!put.ok || !meta.has_credentials) process.exitCode = 1;
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Lỗi không rõ');
  process.exitCode = 1;
}
// exitCode instead of exit(): Node on Windows asserts when exiting while fetch sockets are closing.
