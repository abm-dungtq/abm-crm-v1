import { foldText, type ApiError, type ApiResult, type CommandName } from '@abm/contracts';
import { replayInScope, runCommand, sha256 } from './commands';
import type { Actor } from './env';
import type { GuardedTx } from './guarded-tx';
import { dashboard, leadDetail, listLeads, listTasks } from './queries';
import { leadScope } from './scope';

type Args = Record<string, unknown>;
type Json = Record<string, unknown>;
type OnCommitted = (tx: GuardedTx) => Promise<void>;

const str = (description: string) => ({ type: 'string', description });
const nextAction = {
  type: 'object', description: 'Việc tiếp theo (Next Action)',
  properties: { title: str('Tên việc'), due_at: str('Hạn, ISO 8601') }, required: ['title', 'due_at'],
};
const schema = (properties: Json = {}, required: string[] = []) => ({ type: 'object', properties, required });

/** Tools the chat agent may call. Approvals and releasing a lead stay on the web on purpose. */
export const tools = [
  { name: 'whoami', description: 'Cho biết bạn đang dùng CRM với tư cách ai (tên, vai trò, nhóm, phòng ban).', inputSchema: schema() },
  {
    name: 'search_leads', description: 'Tìm lead trong phạm vi của bạn theo từ khóa, trạng thái hoặc stage. Trả tối đa 20 lead kèm SĐT, email.',
    inputSchema: schema({ q: str('Từ khóa: mã lead, tên khách, công ty, SĐT'), status: str('open, queue, active, won hoặc lost'), stage: str('Mã stage') }),
  },
  { name: 'get_lead', description: 'Xem chi tiết một lead theo mã (ví dụ L-0001).', inputSchema: schema({ lead_code: str('Mã lead') }, ['lead_code']) },
  { name: 'my_tasks', description: 'Danh sách việc cần làm của bạn.', inputSchema: schema({ status: str('open (mặc định) hoặc completed') }) },
  { name: 'dashboard_summary', description: 'Số liệu tổng quan pipeline trong phạm vi của bạn.', inputSchema: schema() },
  {
    name: 'create_lead', description: 'Tạo lead mới. Admin và BGĐ phải ghi rõ phòng ban.',
    inputSchema: schema({
      contact_name: str('Tên khách'), phone: str('SĐT'), email: str('Email'), company_name: str('Tên công ty'), tax_code: str('MST'),
      source: str('Nguồn: facebook, zalo, website, landing, form, referral, partner, self'), need_summary: str('Nhu cầu của khách'),
      department: str('Tên phòng ban (bắt buộc với Admin, BGĐ)'), confirm_not_duplicate: { type: 'boolean', description: 'Xác nhận không trùng sau khi đã kiểm tra' },
      next_action: nextAction,
    }, ['contact_name', 'source', 'need_summary']),
  },
  {
    name: 'log_activity', description: 'Ghi hoạt động cho lead (gọi điện, gặp mặt, email, nhắn tin, ghi chú…).',
    inputSchema: schema({
      lead_code: str('Mã lead'), type: str('call, meeting, email, message, customer_reply, file_sent, proposal_sent hoặc note'),
      summary: str('Nội dung'), occurred_at: str('Thời điểm, ISO 8601, mặc định là bây giờ'),
    }, ['lead_code', 'type', 'summary']),
  },
  {
    name: 'complete_task', description: 'Hoàn thành một việc. Nếu là Next Action của lead đang mở thì phải có next_action mới.',
    inputSchema: schema({ task_id: str('Mã việc'), outcome: str('Kết quả'), next_action: nextAction }, ['task_id']),
  },
  {
    name: 'change_stage', description: 'Đổi stage lead. Với người không phải Admin, bot chỉ tạo yêu cầu để xác nhận trên web.',
    inputSchema: schema({
      lead_code: str('Mã lead'), to_stage: str('Stage đích'), lost_reason: str('Lý do Lost'), lost_note: str('Ghi chú Lost'),
      won_value: { type: 'integer', description: 'Giá trị chốt (đồng)' }, won_note: str('Bằng chứng chốt'),
    }, ['lead_code', 'to_stage']),
  },
  {
    name: 'assign_lead', description: 'Giao lead cho người trong nhóm theo email. Với Leader, bot chỉ tạo yêu cầu để xác nhận trên web.',
    inputSchema: schema({ lead_code: str('Mã lead'), owner_email: str('Email người nhận'), next_action: nextAction }, ['lead_code', 'owner_email']),
  },
  {
    name: 'request_owner_change', description: 'Sale xin chuyển lead của mình cho người khác trong nhóm; Leader duyệt trên web.',
    inputSchema: schema({ lead_code: str('Mã lead'), new_owner_email: str('Email người nhận'), reason: str('Lý do') }, ['lead_code', 'new_owner_email', 'reason']),
  },
];

const fail = (code: ApiError['code'], message: string): ApiResult<never> => ({ ok: false, error: { code, message } });
const notFound = () => fail('NOT_FOUND', 'Không tìm thấy lead trong phạm vi của bạn');
const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
const toNextAction = (v: unknown) => {
  const n = v as { title?: unknown; due_at?: unknown } | undefined;
  return n && typeof n === 'object' ? { title: n.title, dueAt: n.due_at } : undefined;
};

/** Key order never changes the hash, so a retried call with reordered args is still the same call. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Json)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function leadByCode(db: D1Database, actor: Actor, code: unknown) {
  if (typeof code !== 'string' || !code.trim()) return null;
  const scope = leadScope(actor);
  return db.prepare(`SELECT l.id, l.version FROM lead l WHERE l.code = ? AND ${scope.sql}`)
    .bind(code.trim().toUpperCase(), ...scope.binds).first<{ id: string; version: number }>();
}

async function userIdByEmail(db: D1Database, actor: Actor, email: unknown) {
  if (typeof email !== 'string') return undefined;
  return (await db.prepare(`SELECT id FROM app_user WHERE organization_id = ? AND lower(email) = ? AND status = 'active'`)
    .bind(actor.organizationId, email.trim().toLowerCase()).first<{ id: string }>())?.id;
}

const REPLAY_WINDOW_MS = 5 * 60_000;

/**
 * The bot sends no Idempotency-Key, so the key comes from the call itself. The same call by the same
 * person within a few minutes is a retry and gets the first result back. Later it is a new intent
 * (another activity, or a proposal again after a rejection) and runs under a fresh key. The first
 * call uses a fixed suffix so two identical calls arriving together still write once.
 */
async function command(db: D1Database, actor: Actor, tool: string, args: Args, name: CommandName, onCommitted: OnCommitted, input: Json) {
  const base = `mcp:${await sha256(tool + canonicalJson(args))}:`;
  // ';' sorts right after ':', so this range is every key with the prefix and stays on the primary key index.
  const recent = await db.prepare(`SELECT key, created_at, result_json FROM idempotency_key
    WHERE actor_user_id = ? AND key >= ? AND key < ? ORDER BY created_at DESC LIMIT 1`)
    .bind(actor.id, base, `${base.slice(0, -1)};`).first<{ key: string; created_at: string; result_json: string }>();
  if (recent && Date.now() - Date.parse(recent.created_at) < REPLAY_WINDOW_MS) {
    return replayInScope(db, actor, name, input, JSON.parse(recent.result_json) as ApiResult<unknown>);
  }
  const key = `${base}${recent ? Date.now() : 0}`;
  const result = await runCommand(db, actor, name, input, key, onCommitted);
  if (result.ok || result.error.code !== 'IDEMPOTENCY_CONFLICT') return result;
  // A concurrent identical call won the key with a different expectedVersion: return its result.
  const winner = await db.prepare('SELECT result_json FROM idempotency_key WHERE actor_user_id = ? AND key = ?').bind(actor.id, key).first<{ result_json: string }>();
  return winner ? replayInScope(db, actor, name, input, JSON.parse(winner.result_json) as ApiResult<unknown>) : result;
}
async function writeTool(db: D1Database, actor: Actor, name: string, args: Args, onCommitted: OnCommitted): Promise<ApiResult<unknown>> {
  if (name === 'create_lead') {
    let departmentId: string | undefined;
    if (!actor.departmentId) {
      const wanted = text(args.department);
      const departments = (await db.prepare('SELECT id, name FROM department WHERE organization_id = ?').bind(actor.organizationId)
        .all<{ id: string; name: string }>()).results;
      departmentId = wanted ? departments.find((d) => foldText(d.name) === foldText(wanted))?.id : undefined;
      if (!departmentId) return fail('VALIDATION_FAILED', `Cần ghi rõ phòng ban: ${departments.map((d) => d.name).join(', ')}`);
    }
    return command(db, actor, name, args, 'createLead', onCommitted, {
      contactName: args.contact_name, phone: args.phone, email: args.email, companyName: args.company_name, taxCode: args.tax_code,
      source: args.source, needSummary: args.need_summary, confirmNotDuplicate: args.confirm_not_duplicate,
      nextAction: toNextAction(args.next_action), departmentId,
    });
  }
  if (name === 'complete_task') {
    const scope = leadScope(actor);
    const task = typeof args.task_id === 'string'
      ? await db.prepare(`SELECT tk.id, tk.version FROM task tk JOIN lead l ON l.id = tk.lead_id WHERE tk.id = ? AND ${scope.sql}`)
        .bind(args.task_id, ...scope.binds).first<{ id: string; version: number }>()
      : null;
    if (!task) return fail('NOT_FOUND', 'Không tìm thấy việc trong phạm vi của bạn');
    return command(db, actor, name, args, 'completeTask', onCommitted, {
      taskId: task.id, expectedVersion: task.version, outcome: args.outcome, nextAction: toNextAction(args.next_action),
    });
  }

  const lead = await leadByCode(db, actor, args.lead_code);
  if (!lead) return notFound();
  const target = { leadId: lead.id, expectedVersion: lead.version };
  if (name === 'log_activity') {
    return command(db, actor, name, args, 'logActivity', onCommitted, { ...target, type: args.type, summary: args.summary, occurredAt: args.occurred_at });
  }
  if (name === 'change_stage') {
    return command(db, actor, name, args, 'changeStage', onCommitted, {
      ...target, toStage: args.to_stage, lostReason: args.lost_reason, lostNote: args.lost_note, wonValue: args.won_value, wonNote: args.won_note,
    });
  }
  if (name === 'assign_lead') {
    const ownerUserId = await userIdByEmail(db, actor, args.owner_email);
    if (!ownerUserId) return fail('VALIDATION_FAILED', 'Không tìm thấy người nhận theo email');
    return command(db, actor, name, args, 'assignLead', onCommitted, { ...target, ownerUserId, nextAction: toNextAction(args.next_action) });
  }
  const toUserId = await userIdByEmail(db, actor, args.new_owner_email);
  if (!toUserId) return fail('VALIDATION_FAILED', 'Không tìm thấy người nhận theo email');
  const requested = await command(db, actor, name, args, 'requestOwnerChange', onCommitted, { ...target, toUserId, reason: args.reason });
  return requested.ok ? { ok: true, data: { status: 'pending_approval', kind: 'owner_change', ...(requested.data as Json) } } : requested;
}

async function readTool(db: D1Database, actor: Actor, name: string, args: Args): Promise<ApiResult<unknown>> {
  if (name === 'whoami') {
    const names = await db.prepare(`SELECT (SELECT name FROM team WHERE id = ?) AS team, (SELECT name FROM department WHERE id = ?) AS department`)
      .bind(actor.teamId, actor.departmentId).first<{ team: string | null; department: string | null }>();
    return { ok: true, data: { id: actor.id, displayName: actor.displayName, role: actor.role, team: names?.team ?? null, department: names?.department ?? null } };
  }
  if (name === 'search_leads') {
    const leads = (await listLeads(db, actor, { q: text(args.q), status: text(args.status), stage: text(args.stage) })).slice(0, 20);
    // The ids come from the scoped list, so this lookup cannot widen what the actor sees.
    const points = (await db.prepare(`SELECT l.id, cp.type, cp.value FROM lead l JOIN contact_point cp ON cp.contact_id = l.contact_id
      WHERE l.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(leads.map((l) => l.id))).all<{ id: string; type: string; value: string }>()).results;
    const pick = (id: string, type: string) => points.filter((p) => p.id === id && p.type === type).map((p) => p.value);
    return {
      ok: true,
      data: leads.map((l) => ({
        code: l.code, contactName: l.contactName, company: l.account?.name ?? null, stage: l.stage, status: l.status,
        owner: l.owner?.name ?? null, phones: pick(l.id, 'phone'), emails: pick(l.id, 'email'), nextAction: l.nextAction,
      })),
    };
  }
  if (name === 'get_lead') {
    const lead = await leadByCode(db, actor, args.lead_code);
    const detail = lead ? await leadDetail(db, actor, lead.id) : null;
    return detail ? { ok: true, data: detail } : notFound();
  }
  if (name === 'my_tasks') return { ok: true, data: await listTasks(db, actor, args.status === 'completed' ? 'completed' : 'open') };
  return { ok: true, data: await dashboard(db, actor) };
}

const READ_TOOLS = new Set(['whoami', 'search_leads', 'get_lead', 'my_tasks', 'dashboard_summary']);
const WRITE_TOOLS = new Set(['create_lead', 'log_activity', 'complete_task', 'change_stage', 'assign_lead', 'request_owner_change']);

function pendingMessage(data: { toStage?: string | null; kind?: string }, origin: string) {
  const leaderDecides = data.kind !== 'agent_stage_change' || data.toStage === 'won' || data.toStage === 'lost';
  return leaderDecides
    ? 'Đã tạo yêu cầu, Leader sẽ được báo qua Lark'
    : `Đã tạo yêu cầu. Bạn hoặc Leader xác nhận trên web: ${origin}/approvals`;
}

const toolResult = (value: unknown, isError = false) =>
  ({ content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });

/** Identity always comes from the token: fields such as acting_user or user_id in args are never read. */
export async function callTool(db: D1Database, actor: Actor, name: string, args: Args, origin: string, onCommitted: OnCommitted) {
  if (!READ_TOOLS.has(name) && !WRITE_TOOLS.has(name)) return toolResult({ code: 'UNKNOWN_TOOL', message: 'Không có công cụ này' }, true);
  const result = READ_TOOLS.has(name) ? await readTool(db, actor, name, args) : await writeTool(db, actor, name, args, onCommitted);
  if (!result.ok) return toolResult(result.error, true);
  const data = result.data as { status?: string; toStage?: string | null; kind?: string };
  if (data && data.status === 'pending_approval') return toolResult({ ...data, message: pendingMessage(data, origin) });
  return toolResult(result.data);
}
