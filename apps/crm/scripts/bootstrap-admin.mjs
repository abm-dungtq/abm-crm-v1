#!/usr/bin/env node
// Issues a temporary password for an existing active Admin, so the first sign-in needs no one to see it.
// The password goes only to apps/crm/.admin-bootstrap.local (git-ignored); nothing secret is printed.
//
// Usage (cwd apps/crm): node scripts/bootstrap-admin.mjs --local|--remote --email <admin email>
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep equal to src/worker/password.ts: TEMP_PASSWORD_ITERATIONS, TEMP_PASSWORD_HOURS and the alphabet.
// The iteration count is stored per user, so login verifies whatever was used here.
const TEMP_PASSWORD_ITERATIONS = 1;
const TEMP_PASSWORD_HOURS = 48;
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const DATABASE = 'abm-crm-eval';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(appDir, '.admin-bootstrap.local');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const target = args.includes('--local') ? '--local' : args.includes('--remote') ? '--remote' : null;
if (!target || (args.includes('--local') && args.includes('--remote'))) fail('Chọn đúng một: --local hoặc --remote');
const email = args[args.indexOf('--email') + 1]?.trim().toLowerCase();
if (!args.includes('--email') || !email || !/^[^\s@']+@[^\s@']+$/.test(email)) fail('Thiếu hoặc sai --email');

// Checked before touching the database, so a run never replaces a password it cannot save.
if (existsSync(outFile)) fail('.admin-bootstrap.local đã tồn tại. Xóa file cũ sau khi dùng xong rồi chạy lại.');

function generateTempPassword(length = 12) {
  const out = [];
  const limit = 256 - (256 % TEMP_ALPHABET.length);
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit && out.length < length) out.push(TEMP_ALPHABET[byte % TEMP_ALPHABET.length]);
    }
  }
  return out.join('');
}

function wrangler(extra) {
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', DATABASE, target, '--yes', ...extra], {
    cwd: appDir, shell: process.platform === 'win32', encoding: 'utf8',
  });
  if (result.status !== 0) fail(`wrangler d1 execute lỗi (mã ${result.status}). Kiểm tra đăng nhập Cloudflare và tên database.`);
  return result.stdout;
}

const password = generateTempPassword();
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, TEMP_PASSWORD_ITERATIONS, 32, 'sha256').toString('base64');
const saltText = salt.toString('base64');
const expiresAt = new Date(Date.now() + TEMP_PASSWORD_HOURS * 3_600_000).toISOString();

/** SQL goes through a temp file so no quoting differs between shells. */
function runSql(sql, extra = []) {
  const file = join(tmpdir(), `abm-bootstrap-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    return wrangler(['--file', file, ...extra]);
  } finally {
    rmSync(file, { force: true });
  }
}

runSql(`UPDATE app_user SET password_hash = '${hash}', password_salt = '${saltText}', password_iterations = ${TEMP_PASSWORD_ITERATIONS},
  must_change_password = 1, temp_password_expires_at = '${expiresAt}', failed_login_count = 0, locked_until = NULL
  WHERE email = '${email}' AND role = 'admin' AND status = 'active';\n`);

// The salt is fresh, so a match proves this run's update landed on exactly one admin.
// Remote --file runs as an import and returns only statistics, so the check uses --command;
// the Windows shell needs the statement quoted as one argument.
const checkSql = `SELECT COUNT(*) AS n FROM app_user WHERE email = '${email}' AND password_salt = '${saltText}' AND must_change_password = 1`;
const check = wrangler(['--json', '--command', process.platform === 'win32' ? `"${checkSql}"` : checkSql]);
let n = -1;
try {
  n = JSON.parse(check.slice(check.indexOf('[')))[0].results[0].n;
} catch {
  fail('Không đọc được kết quả kiểm tra từ wrangler.');
}
if (n !== 1) fail(`Không tìm thấy Admin đang hoạt động với email này (khớp ${n} dòng). Không ghi mật khẩu.`);

try {
  writeFileSync(outFile, `${email}\n${password}\n`, { flag: 'wx', mode: 0o600 });
} catch {
  fail('.admin-bootstrap.local đã tồn tại. Xóa file cũ sau khi dùng xong rồi chạy lại.');
}
console.log(`Đã ghi mật khẩu tạm vào .admin-bootstrap.local (hạn ${TEMP_PASSWORD_HOURS} giờ).`);
