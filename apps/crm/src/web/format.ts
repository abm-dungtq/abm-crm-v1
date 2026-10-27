import { MAX_DEAL_VALUE } from '@abm/contracts';

const TZ = 'Asia/Ho_Chi_Minh';

/** Đồng amounts accept ungrouped integers or consistent groups of three digits. */
export function parseWonAmount(input: string): number | null {
  const text = input.trim();
  if (!/^(?:\d+|\d{1,3}([., ])\d{3}(?:\1\d{3})*)$/.test(text)) return null;
  const amount = Number(text.replace(/[., ]/g, ''));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_DEAL_VALUE ? amount : null;
}

const dateTime = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateOnly = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** dd/MM HH:mm in Vietnam time; the year is added when it is not the current year, or always with `withYear`. */
export function fmtDateTime(iso: string | null | undefined, withYear = false) {
  if (!iso) return '—';
  const p = Object.fromEntries(dateTime.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const showYear = withYear || p.year !== dayKey.format(new Date()).slice(0, 4);
  return `${p.day}/${p.month}${showYear ? `/${p.year}` : ''} ${p.hour}:${p.minute}`;
}
export const fmtDate = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : '—');

/** "Hôm nay 14:30", "Ngày mai 09:00", "Hôm qua …" or a short date, in Vietnam time. */
export function fmtDue(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = dayKey.format(new Date());
  const target = dayKey.format(d);
  const diff = Math.round((Date.parse(target) - Date.parse(today)) / 86_400_000);
  const time = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
  if (diff === 0) return `Hôm nay ${time}`;
  if (diff === 1) return `Ngày mai ${time}`;
  if (diff === -1) return `Hôm qua ${time}`;
  return fmtDateTime(iso);
}

/**
 * A due time read at a glance: "Quá 3 ngày" when it passed on an earlier Vietnam day, "Quá hạn 09:00" when it passed
 * earlier today, otherwise `fmtDue` ("Hôm nay 17:00", "Ngày mai 09:00", "30/10 09:00").
 */
export function fmtDueRelative(iso: string | null | undefined, now: Date = new Date()) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (d.getTime() >= now.getTime()) return fmtDue(iso);
  const days = Math.round((Date.parse(dayKey.format(now)) - Date.parse(dayKey.format(d))) / 86_400_000);
  if (days >= 1) return `Quá ${days} ngày`;
  const time = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `Quá hạn ${time}`;
}

export function fmtAgo(iso: string | null | undefined) {
  if (!iso) return '—';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return fmtDate(iso);
}

/** Money is stored as integer đồng; show compact Vietnamese units. */
export function fmtMoney(value: number | null | undefined, compact = true) {
  if (value == null) return '—';
  if (!compact) return `${new Intl.NumberFormat('vi-VN').format(value)} ₫`;
  if (value >= 1e9) return `${trim(value / 1e9)} tỷ`;
  if (value >= 1e6) return `${trim(value / 1e6)} tr`;
  return `${new Intl.NumberFormat('vi-VN').format(value)} ₫`;
}
const trim = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);

export const fmtHours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} giờ${m ? ` ${m} phút` : ''}` : `${m} phút`;
};

/** A date-time field value ("YYYY-MM-DDTHH:mm") in Vietnam time. */
export function toLocalInput(date: Date) {
  const vn = new Date(date.getTime() + 7 * 3600_000);
  return vn.toISOString().slice(0, 16);
}
/** A date-time field value entered in Vietnam time, as ISO UTC. */
export function fromLocalInput(value: string) {
  return new Date(`${value}:00+07:00`).toISOString();
}

export const initials = (name: string | null | undefined) =>
  (name ?? '?').split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase();
