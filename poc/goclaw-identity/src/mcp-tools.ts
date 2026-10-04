export type Subject = { subject_type: 'user' | 'group'; subject_id: string };

export const tools = [
  { name: 'whoami', description: 'Return the principal authenticated by the MCP credential.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'add_activity', description: 'Record an activity using the authenticated principal.',
    inputSchema: { type: 'object', properties: {
      lead_ref: { type: 'string', minLength: 1, maxLength: 200 },
      note: { type: 'string', minLength: 1, maxLength: 4000 },
      acting_user: { type: 'string', description: 'Ignored; identity comes from credentials.' }
    }, required: ['lead_ref', 'note'], additionalProperties: false } }
];

export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export async function resolveSubject(db: D1Database, header?: string): Promise<Subject | null> {
  const token = header?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return null;
  const subject = await db.prepare('SELECT subject_type, subject_id FROM mcp_credential WHERE token_hash = ? AND revoked = 0')
    .bind(await tokenHash(token)).first<Subject>();
  if (!subject) return null;
  const table = subject.subject_type === 'user' ? 'user' : 'lark_group_binding';
  return await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(subject.subject_id).first() ? subject : null;
}

export function toolResult(value: unknown, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

export async function callTool(db: D1Database, subject: Subject, name: string, args: Record<string, unknown>) {
  if (name === 'whoami') {
    const detail = subject.subject_type === 'user'
      ? await db.prepare('SELECT email AS user_email FROM user WHERE id = ?').bind(subject.subject_id).first()
      : await db.prepare('SELECT department FROM lark_group_binding WHERE id = ?').bind(subject.subject_id).first();
    return toolResult({ ...subject, ...detail });
  }
  if (name !== 'add_activity') return toolResult({ code: 'UNKNOWN_TOOL' }, true);
  if (typeof args.lead_ref !== 'string' || !args.lead_ref.trim() || args.lead_ref.length > 200 ||
      typeof args.note !== 'string' || !args.note.trim() || args.note.length > 4000) {
    return toolResult({ code: 'INVALID_INPUT' }, true);
  }
  const enabled = await db.prepare('SELECT enabled FROM agent_kill_switch WHERE id = 1').first<number>('enabled');
  if (enabled !== 0) return toolResult({ code: 'KILL_SWITCH_ON' }, true);
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare('INSERT INTO activity (id, lead_ref, note, subject_type, subject_id) VALUES (?, ?, ?, ?, ?)')
        .bind(id, args.lead_ref, args.note, subject.subject_type, subject.subject_id),
      db.prepare("INSERT INTO audit_log (id, activity_id, executing_actor, initiating_user, subject_type, subject_id, action) VALUES (?, ?, 'goclaw', ?, ?, ?, 'add_activity')")
        .bind(crypto.randomUUID(), id, subject.subject_type === 'user' ? subject.subject_id : null, subject.subject_type, subject.subject_id)
    ]);
  } catch (error) {
    if (String(error).includes('KILL_SWITCH_ON')) return toolResult({ code: 'KILL_SWITCH_ON' }, true);
    throw error;
  }
  return toolResult({ id, ...subject });
}
