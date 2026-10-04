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

/** Value for <input type="datetime-local"> in Vietnam time. */
export function toLocalInput(date: Date) {
  const vn = new Date(date.getTime() + 7 * 3600_000);
  return vn.toISOString().slice(0, 16);
}
/** Parse a datetime-local value entered in Vietnam time to ISO UTC. */
export function fromLocalInput(value: string) {
  return new Date(`${value}:00+07:00`).toISOString();
}

export const initials = (name: string | null | undefined) =>
  (name ?? '?').split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase();
