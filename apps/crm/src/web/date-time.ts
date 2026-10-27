/**
 * Vietnamese date and date-time entry. Field values keep the shape the forms already send through `fromLocalInput`:
 * "YYYY-MM-DDTHH:mm" (date-time) or "YYYY-MM-DD" (date), both in Vietnam time (UTC+7, no daylight saving).
 * People type and read "30/10/2026 09:00" with a 24-hour clock.
 */

export type DateFieldMode = 'date' | 'datetime';

const VN_OFFSET_MS = 7 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');

export interface VnDay { year: number; month: number; day: number }

/** The Vietnam calendar day and clock time of an instant. */
export function vnNow(now: Date = new Date()): VnDay & { hour: number; minute: number } {
  const d = new Date(now.getTime() + VN_OFFSET_MS);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(),
  };
}

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const dayValue = (d: VnDay) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

/** Splits a field value into its day and "HH:mm" time; null when it is not a valid value. */
export function splitFieldValue(value: string): { day: VnDay; time: string | null } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!m) return null;
  const day = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (!validDay(day)) return null;
  if (m[4] === undefined) return { day, time: null };
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (hour > 23 || minute > 59) return null;
  return { day, time: `${m[4]}:${m[5]}` };
}

function validDay(d: VnDay) {
  return d.year >= 1900 && d.year <= 2100 && d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= daysInMonth(d.year, d.month);
}

/** "30/10/2026 09:00" or "30/10/2026"; empty for an empty or malformed value. */
export function formatFieldValue(value: string): string {
  const parts = splitFieldValue(value);
  if (!parts) return '';
  const { day, time } = parts;
  const date = `${pad(day.day)}/${pad(day.month)}/${day.year}`;
  return time ? `${date} ${time}` : date;
}

const DATE_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/;
const TIME_RE = /^(\d{1,2})(?:(?::|h|g)(\d{2})?)?(?:h|g)?$/;

/**
 * Reads what a person typed. Accepts "31/10", "31/10/26", "31-10-2026", and for date-time a time after a space:
 * "14:00", "14h", "14h30", "9". A missing year is this year (Vietnam time); a missing time is `fallbackTime`.
 * Returns '' for a blank entry, the field value for a valid one, and null when the entry cannot be read or names a
 * day that does not exist (31/02).
 */
export function parseFieldInput(
  text: string,
  { mode, now = new Date(), fallbackTime = '09:00' }: { mode: DateFieldMode; now?: Date; fallbackTime?: string },
): string | null {
  const input = text.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!input) return '';
  // A pasted or stored value ("2026-10-31T14:00") is accepted as is.
  const stored = splitFieldValue(input.toUpperCase().replace(' ', 'T'));
  if (stored) {
    if (mode === 'date') return stored.time ? null : dayValue(stored.day);
    return `${dayValue(stored.day)}T${stored.time ?? fallbackTime}`;
  }

  // Spaces are collapsed again after the commas become spaces, so "lúc" is matched as a literal " lúc " (no
  // `\s+…\s+` scan, which is quadratic on a long run of commas or spaces).
  const [datePart, ...rest] = input.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().replace(' lúc ', ' ').split(' ');
  const timePart = rest.join('');
  const dm = DATE_RE.exec(datePart ?? '');
  if (!dm) return null;
  const year = dm[3] === undefined ? vnNow(now).year : dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
  const day = { year, month: Number(dm[2]), day: Number(dm[1]) };
  if (!validDay(day)) return null;
  if (mode === 'date') return timePart ? null : dayValue(day);

  let time = fallbackTime;
  if (timePart) {
    const tm = TIME_RE.exec(timePart);
    if (!tm) return null;
    const hour = Number(tm[1]);
    const minute = tm[2] === undefined ? 0 : Number(tm[2]);
    if (hour > 23 || minute > 59) return null;
    time = `${pad(hour)}:${pad(minute)}`;
  }
  return `${dayValue(day)}T${time}`;
}

/**
 * What a date field keeps when the person leaves it (blur) or presses Enter. A readable entry is committed; an entry
 * that cannot be read is not, and the field goes back to `revertTo`, the value it had when it gained focus. Typing
 * itself never commits, so a half-typed "2" over "09:00" never becomes 02:00.
 */
export function commitFieldText(
  text: string,
  { mode, revertTo, now, fallbackTime }: { mode: DateFieldMode; revertTo: string; now?: Date; fallbackTime?: string },
): { value: string; text: string; ok: boolean } {
  const parsed = parseFieldInput(text, { mode, now, fallbackTime: fallbackTime ?? splitFieldValue(revertTo)?.time ?? '09:00' });
  return parsed === null
    ? { value: revertTo, text: formatFieldValue(revertTo), ok: false }
    : { value: parsed, text: formatFieldValue(parsed), ok: true };
}

/** The value `days` Vietnam days from today at `hour`:`minute`, as a date-time field value. */
export function quickDueValue(days: number, hour: number, minute = 0, now: Date = new Date()): string {
  const today = vnNow(now);
  const d = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(hour)}:${pad(minute)}`;
}

/** The quick due choices shown under every task and next-action due field. */
export const QUICK_DUE_OPTIONS = [
  { label: 'Hôm nay 17:00', days: 0, hour: 17 },
  { label: 'Sáng mai 9:00', days: 1, hour: 9 },
  { label: '+3 ngày', days: 3, hour: 9 },
  { label: '+1 tuần', days: 7, hour: 9 },
] as const;

export const WEEKDAYS = [
  { short: 'T2', long: 'Thứ Hai' },
  { short: 'T3', long: 'Thứ Ba' },
  { short: 'T4', long: 'Thứ Tư' },
  { short: 'T5', long: 'Thứ Năm' },
  { short: 'T6', long: 'Thứ Sáu' },
  { short: 'T7', long: 'Thứ Bảy' },
  { short: 'CN', long: 'Chủ Nhật' },
] as const;

/** Monday-first index (0 = Thứ Hai … 6 = Chủ Nhật) of a calendar day. */
export const weekdayIndex = (d: VnDay) => (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;

/** Moves a calendar day by whole days, across months and years. */
export function addDays(d: VnDay, days: number): VnDay {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Six Monday-first weeks covering a month, with the neighbouring months' days marked `inMonth: false`. */
export function calendarWeeks(year: number, month: number): (VnDay & { inMonth: boolean })[][] {
  const first = { year, month, day: 1 };
  const start = addDays(first, -weekdayIndex(first));
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, w * 7 + i);
      return { ...d, inMonth: d.month === month };
    }));
}

/** "Thứ Năm, 30/10/2026": the spoken name of a calendar day button. */
export const dayLabel = (d: VnDay) => `${WEEKDAYS[weekdayIndex(d)]!.long}, ${pad(d.day)}/${pad(d.month)}/${d.year}`;
