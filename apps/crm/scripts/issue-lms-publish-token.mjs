#!/usr/bin/env node
// Issues an LMS publish token (agent_token with label 'lms-publish') for an active academic/admin CRM user.
// D1 stores only the SHA-256 hash; the raw token is written to ~/.abm/lms-publish-token and is never printed.
//
// Usage (cwd apps/crm):
//   node scripts/issue-lms-publish-token.mjs --email <crm email>

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE = 'abm-crm-eval';
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const abmDir = join(homedir(), '.abm');
const tokenFilePath = join(abmDir, 'lms-publish-token');

function usage(message) {
  console.error(message);
  console.error('Usage: node scripts/issue-lms-publish-token.mjs --email <crm email>');
  process.exitCode = 1;
}

const argv = process.argv.slice(2);
let email = '';
for (let i = 0; i < argv.length; i += 2) {
  const [flag, value] = [argv[i], argv[i + 1]];
  if (flag === '--email' && value) {
    email = value.trim().toLowerCase();
  } else {
    email = '';
    break;
  }
}

function wrangler(extra) {
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--yes', ...extra], {
    cwd: appDir,
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute lỗi (mã ${result.status}). Kiểm tra đăng nhập Cloudflare.`);
  }
  return result.stdout;
}

/** Remote --file returns only statistics, so reads use --command; Windows needs it quoted as one argument. */
function query(sql) {
  const out = wrangler(['--json', '--command', process.platform === 'win32' ? `"${sql}"` : sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

/** Writes go through a temp file so quoting never differs between shells; the file holds hashes only. */
function runSql(sql) {
  const file = join(tmpdir(), `abm-lms-publish-token-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    wrangler(['--file', file]);
  } finally {
    rmSync(file, { force: true });
  }
}

async function main() {
  if (!email) return usage('Thiếu tham số --email.');
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
    return usage(`Email không hợp lệ: ${email}`);
  }

  const [user] = query(`SELECT id, role FROM app_user WHERE email = '${email}' AND status = 'active'`);
  if (!user) {
    console.error(`Không tìm thấy tài khoản hoạt động cho email: ${email}`);
    process.exitCode = 1;
    return;
  }
  if (user.role !== 'academic' && user.role !== 'admin') {
    console.error(`Tài khoản ${email} có vai trò "${user.role}" (yêu cầu academic hoặc admin).`);
    process.exitCode = 1;
    return;
  }

  const token = randomBytes(32).toString('base64url');
  const tokenId = randomUUID();
  const now = new Date().toISOString();
  const hash = createHash('sha256').update(token).digest('hex');

  runSql(`UPDATE agent_token SET revoked_at = '${now}' WHERE user_id = '${user.id}' AND label = 'lms-publish' AND revoked_at IS NULL;
INSERT INTO agent_token (id, user_id, token_hash, label, created_at) VALUES ('${tokenId}', '${user.id}', '${hash}', 'lms-publish', '${now}');
INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
  VALUES ('${randomUUID()}', NULL, 'system', 'issueLmsPublishToken', 'agent_token', '${tokenId}', NULL, '{"userId":"${user.id}","label":"lms-publish"}', '${now}');
`);

  const [stored] = query(`SELECT COUNT(*) AS n FROM agent_token WHERE id = '${tokenId}' AND revoked_at IS NULL`);
  if (stored?.n !== 1) {
    console.error(`${email}: không ghi được token đăng bài vào D1.`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(abmDir, { recursive: true, mode: 0o700 });
  writeFileSync(tokenFilePath, `${token}\n`, { mode: 0o600 });
  console.log(`Đã tạo token đăng bài cho ${email}, lưu tại ~/.abm/lms-publish-token`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Lỗi không rõ');
  process.exitCode = 1;
}
