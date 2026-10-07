import { expect, test } from 'vitest';
import {
  REGENERATE_COMMANDS,
  SLOT_ROLES,
  SLOT_TEAM_KEY,
  STALE_AFTER_MS,
  assertBackupNotExists,
  assertStaffPlacement,
  freshness,
  isOutsideRepo,
  leftoverTokens,
  parseMap,
  sqlIdList,
  substituteSql,
  type EvalDemoMap,
  type Slot,
} from '../seed/eval-demo-pure';

function validInput() {
  return {
    organizationId: 'org1',
    department: 'dep1',
    teams: { kd1: 'team1', kd2: 'team2' },
    users: {
      'slot-admin-1': 'user-admin',
      'slot-sale-1': 'user-sale-1',
      'slot-sale-2': 'user-sale-2',
      'slot-sale-3': 'user-sale-3',
      'slot-leader-1': 'user-leader-1',
      'slot-leader-2': 'user-leader-2',
      'slot-head-1': 'user-head',
      'slot-academic-1': 'user-academic',
      'slot-teacher-1': 'user-teacher-1',
      'slot-teacher-2': 'user-teacher-2',
      'slot-accountant-1': 'user-accountant',
    },
  };
}

function placed(map: EvalDemoMap) {
  const users = (Object.keys(SLOT_ROLES) as Slot[]).map((slot) => {
    const teamKey = SLOT_TEAM_KEY[slot];
    const inDepartment = teamKey !== undefined || slot === 'slot-head-1';
    return {
      id: map.users[slot],
      role: SLOT_ROLES[slot],
      status: 'active',
      team_id: teamKey ? map.teams[teamKey] : null,
      department_id: inDepartment ? map.departmentId : null,
      organization_id: map.organizationId,
    };
  });
  return {
    users,
    teams: [
      { id: map.teams.kd1, department_id: map.departmentId },
      { id: map.teams.kd2, department_id: map.departmentId },
    ],
    department: { id: map.departmentId, organization_id: map.organizationId },
    map,
  };
}

test('map validation rejects unknown keys and invalid ids', () => {
  expect(() => parseMap({ ...validInput(), departmentId: 'dep-old' })).toThrow(/Unknown map key departmentId/);
  expect(() => parseMap({ ...validInput(), teams: { 'team-kd1': 'team1', kd2: 'team2' } })).toThrow(/Unknown team key team-kd1/);
  const extraUser = validInput();
  extraUser.users['slot-nope' as 'slot-admin-1'] = 'user-x';
  expect(() => parseMap(extraUser)).toThrow(/Unknown user slot slot-nope/);
  expect(() => parseMap({ ...validInput(), organizationId: "org' OR 1=1" })).toThrow(/organizationId must match/);
  const missing = validInput();
  const { 'slot-leader-2': _removed, ...users } = missing.users;
  expect(() => parseMap({ ...missing, users })).toThrow(/users\.slot-leader-2/);
  expect(() => sqlIdList(["x' OR 1=1"])).toThrow(/unvalidated/);
  expect(sqlIdList(['user-sale-1', 'team_2'])).toBe("'user-sale-1', 'team_2'");
});

test('substitution covers JSON columns and leftover slot tokens are an error', () => {
  const map = parseMap(validInput());
  const sql = `INSERT INTO approval (payload_json) VALUES ('{"fromUserId":"slot-sale-2","toUserId":"slot-leader-2","team":"team-kd2","dep":"dep-kd","org":"org-abm"}');`;
  const substituted = substituteSql(sql, map.replacements);
  expect(substituted).toContain('"fromUserId":"user-sale-2"');
  expect(substituted).toContain('"toUserId":"user-leader-2"');
  expect(substituted).toContain('"team":"team2"');
  expect(substituted).toContain('"dep":"dep1"');
  expect(substituted).toContain('"org":"org1"');
  expect(leftoverTokens(substituted, map.organizationId)).toEqual([]);
  expect(leftoverTokens(sql, map.organizationId)).toEqual(['slot-sale-2', 'team-kd2', 'dep-kd', 'org-abm']);
});

test('a sample is fresh 59 minutes after the stamp and stale at 61', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const fresh = freshness({ stamps: [now - 59 * 60_000], now, check: true, apply: false, allowStale: false });
  expect(fresh.action).toBe('ok');
  const stale = freshness({ stamps: [now - 61 * 60_000], now, check: true, apply: false, allowStale: false });
  expect(stale.action).toBe('refuse');
  expect(stale.message).toContain('older than 60 minutes');
  expect(freshness({ stamps: [now - 61 * 60_000], now, check: false, apply: false, allowStale: false }).action).toBe('warn');
});

test('a stale sample is refused for remote modes and only warned for a dry run', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const fresh = now - 60_000;
  const borderline = now - STALE_AFTER_MS;
  const old = now - STALE_AFTER_MS - 1;
  expect(freshness({ stamps: [fresh, borderline], now, check: true, apply: false, allowStale: false }).action).toBe('ok');
  const refused = freshness({ stamps: [old, fresh], now, check: false, apply: true, allowStale: false });
  expect(refused.action).toBe('refuse');
  expect(refused.message).toContain(REGENERATE_COMMANDS);
  expect(freshness({ stamps: [old], now, check: false, apply: false, allowStale: false }).action).toBe('warn');
  expect(freshness({ stamps: [null], now, check: true, apply: false, allowStale: false }).action).toBe('refuse');
  expect(freshness({ stamps: [fresh], now, check: true, apply: false, allowStale: true }).action).toBe('refuse');
  expect(freshness({ stamps: [old], now, check: false, apply: false, allowStale: true }).action).toBe('warn');
});

test('outside-repo check uses a real parent segment, not a text prefix', () => {
  const root = 'D:\\TQD\\CRM';
  expect(isOutsideRepo('D:\\TQD\\CRM\\apps\\crm\\seed\\map.json', root)).toBe(false);
  expect(isOutsideRepo('D:\\TQD\\CRM\\..hidden\\map.json', root)).toBe(false);
  expect(isOutsideRepo('D:\\TQD\\CRM-other\\map.json', root)).toBe(true);
  expect(isOutsideRepo('D:\\TQD\\outside\\map.json', root)).toBe(true);
  expect(isOutsideRepo('C:\\temp\\backup.sql', root)).toBe(true);
  expect(isOutsideRepo(root, root)).toBe(false);
});

test('sale and leader slots must sit on the mapped team and the head in the mapped department', () => {
  const map = parseMap(validInput());
  expect(() => assertStaffPlacement(placed(map))).not.toThrow();
  const moved = placed(map);
  const sale = moved.users.find((row) => row.id === 'user-sale-3');
  sale!.team_id = map.teams.kd1;
  expect(() => assertStaffPlacement(moved)).toThrow(/slot-sale-3/);
  const sale2 = placed(map);
  const secondSale = sale2.users.find((row) => row.id === 'user-sale-2');
  secondSale!.team_id = map.teams.kd1;
  expect(() => assertStaffPlacement(sale2)).toThrow(/slot-sale-2/);
  const headMoved = placed(map);
  headMoved.department = { id: map.departmentId, organization_id: 'somewhere-else' };
  expect(() => assertStaffPlacement(headMoved)).toThrow(/organization/);
  const accountantMoved = placed(map);
  const accountant = accountantMoved.users.find((row) => row.id === 'user-accountant');
  accountant!.organization_id = 'somewhere-else';
  expect(() => assertStaffPlacement(accountantMoved)).toThrow(/slot-accountant-1/);
});

test('two sale or leader slots cannot map to the same user', () => {
  const sales = validInput();
  sales.users['slot-sale-2'] = sales.users['slot-sale-1'];
  expect(() => parseMap(sales)).toThrow(/same user/);
  const mixed = validInput();
  mixed.users['slot-leader-1'] = mixed.users['slot-sale-3'];
  expect(() => parseMap(mixed)).toThrow(/same user/);
  const teachers = validInput();
  teachers.users['slot-teacher-2'] = teachers.users['slot-teacher-1'];
  expect(() => parseMap(teachers)).toThrow(/same user/);
  const teacherIsAdmin = validInput();
  teacherIsAdmin.users['slot-teacher-1'] = teacherIsAdmin.users['slot-admin-1'];
  expect(() => parseMap(teacherIsAdmin)).not.toThrow();
  const headIsAdmin = validInput();
  headIsAdmin.users['slot-head-1'] = headIsAdmin.users['slot-admin-1'];
  expect(() => parseMap(headIsAdmin)).not.toThrow();
});

test('an admin may fill a teacher slot and the head slot', () => {
  const input = validInput();
  input.users['slot-teacher-1'] = input.users['slot-admin-1'];
  input.users['slot-head-1'] = input.users['slot-admin-1'];
  const map = parseMap(input);
  const staff = placed(map);
  const adminId = map.users['slot-admin-1'];
  const users = [
    ...staff.users.filter((row) => row.id !== adminId),
    {
      id: adminId,
      role: 'admin',
      status: 'active',
      team_id: null,
      department_id: 'not-the-mapped-department',
      organization_id: map.organizationId,
    },
  ];
  expect(users.filter((row) => row.role === 'teacher').map((row) => row.id)).toEqual(['user-teacher-2']);
  expect(() => assertStaffPlacement({ ...staff, users })).not.toThrow();

  const headOnly = placed(parseMap(validInput()));
  const head = headOnly.users.find((row) => row.id === 'user-head');
  head!.department_id = null;
  expect(() => assertStaffPlacement(headOnly)).toThrow(/Head user/);

  const wrongTeacher = users.map((row) => (row.id === 'user-teacher-2' ? { ...row, role: 'sale' } : row));
  expect(() => assertStaffPlacement({ ...staff, users: wrongTeacher })).toThrow(/slot-teacher-2/);
});

test('an existing backup file is refused', () => {
  expect(() => assertBackupNotExists(false)).not.toThrow();
  expect(() => assertBackupNotExists(true)).toThrow(/overwrite/);
});
