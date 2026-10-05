import { CONSENT_PURPOSES, type AnonymizeContactInput, type CreatePrivacyRequestInput, type ResolvePrivacyRequestInput } from '@abm/contracts';
import { fail, ok, type Ctx } from './command-result';
import type { Actor } from './env';
import { customerScope } from './scope';

const ANONYMOUS_NAME = 'Đã ẩn danh';

/** Sale and Leader record a request only for a customer they hold. Other allowed roles record one for any learner. */
async function createPrivacyRequest({ db, actor, input, tx }: Ctx<CreatePrivacyRequestInput>) {
  const contact = await db.prepare('SELECT id FROM contact WHERE id = ? AND organization_id = ?')
    .bind(input.contactId, actor.organizationId).first<{ id: string }>();
  if (!contact) return fail('NOT_FOUND', 'Không tìm thấy khách học viên');
  if (actor.role === 'sale' || actor.role === 'leader') {
    const scope = customerScope(actor);
    const allowed = await db.prepare(`SELECT 1 AS ok FROM contact c WHERE c.id = ? AND ${scope.sql}`)
      .bind(input.contactId, ...scope.binds).first();
    if (!allowed) return fail('FORBIDDEN', 'Khách này không thuộc phạm vi của bạn');
  } else {
    const learner = await db.prepare(`SELECT 1 AS ok FROM lead WHERE contact_id = ? AND organization_id = ? AND pipeline = 'learner'`)
      .bind(input.contactId, actor.organizationId).first();
    if (!learner) return fail('NOT_FOUND', 'Không tìm thấy khách học viên');
  }
  const id = crypto.randomUUID();
  tx.insertVersioned('privacy_request', {
    id, organization_id: actor.organizationId, contact_id: input.contactId, kind: input.kind,
    detail: input.detail ?? null, status: 'open', created_by_user_id: actor.id,
  });
  tx.audit('privacy_request', id, null, { kind: input.kind, contactId: input.contactId });
  return ok({ id, version: 1 });
}

async function resolvePrivacyRequest({ db, actor, input, tx }: Ctx<ResolvePrivacyRequestInput>) {
  const request = await db.prepare('SELECT version, status FROM privacy_request WHERE id = ? AND organization_id = ?')
    .bind(input.requestId, actor.organizationId).first<{ version: number; status: string }>();
  if (!request) return fail('NOT_FOUND', 'Không tìm thấy yêu cầu');
  if (request.version !== input.version) return fail('STALE_VERSION', 'Yêu cầu vừa được người khác cập nhật. Tải lại rồi thử lại.');
  if (request.status !== 'open') return fail('VALIDATION_FAILED', 'Yêu cầu đã được xử lý');
  tx.update('privacy_request', input.requestId, input.version, {
    status: input.status, resolution: input.resolution, resolved_by_user_id: actor.id, resolved_at: tx.now,
  });
  tx.audit('privacy_request', input.requestId, { status: 'open' }, { status: input.status });
  return ok({ id: input.requestId, version: input.version + 1 });
}

/**
 * Hides the name and every contact point, archives the contact and withdraws consent.
 * Money rows and free-text notes stay. The audit before-image stores no old name or phone.
 */
async function anonymizeContact({ db, actor, input, tx }: Ctx<AnonymizeContactInput>) {
  const contact = await db.prepare('SELECT version FROM contact WHERE id = ? AND organization_id = ?')
    .bind(input.contactId, actor.organizationId).first<{ version: number }>();
  if (!contact) return fail('NOT_FOUND', 'Không tìm thấy khách học viên');
  if (contact.version !== input.version) return fail('STALE_VERSION', 'Hồ sơ vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const request = await db.prepare(`SELECT version, kind, status, contact_id FROM privacy_request WHERE id = ? AND organization_id = ?`)
    .bind(input.requestId, actor.organizationId).first<{ version: number; kind: string; status: string; contact_id: string }>();
  if (!request || request.kind !== 'delete' || request.status !== 'open' || request.contact_id !== input.contactId) {
    return fail('VALIDATION_FAILED', 'Cần một yêu cầu xóa hồ sơ đang mở của chính khách này');
  }
  tx.update('contact', input.contactId, input.version, { display_name: ANONYMOUS_NAME, archived_at: tx.now });
  tx.raw(db.prepare(`UPDATE contact_point SET value = '***', normalized_value = '***' || id WHERE contact_id = ?`).bind(input.contactId));
  for (const purpose of CONSENT_PURPOSES) {
    tx.raw(db.prepare(`INSERT INTO consent (id, contact_id, purpose, granted, note, recorded_by_user_id, recorded_at)
      VALUES (?, ?, ?, 0, NULL, ?, ?)`).bind(crypto.randomUUID(), input.contactId, purpose.code, actor.id, tx.now));
  }
  tx.assert(`SELECT kind = 'delete' AND status = 'open' AND contact_id = ? FROM privacy_request WHERE id = ?`, [input.contactId, input.requestId]);
  tx.update('privacy_request', input.requestId, request.version, {
    status: 'done', resolution: 'Đã ẩn danh hồ sơ', resolved_by_user_id: actor.id, resolved_at: tx.now,
  });
  tx.audit('contact', input.contactId, { anonymized: true }, { displayName: ANONYMOUS_NAME, archived: true, requestId: input.requestId });
  return ok({ contactId: input.contactId, version: input.version + 1 });
}

export async function listPrivacyRequests(db: D1Database, actor: Actor) {
  const rows = await db.prepare(`SELECT r.id, r.contact_id, c.display_name AS contact_name, c.version AS contact_version,
      r.kind, r.status, r.detail, r.resolution, r.version, r.created_at
    FROM privacy_request r JOIN contact c ON c.id = r.contact_id
    WHERE r.organization_id = ?
    ORDER BY r.created_at DESC, r.id LIMIT 500`).bind(actor.organizationId).all<{
    id: string; contact_id: string; contact_name: string; contact_version: number; kind: string; status: string;
    detail: string | null; resolution: string | null; version: number; created_at: string;
  }>();
  return rows.results.map((row) => ({
    id: row.id, contactId: row.contact_id, contactName: row.contact_name, contactVersion: row.contact_version,
    kind: row.kind, status: row.status, detail: row.detail, resolution: row.resolution, version: row.version, createdAt: row.created_at,
  }));
}

export const privacyHandlers = { createPrivacyRequest, resolvePrivacyRequest, anonymizeContact };
