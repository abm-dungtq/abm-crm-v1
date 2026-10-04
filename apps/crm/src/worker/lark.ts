import type { Env } from './env';

// Must be the same Lark app as the GoClaw bot: open_id differs per app.
const LARK_BASE = 'https://open.larksuite.com/open-apis';
const BATCH_SIZE = 50;

export class LarkError extends Error {}

interface LarkReply { code?: number; msg?: string }

/** Calls Lark and surfaces its code/msg only; tokens and secrets never enter the message. */
async function larkPost<T extends LarkReply>(url: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const reply = await res.json().catch(() => ({})) as T;
  if (!res.ok || reply.code !== 0) {
    throw new LarkError(`Lark từ chối (HTTP ${res.status}, code ${reply.code ?? '?'}: ${reply.msg ?? 'không rõ'})`);
  }
  return reply;
}

/** Maps each email (lower-cased) to its open_id, or null when Lark has no such user. */
export async function lookupOpenIds(env: Env, emails: string[]): Promise<Map<string, string | null>> {
  if (!env.LARK_APP_ID || !env.LARK_APP_SECRET) throw new LarkError('Chưa cấu hình app Lark');
  const auth = await larkPost<LarkReply & { tenant_access_token?: string }>(`${LARK_BASE}/auth/v3/tenant_access_token/internal`,
    { app_id: env.LARK_APP_ID, app_secret: env.LARK_APP_SECRET });
  if (!auth.tenant_access_token) throw new LarkError('Lark không trả token');
  const result = new Map<string, string | null>(emails.map((e) => [e.toLowerCase(), null]));
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const reply = await larkPost<LarkReply & { data?: { user_list?: { email?: string; user_id?: string }[] } }>(
      `${LARK_BASE}/contact/v3/users/batch_get_id?user_id_type=open_id`, { emails: emails.slice(i, i + BATCH_SIZE) }, auth.tenant_access_token);
    for (const u of reply.data?.user_list ?? []) {
      if (u.email) result.set(u.email.toLowerCase(), u.user_id || null);
    }
  }
  return result;
}
