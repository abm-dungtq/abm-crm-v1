import type { ChannelKind } from '@abm/contracts';
import type { ConversationFilter, InboxMessage } from './types';

// Pure inbox helpers of the web app, kept free of React so they can be tested on their own.

/** Query string of GET /inbox/conversations; empty filters are left out. */
export function conversationsPath(filter: ConversationFilter = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter) as [keyof ConversationFilter, string | undefined][]) {
    const text = value?.trim();
    if (text) params.set(key, text);
  }
  const query = params.toString();
  return `/inbox/conversations${query ? `?${query}` : ''}`;
}

/** Adds or replaces messages by id, keeping the list oldest first. */
export function mergeMessages(prev: InboxMessage[], incoming: InboxMessage[]) {
  if (!incoming.length) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/**
 * Who wrote an outgoing message, or null for customer messages and system notes. A reply typed outside the CRM comes from the shared
 * phone on Zalo, but from Meta Business Suite on a Facebook Page.
 */
export function senderLabel(m: Pick<InboxMessage, 'senderKind' | 'sentByName'>, channel: ChannelKind) {
  switch (m.senderKind) {
    case 'bot': return 'Bot';
    case 'staff_web': return m.sentByName ?? 'Nhân viên';
    case 'staff_phone': return channel === 'facebook' ? 'Meta Business Suite' : 'Điện thoại';
    default: return null;
  }
}

const EVERY_DAY_MASK = 0b1111111;
/** Bit 0 = Monday … bit 6 = Sunday, as on the Worker. */
export const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const;

/** "Hằng ngày" for every day, otherwise the chosen days Monday first; "—" for none. */
export function weekdaysLabel(mask: number) {
  if ((mask & EVERY_DAY_MASK) === EVERY_DAY_MASK) return 'Hằng ngày';
  return WEEKDAYS.filter((_, i) => (mask & (1 << i)) !== 0).join(', ') || '—';
}
