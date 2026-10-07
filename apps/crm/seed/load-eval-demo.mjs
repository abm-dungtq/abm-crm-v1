// Substitute slot tokens in the synthetic eval sample and, only with --check or --apply,
// talk to the remote abm-crm-eval database.
// Dry run is the default: it counts INSERT statements and does not call wrangler.
// A sample whose `-- generated-at` is older than 60 minutes warns on a dry run and
// refuses --check/--apply. --allow-stale is dry-run only.
// --apply --backup-file writes a full remote export. That file contains every staff
// email and session row, so it must stay private, and an existing file is not overwritten.
// The map is organizationId, department, teams.kd1, teams.kd2, and users.<slot>.
// slot-sale-1 and slot-leader-1 sit on kd1. slot-sale-2, slot-sale-3, and slot-leader-2 sit on kd2.
// slot-teacher-1/2 accept role teacher or admin and must be two different users.
// slot-head-1 accepts role head or admin; an admin in that slot skips the department check.
// slot-admin-1 may be the same user as the head or a teacher.
// Usage from apps/crm:
//   node seed/load-eval-demo.mjs --map C:\path\outside-repo\eval-map.json
//   node seed/load-eval-demo.mjs --map C:\path\outside-repo\eval-map.json --allow-stale
//   node seed/load-eval-demo.mjs --map C:\path\outside-repo\eval-map.json --check
//   node seed/load-eval-demo.mjs --map C:\path\outside-repo\eval-map.json --apply --backup-file C:\path\outside-repo\backup.sql
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_PRIVACY_WARNING,
  BUSINESS_EMPTY_TABLES,
  DEMO_AUDIT_WHERE,
  REGENERATE_COMMANDS,
  assertBackupNotExists,
  assertOutsideRepo,
  assertStaffPlacement,
  freshness,
  generatedAtMillis,
  leftoverTokens,
  parseMap,
  sampleTargetProblems,
  sqlIdList,
  substituteSql,
  userIdsInSlotOrder,
  withDeferredForeignKeys,
} from './eval-demo-pure.ts';

export {
  BACKUP_PRIVACY_WARNING,
  BUSINESS_EMPTY_TABLES,
  DEMO_AUDIT_WHERE,
  REGENERATE_COMMANDS,
  assertBackupNotExists,
  assertOutsideRepo,
  assertStaffPlacement,
  freshness,
  generatedAtMillis,
  leftoverTokens,
  parseMap,
  sampleTargetProblems,
  sqlIdList,
  substituteSql,
  userIdsInSlotOrder,
  withDeferredForeignKeys,
} from './eval-demo-pure.ts';

const COUNT_TABLES = [
  ...BUSINESS_EMPTY_TABLES,
  'audit_log', 'outbox', 'idempotency_key',
  'lead_counter', 'fee_counter', 'organization', 'department', 'team', 'app_user',
];

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoRoot = resolve(appDir, '..', '..');
const wranglerBin = join(appDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function arg(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${flag} needs a value`);
  return value;
}

function resultsOf(payload) {
  const entry = Array.isArray(payload) ? payload[0] : payload;
  return entry?.results ?? entry?.result?.[0]?.results ?? [];
}

function insertCounts(sql) {
  const counts = {};
  for (const line of sql.split('\n')) {
    const table = line.match(/^INSERT INTO (\w+)/)?.[1];
    if (table) counts[table] = (counts[table] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  const { spawnSync } = await import('node:' + 'child_process');
  const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:' + 'fs');
  const { tmpdir } = await import('node:' + 'os');
  const { join: joinPath } = await import('node:' + 'path');

  const apply = process.argv.includes('--apply');
  const check = process.argv.includes('--check');
  const allowStale = process.argv.includes('--allow-stale');
  if (apply && check) throw new Error('Pass only one of --check or --apply');

  const mapAbs = assertOutsideRepo(arg('--map') ?? '', repoRoot, '--map');
  const backupAbs = apply ? assertOutsideRepo(arg('--backup-file') ?? '', repoRoot, '--backup-file') : undefined;
  if (backupAbs) {
    console.warn(BACKUP_PRIVACY_WARNING);
    assertBackupNotExists(existsSync(backupAbs));
  }
  const map = parseMap(JSON.parse(readFileSync(mapAbs, 'utf8')));

  const sources = ['b2b-demo.sql', 'learner-demo.sql'].map((name) => ({
    name,
    sql: readFileSync(join(here, name), 'utf8'),
  }));
  const decision = freshness({
    stamps: sources.map((source) => generatedAtMillis(source.sql)),
    now: Date.now(),
    check,
    apply,
    allowStale,
  });
  if (decision.action === 'refuse') throw new Error(decision.message);
  if (decision.action === 'warn') console.warn(decision.message);

  let sql = withDeferredForeignKeys(sources.map((source) => source.sql.trimEnd()).join('\n') + '\n');
  sql = substituteSql(sql, map.replacements);
  const leftover = leftoverTokens(sql, map.organizationId, map.replacements.filter(([from, to]) => from === to).map(([from]) => from));
  if (leftover.length) throw new Error(`A slot, team, or department token remains after substitution: ${leftover.join(', ')}`);

  let tempDir;
  try {
    tempDir = mkdtempSync(joinPath(tmpdir(), 'crm-eval-demo-'));
    const tempFile = joinPath(tempDir, 'eval-demo.sql');
    writeFileSync(tempFile, sql, { mode: 0o600 });

    console.log(apply ? 'apply' : check ? 'check' : 'dry-run');
    for (const [table, count] of Object.entries(insertCounts(sql))) console.log(`${table} ${count}`);
    if (!apply && !check) return;

    function wrangler(args) {
      const result = spawnSync(process.execPath, [wranglerBin, ...args], { cwd: appDir, encoding: 'utf8' });
      if (result.error) throw new Error(result.error.message);
      if (result.status !== 0) throw new Error((result.stderr || result.stdout || `wrangler ${args[0]} failed`).trim());
      return result.stdout ?? '';
    }

    function d1(extra) {
      const stdout = wrangler(['d1', 'execute', 'abm-crm-eval', '--remote', '--json', ...extra]);
      const start = stdout.search(/[[{]/);
      if (start < 0) throw new Error('wrangler returned no JSON');
      return JSON.parse(stdout.slice(start));
    }

    function assertEmpty() {
      const tableCounts = BUSINESS_EMPTY_TABLES.map((table) => `(SELECT COUNT(*) FROM ${table}) AS ${table}`).join(', ');
      const emptySql = `SELECT ${tableCounts}, (SELECT COUNT(*) FROM audit_log WHERE ${DEMO_AUDIT_WHERE}) AS demo_audit, (SELECT COUNT(*) FROM lead_counter) AS lead_counter_n, (SELECT next_value FROM lead_counter) AS lead_next, (SELECT COUNT(*) FROM fee_counter) AS fee_counter_n`;
      const empty = resultsOf(d1(['--command', emptySql]))[0] ?? {};
      const tables = {};
      for (const table of BUSINESS_EMPTY_TABLES) tables[table] = Number(empty[table] ?? 0);
      const problems = sampleTargetProblems({
        tables,
        leadCounterRows: Number(empty.lead_counter_n ?? 0),
        leadNext: empty.lead_next == null ? null : Number(empty.lead_next),
        feeCounterRows: Number(empty.fee_counter_n ?? 0),
        demoAuditRows: Number(empty.demo_audit ?? 0),
      });
      if (problems.length) throw new Error(problems[0]);
    }

    const userList = sqlIdList(userIdsInSlotOrder(map));
    const teamList = sqlIdList([map.teams.kd1, map.teams.kd2]);
    const departmentList = sqlIdList([map.departmentId]);
    const found = resultsOf(d1(['--command', `SELECT id, role, status, team_id, department_id, organization_id FROM app_user WHERE id IN (${userList})`]));
    const teamRows = resultsOf(d1(['--command', `SELECT id, department_id FROM team WHERE id IN (${teamList})`]));
    const departmentRows = resultsOf(d1(['--command', `SELECT id, organization_id FROM department WHERE id IN (${departmentList})`]));
    assertStaffPlacement({
      users: found,
      teams: teamRows,
      department: departmentRows[0] ?? null,
      map,
    });
    assertEmpty();
    if (!apply) return;

    wrangler(['d1', 'export', 'abm-crm-eval', '--remote', '--output', backupAbs]);
    const bookmark = wrangler(['d1', 'time-travel', 'info', 'abm-crm-eval']);
    console.log(bookmark.trimEnd());
    assertEmpty();
    d1(['--file', tempFile]);

    const countSql = COUNT_TABLES.map((table) => `SELECT '${table}' AS table_name, COUNT(*) AS n FROM ${table}`).join(' UNION ALL ');
    for (const row of resultsOf(d1(['--command', countSql]))) console.log(`${row.table_name} ${row.n}`);
    const violations = resultsOf(d1(['--command', 'PRAGMA foreign_key_check']));
    console.log(`foreign_key_check ${JSON.stringify(violations)}`);
    if (violations.length) throw new Error('foreign_key_check returned rows');
    console.log('applied');
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

const entry = process.argv[1]?.replaceAll('\\', '/') ?? '';
const isCli = entry.endsWith('/seed/load-eval-demo.mjs');
if (isCli) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    if (!message.includes(REGENERATE_COMMANDS) && message.includes('older than 60 minutes')) {
      console.error(REGENERATE_COMMANDS);
    }
    process.exitCode = 1;
  });
}
