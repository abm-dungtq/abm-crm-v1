import { addWorkingHours, addWorkingMinutes, workingDaysBetween, workingMinutesBetween } from '@abm/contracts';
import { describe, expect, test } from 'vitest';
import { leadHealth } from '../src/worker/queries';

// Local Vietnam wall-clock time (+07:00, no DST). 2026-10-05 is a Monday.
const vn = (local: string) => new Date(`${local}:00+07:00`);
const iso = (local: string) => vn(local).toISOString();

describe('working minutes between two instants', () => {
  test('counts only 08:00–17:30 on Monday–Friday', () => {
    expect(workingMinutesBetween(vn('2026-10-05T08:00'), vn('2026-10-05T17:30'))).toBe(570);
    expect(workingMinutesBetween(vn('2026-10-05T06:00'), vn('2026-10-05T20:00'))).toBe(570);
    expect(workingMinutesBetween(vn('2026-10-05T17:30'), vn('2026-10-06T08:00'))).toBe(0);
    expect(workingMinutesBetween(vn('2026-10-05T07:59'), vn('2026-10-05T08:01'))).toBe(1);
    expect(workingMinutesBetween(vn('2026-10-05T17:29'), vn('2026-10-05T17:31'))).toBe(1);
  });

  test('skips the weekend', () => {
    expect(workingMinutesBetween(vn('2026-10-09T17:00'), vn('2026-10-12T09:00'))).toBe(90);
    expect(workingMinutesBetween(vn('2026-10-10T08:00'), vn('2026-10-11T17:30'))).toBe(0);
  });

  test('uses Vietnam days when the interval crosses UTC midnight', () => {
    // 06:30 Tuesday in Vietnam is still Monday in UTC; Monday evening and Tuesday 06:30 add nothing.
    expect(workingMinutesBetween(vn('2026-10-05T16:30'), vn('2026-10-06T06:30'))).toBe(60);
    expect(workingMinutesBetween(vn('2026-10-05T16:30'), vn('2026-10-06T09:00'))).toBe(120);
  });

  test('is zero when the end is not after the start', () => {
    expect(workingMinutesBetween(vn('2026-10-05T10:00'), vn('2026-10-05T10:00'))).toBe(0);
    expect(workingMinutesBetween(vn('2026-10-05T11:00'), vn('2026-10-05T10:00'))).toBe(0);
  });
});

describe('adding working time', () => {
  test('stays inside the day up to 17:30 and rolls to 08:00 next working day', () => {
    expect(addWorkingMinutes(vn('2026-10-05T08:00'), 570)).toEqual(vn('2026-10-05T17:30'));
    expect(addWorkingMinutes(vn('2026-10-05T08:00'), 571)).toEqual(vn('2026-10-06T08:01'));
    expect(addWorkingMinutes(vn('2026-10-05T06:00'), 30)).toEqual(vn('2026-10-05T08:30'));
    expect(addWorkingMinutes(vn('2026-10-05T19:00'), 30)).toEqual(vn('2026-10-06T08:30'));
  });

  test('first-contact SLA of 4 working hours crosses the weekend', () => {
    expect(addWorkingHours(vn('2026-10-09T15:00'), 4)).toEqual(vn('2026-10-12T09:30'));
    expect(addWorkingHours(vn('2026-10-10T10:00'), 4)).toEqual(vn('2026-10-12T12:00'));
    expect(addWorkingHours(vn('2026-10-11T23:30'), 4)).toEqual(vn('2026-10-12T12:00'));
  });

  test('24 working hours from Monday 09:00 lands on Wednesday 14:00', () => {
    expect(addWorkingHours(vn('2026-10-05T09:00'), 24)).toEqual(vn('2026-10-07T14:00'));
  });

  test('round-trips with workingMinutesBetween from working and non-working starts', () => {
    const starts = ['2026-10-05T08:00', '2026-10-05T12:17', '2026-10-05T17:29', '2026-10-09T17:00', '2026-10-10T11:00', '2026-10-06T03:00'];
    for (const start of starts) {
      for (const minutes of [1, 59, 240, 569, 570, 1440, 5000]) {
        const end = addWorkingMinutes(vn(start), minutes);
        expect(workingMinutesBetween(vn(start), end), `${start} + ${minutes}`).toBe(minutes);
      }
    }
  });

  test('working days use a 9.5-hour day', () => {
    expect(workingDaysBetween(vn('2026-10-05T08:00'), vn('2026-10-12T08:00'))).toBe(5);
  });
});

describe('lead health thresholds', () => {
  const base = { stage: 'new' as const, status: 'active', first_contact_at: null, assigned_at: iso('2026-10-05T08:00'), stage_entered_at: iso('2026-10-05T08:00'), na_due_at: null };

  test('first contact is ok, warns at 3h, breaches at 4h and is releasable at 24 working hours', () => {
    const state = (now: string) => leadHealth(base, vn(now)).firstContact?.state;
    expect(state('2026-10-05T10:59')).toBe('ok');
    expect(state('2026-10-05T11:00')).toBe('warn');
    expect(state('2026-10-05T11:59')).toBe('warn');
    expect(state('2026-10-05T12:00')).toBe('breach');
    // 24 working hours from Monday 08:00 = Wednesday 13:00.
    expect(state('2026-10-07T12:59')).toBe('breach');
    expect(state('2026-10-07T13:00')).toBe('release');
  });

  test('first contact SLA ignores time outside working hours', () => {
    const health = leadHealth({ ...base, assigned_at: iso('2026-10-09T17:00') }, vn('2026-10-12T08:00'));
    expect(health.firstContact).toEqual({ state: 'ok', minutes: 30 });
  });

  test('no first-contact clock once contacted, when unassigned, or when closed', () => {
    expect(leadHealth({ ...base, first_contact_at: iso('2026-10-05T09:00') }, vn('2026-10-08T09:00')).firstContact).toBeNull();
    expect(leadHealth({ ...base, assigned_at: null }, vn('2026-10-08T09:00')).firstContact).toBeNull();
    expect(leadHealth({ ...base, status: 'lost' }, vn('2026-10-08T09:00'))).toEqual({ firstContact: null, stageSla: null, nextActionOverdue: false });
  });

  test('stage SLA breaches only after the stage limit in working days', () => {
    const contacted = { ...base, stage: 'contacted' as const, first_contact_at: iso('2026-10-05T08:00') };
    expect(leadHealth(contacted, vn('2026-10-08T08:00')).stageSla).toMatchObject({ state: 'warn', days: 3, limit: 3 });
    expect(leadHealth(contacted, vn('2026-10-08T08:30')).stageSla).toMatchObject({ state: 'breach', limit: 3 });
    expect(leadHealth(contacted, vn('2026-10-07T08:00')).stageSla).toMatchObject({ state: 'ok', days: 2 });
  });

  test('next action is overdue only after its due time', () => {
    const due = { ...base, na_due_at: iso('2026-10-05T10:00') };
    expect(leadHealth(due, vn('2026-10-05T10:00')).nextActionOverdue).toBe(false);
    expect(leadHealth(due, vn('2026-10-05T10:01')).nextActionOverdue).toBe(true);
  });
});
