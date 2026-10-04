// Working-time arithmetic for SLA (QĐ1/QĐ4): 08:00–17:30 Asia/Ho_Chi_Minh.
// Vietnam has no DST, so a fixed +07:00 offset is exact. The holiday calendar must be
// configured before operation; this evaluation build treats Monday–Friday as working days.

const OFFSET_MS = 7 * 3600_000;
const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 17 * 60 + 30;
const MINUTES_PER_DAY = DAY_END_MIN - DAY_START_MIN;
const DAY_MS = 86_400_000;

const isWorkingDay = (localDayStartMs: number) => {
  const weekday = new Date(localDayStartMs).getUTCDay();
  return weekday >= 1 && weekday <= 5;
};

/** Working minutes elapsed between two instants (0 when `to` is not after `from`). */
export function workingMinutesBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  const a = from.getTime() + OFFSET_MS;
  const b = to.getTime() + OFFSET_MS;
  let total = 0;
  for (let day = Math.floor(a / DAY_MS) * DAY_MS; day < b; day += DAY_MS) {
    if (!isWorkingDay(day)) continue;
    const start = Math.max(a, day + DAY_START_MIN * 60_000);
    const end = Math.min(b, day + DAY_END_MIN * 60_000);
    if (end > start) total += (end - start) / 60_000;
  }
  return Math.round(total);
}

/** Instant reached after `minutes` working minutes starting at `from`. */
export function addWorkingMinutes(from: Date, minutes: number): Date {
  let remaining = minutes;
  let cursor = from.getTime() + OFFSET_MS;
  for (let guard = 0; guard < 3700; guard++) {
    const day = Math.floor(cursor / DAY_MS) * DAY_MS;
    if (isWorkingDay(day)) {
      const start = Math.max(cursor, day + DAY_START_MIN * 60_000);
      const end = day + DAY_END_MIN * 60_000;
      const available = Math.max(0, (end - start) / 60_000);
      if (remaining <= available) return new Date(start + remaining * 60_000 - OFFSET_MS);
      remaining -= available;
    }
    cursor = day + DAY_MS;
  }
  throw new Error('Working-time horizon exceeded');
}

export const addWorkingHours = (from: Date, hours: number) => addWorkingMinutes(from, hours * 60);
export const addWorkingDays = (from: Date, days: number) => addWorkingMinutes(from, days * MINUTES_PER_DAY);
export const workingDaysBetween = (from: Date, to: Date) => workingMinutesBetween(from, to) / MINUTES_PER_DAY;
