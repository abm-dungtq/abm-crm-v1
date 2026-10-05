import { CONSENT_PURPOSES, foldText, learnerLostReasonLabel, sourceLabel, stageLabel } from '@abm/contracts';
import type { Actor } from './env';
import { CONTACT_STATE_COLUMNS, IN_POOL_SQL, heldNow, type ContactState } from './learner-hold';
import { searchMatcher, teamMembers } from './queries';
import { customerScope } from './scope';

const LEARNER_READERS = ['sale', 'leader', 'director', 'admin'];
/** Learner screens: Sale, Leader and Admin work them, BGĐ reads them organization-wide. */
export const canReadLearners = (actor: Actor) => LEARNER_READERS.includes(actor.role);

const LIST_CANDIDATE_LIMIT = 2000;
const LIST_LIMIT = 500;

/** Who sees a held customer's phone and holder: its owner, the owner's team Leader, Admin and BGĐ. */
export function mayInspect(actor: Actor, row: Pick<ContactState, 'owner_user_id' | 'owner_team_id'>, held: boolean) {
  return !held || row.owner_user_id === actor.id || actor.role === 'admin' || actor.role === 'director'
    || (actor.role === 'leader' && actor.teamId !== null && row.owner_team_id === actor.teamId);
}

/** A learner phone is returned only when `mayInspect` allows it. Anything else becomes null. */
export function maskPhoneForActor(actor: Actor, row: Pick<ContactState, 'owner_user_id' | 'owner_team_id'>, held: boolean, phone: string | null) {
  return mayInspect(actor, row, held) ? phone : null;
}

/**
 * Whether each lead's phone may be shown. A learner lead fails closed when its customer state is missing,
 * and only a role that can open the learner screens may see the number — a shared-pool customer included.
 * Other pipelines are not masked here.
 */
export async function learnerPhoneVisible(db: D1Database, actor: Actor, leadIds: string[]) {
  const visible = new Map<string, boolean>();
  if (leadIds.length === 0) return visible;
  const rows = await db.prepare(`SELECT l.id AS lead_id, l.pipeline, ${CONTACT_STATE_COLUMNS}
    FROM lead l JOIN contact c ON c.id = l.contact_id
    WHERE l.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(leadIds))
    .all<ContactState & { lead_id: string; pipeline: string }>();
  const now = new Date();
  for (const row of rows.results) {
    visible.set(row.lead_id, row.pipeline === 'learner'
      ? canReadLearners(actor) && maskPhoneForActor(actor, row, heldNow(row, now), 'kept') !== null
      : true);
  }
  return visible;
}

/** A customer in the shared pool has no holder; a held one shows its holder only to people who may inspect it. */
const ownerLabel = (held: boolean, inspect: boolean, name: string | null) => (!held ? 'Chưa gắn' : inspect ? name : null);

export interface LearnerFilter {
  view?: string;
  q?: string;
  ownerId?: string;
  stage?: string;
  course?: string;
}

interface LearnerListRow extends ContactState {
  stage: string; source: string; contract_name: string | null; owner_name: string | null;
  phone: string | null; phone_key: string | null; course: string | null;
}

export async function listLearners(db: D1Database, actor: Actor, filter: LearnerFilter = {}) {
  const now = new Date();
  const pool = filter.view === 'pool';
  const where = ['c.organization_id = ?', 'c.archived_at IS NULL'];
  const binds: unknown[] = [actor.organizationId];
  if (pool) {
    where.push(IN_POOL_SQL);
    binds.push(now.toISOString());
  } else {
    const scope = customerScope(actor);
    where.push(scope.sql);
    binds.push(...scope.binds);
    // A Sale sees only the own customers, so the owner filter is ignored for that role.
    if (filter.ownerId && actor.role !== 'sale') {
      where.push('c.owner_user_id = ?');
      binds.push(filter.ownerId);
    }
  }
  if (filter.stage) {
    where.push('lt.stage = ?');
    binds.push(filter.stage);
  }
  const rows = await db.prepare(`
    WITH latest AS (
      SELECT l.contact_id, l.stage, l.source, l.partner_contract_id,
        ROW_NUMBER() OVER (PARTITION BY l.contact_id ORDER BY l.created_at DESC, l.rowid DESC) AS rn
      FROM lead l WHERE l.organization_id = ? AND l.pipeline = 'learner')
    SELECT ${CONTACT_STATE_COLUMNS}, lt.stage, lt.source, pc.name AS contract_name, ow.display_name AS owner_name,
      (SELECT cp.value FROM contact_point cp WHERE cp.contact_id = c.id AND cp.type = 'phone' ORDER BY cp.created_at LIMIT 1) AS phone,
      (SELECT cp.normalized_value FROM contact_point cp WHERE cp.contact_id = c.id AND cp.type = 'phone' ORDER BY cp.created_at LIMIT 1) AS phone_key,
      COALESCE(
        (SELECT group_concat(name, ', ') FROM (
          SELECT DISTINCT co.name AS name FROM enrollment e
          JOIN class_group cg ON cg.id = e.class_id JOIN course co ON co.id = cg.course_id
          WHERE e.contact_id = c.id AND e.status IN ('pending', 'confirmed', 'studying', 'deferred')
          ORDER BY name)),
        (SELECT group_concat(p.name, ', ') FROM customer_product cpr JOIN product p ON p.id = cpr.product_id
          WHERE cpr.contact_id = c.id AND cpr.detached_at IS NULL)) AS course
    FROM contact c
    JOIN latest lt ON lt.contact_id = c.id AND lt.rn = 1
    LEFT JOIN app_user ow ON ow.id = c.owner_user_id
    LEFT JOIN partner_contract pc ON pc.id = lt.partner_contract_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.updated_at DESC, c.id LIMIT ${LIST_CANDIDATE_LIMIT}`).bind(actor.organizationId, ...binds).all<LearnerListRow>();

  const q = filter.q?.trim();
  const matcher = q ? searchMatcher(q) : null;
  const courseKey = filter.course ? foldText(filter.course) : null;
  const items = [];
  for (const row of rows.results) {
    const held = heldNow(row, now);
    const inspect = mayInspect(actor, row, held);
    // A masked phone must not be searchable either, or the filter would reveal it digit by digit.
    if (matcher && !matcher([row.display_name, inspect ? row.phone_key : null])) continue;
    if (courseKey && !foldText(row.course ?? '').includes(courseKey)) continue;
    items.push({
      contactId: row.id, name: row.display_name, phone: inspect ? row.phone : null,
      ownerName: ownerLabel(held, inspect, row.owner_name), stage: row.stage, stageLabel: stageLabel(row.stage, 'learner'),
      course: row.course ?? '', source: row.source, sourceLabel: sourceLabel(row.source), contract: row.contract_name,
      holdExpiresAt: row.hold_expires_at, version: row.version, held,
      canClaim: !held && (actor.role === 'sale' || actor.role === 'leader'),
    });
  }
  return { items: items.slice(0, LIST_LIMIT), truncated: items.length > LIST_LIMIT || rows.results.length >= LIST_CANDIDATE_LIMIT };
}

export async function learnerDetail(db: D1Database, actor: Actor, contactId: string) {
  const now = new Date();
  const state = await db.prepare(`SELECT ${CONTACT_STATE_COLUMNS}, ow.display_name AS owner_name FROM contact c
    LEFT JOIN app_user ow ON ow.id = c.owner_user_id
    WHERE c.id = ? AND c.organization_id = ?`).bind(contactId, actor.organizationId)
    .first<ContactState & { owner_name: string | null }>();
  if (!state?.has_learner_lead) return null;
  const held = heldNow(state, now);
  const inspect = mayInspect(actor, state, held);
  const scope = customerScope(actor);
  const inScope = Boolean(await db.prepare(`SELECT 1 AS ok FROM contact c WHERE c.id = ? AND ${scope.sql}`).bind(contactId, ...scope.binds).first());

  const points = inspect
    ? (await db.prepare('SELECT type, value FROM contact_point WHERE contact_id = ? ORDER BY type, created_at').bind(contactId).all<{ type: string; value: string }>()).results
    : [];
  const contact = {
    id: state.id, name: state.display_name, version: state.version, held,
    phone: points.find((p) => p.type === 'phone')?.value ?? null, email: points.find((p) => p.type === 'email')?.value ?? null,
    ownerName: ownerLabel(held, inspect, state.owner_name), holdExpiresAt: state.hold_expires_at,
  };
  const mayClaim = !held && (actor.role === 'sale' || actor.role === 'leader');

  const latest = await db.prepare(`SELECT stage, source FROM lead WHERE contact_id = ? AND pipeline = 'learner' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .bind(contactId).first<{ stage: string; source: string }>();
  // Outside the actor's own scope only the shared-pool basics are returned, never the history.
  if (!inScope) {
    return {
      restricted: true, contact,
      summary: latest ? { stage: latest.stage, stageLabel: stageLabel(latest.stage, 'learner'), source: latest.source, sourceLabel: sourceLabel(latest.source) } : null,
      permissions: { work: false, claim: mayClaim, changeOwner: false },
    };
  }

  const [leads, steps, products, consents, activities, enrollments] = await Promise.all([
    db.prepare(`SELECT l.id, l.code, l.stage, l.status, l.source, l.need_summary, l.lost_reason, l.lost_note, l.won_note, l.version, l.created_at, l.closed_at,
        l.partner_contract_id, pc.name AS contract_name, na.id AS na_id, na.title AS na_title, na.due_at AS na_due_at
      FROM lead l LEFT JOIN partner_contract pc ON pc.id = l.partner_contract_id LEFT JOIN task na ON na.id = l.next_action_task_id
      WHERE l.contact_id = ? AND l.pipeline = 'learner' ORDER BY l.created_at DESC, l.rowid DESC`).bind(contactId).all<Record<string, unknown>>(),
    db.prepare(`SELECT s.lead_id, s.step_code, s.label, s.required, s.position, s.status, s.skip_reason, s.done_at FROM lead_step s
      WHERE s.lead_id IN (SELECT id FROM lead WHERE contact_id = ? AND pipeline = 'learner') ORDER BY s.position`).bind(contactId)
      .all<{ lead_id: string; step_code: string; label: string; required: number; position: number; status: string; skip_reason: string | null; done_at: string | null }>(),
    db.prepare(`SELECT cp.id, cp.version, cp.attached_at, cp.detached_at, p.id AS product_id, p.name, p.price_vnd
      FROM customer_product cp JOIN product p ON p.id = cp.product_id WHERE cp.contact_id = ? ORDER BY cp.attached_at DESC, cp.rowid DESC`).bind(contactId)
      .all<{ id: string; version: number; attached_at: string; detached_at: string | null; product_id: string; name: string; price_vnd: number }>(),
    db.prepare('SELECT purpose, granted, note, recorded_at FROM consent WHERE contact_id = ? ORDER BY recorded_at DESC, rowid DESC').bind(contactId)
      .all<{ purpose: string; granted: number; note: string | null; recorded_at: string }>(),
    db.prepare(`SELECT ac.id, ac.lead_id, ac.type, ac.summary, ac.occurred_at AS occurredAt, u.display_name AS actorName
      FROM activity ac LEFT JOIN app_user u ON u.id = ac.actor_user_id
      WHERE ac.lead_id IN (SELECT id FROM lead WHERE contact_id = ? AND pipeline = 'learner') ORDER BY ac.occurred_at DESC, ac.created_at DESC LIMIT 200`)
      .bind(contactId).all(),
    db.prepare(`SELECT e.id, e.version, e.status, e.lead_id, e.class_id, cg.name AS class_name, co.name AS course_name, l.code AS lead_code
      FROM enrollment e JOIN class_group cg ON cg.id = e.class_id JOIN course co ON co.id = cg.course_id JOIN lead l ON l.id = e.lead_id
      WHERE e.contact_id = ? ORDER BY e.created_at DESC, e.id`).bind(contactId)
      .all<{ id: string; version: number; status: string; lead_id: string; class_id: string; class_name: string; course_name: string; lead_code: string }>(),
  ]);

  const work = actor.role === 'admin' || state.owner_user_id === actor.id || (actor.role === 'leader' && actor.teamId !== null && state.owner_team_id === actor.teamId);
  const changeOwner = actor.role === 'admin' || (actor.role === 'leader' && actor.teamId !== null && state.owner_team_id === actor.teamId);
  const consentNow = new Map<string, { granted: boolean; note: string | null; recordedAt: string }>();
  for (const c of consents.results) if (!consentNow.has(c.purpose)) consentNow.set(c.purpose, { granted: c.granted === 1, note: c.note, recordedAt: c.recorded_at });
  const toProduct = (p: (typeof products.results)[number]) => ({
    id: p.id, version: p.version, productId: p.product_id, name: p.name, priceVnd: p.price_vnd, attachedAt: p.attached_at, detachedAt: p.detached_at,
  });
  const owners = changeOwner
    ? actor.role === 'admin'
      ? (await db.prepare(`SELECT id, display_name AS name, role FROM app_user WHERE organization_id = ? AND status = 'active'
          AND role IN ('sale', 'leader') AND team_id IS NOT NULL ORDER BY display_name`).bind(actor.organizationId).all<{ id: string; name: string; role: string }>()).results
      : await teamMembers(db, actor.teamId)
    : [];

  return {
    restricted: false,
    contact,
    leads: leads.results.map((l) => ({
      id: l.id as string, code: l.code as string, stage: l.stage as string, stageLabel: stageLabel(l.stage as string, 'learner'), status: l.status as string,
      source: l.source as string, sourceLabel: sourceLabel(l.source as string), needSummary: l.need_summary as string, version: l.version as number,
      createdAt: l.created_at as string, closedAt: l.closed_at as string | null,
      lostReason: l.lost_reason ? learnerLostReasonLabel(l.lost_reason as string) : null, lostNote: l.lost_note as string | null, wonNote: l.won_note as string | null,
      contract: l.partner_contract_id ? { id: l.partner_contract_id as string, name: l.contract_name as string | null } : null,
      nextAction: l.na_id ? { id: l.na_id as string, title: l.na_title as string, dueAt: l.na_due_at as string } : null,
      steps: steps.results.filter((s) => s.lead_id === l.id).map((s) => ({
        code: s.step_code, label: s.label, required: s.required === 1, status: s.status, skipReason: s.skip_reason, doneAt: s.done_at,
      })),
    })),
    products: products.results.filter((p) => !p.detached_at).map(toProduct),
    detachedProducts: products.results.filter((p) => p.detached_at).map(toProduct),
    consents: CONSENT_PURPOSES.map((p) => ({ purpose: p.code, label: p.label, ...(consentNow.get(p.code) ?? { granted: false, note: null, recordedAt: null }) })),
    enrollments: enrollments.results.map((e) => ({
      id: e.id, version: e.version, status: e.status, leadId: e.lead_id, leadCode: e.lead_code,
      classId: e.class_id, className: e.class_name, courseName: e.course_name,
    })),
    activities: activities.results,
    ownerCandidates: owners,
    permissions: { work, claim: mayClaim, changeOwner },
  };
}

interface PartnerListRow {
  id: string; name: string; status: string; starts_on: string | null; ends_on: string | null; account_id: string; account_name: string;
  version: number; learner_count: number; steps_total: number; steps_done: number;
}

export async function listPartners(db: D1Database, actor: Actor) {
  const rows = await db.prepare(`SELECT pc.id, pc.name, pc.status, pc.starts_on, pc.ends_on, pc.account_id, a.name AS account_name, pc.version,
      (SELECT COUNT(*) FROM lead l WHERE l.partner_contract_id = pc.id) AS learner_count,
      (SELECT COUNT(*) FROM partner_contract_step s WHERE s.contract_id = pc.id) AS steps_total,
      (SELECT COUNT(*) FROM partner_contract_step s WHERE s.contract_id = pc.id AND s.done_at IS NOT NULL) AS steps_done
    FROM partner_contract pc JOIN account a ON a.id = pc.account_id WHERE pc.organization_id = ?
    ORDER BY pc.status = 'active' DESC, pc.updated_at DESC, pc.id LIMIT 300`).bind(actor.organizationId).all<PartnerListRow>();
  return rows.results.map((r) => ({
    id: r.id, name: r.name, status: r.status, startsOn: r.starts_on, endsOn: r.ends_on, accountId: r.account_id, accountName: r.account_name,
    version: r.version, learnerCount: r.learner_count, stepsTotal: r.steps_total, stepsDone: r.steps_done,
  }));
}

export async function partnerDetail(db: D1Database, actor: Actor, contractId: string) {
  const contract = await db.prepare(`SELECT pc.id, pc.name, pc.status, pc.starts_on, pc.ends_on, pc.note, pc.account_id, a.name AS account_name, pc.version
    FROM partner_contract pc JOIN account a ON a.id = pc.account_id WHERE pc.id = ? AND pc.organization_id = ?`).bind(contractId, actor.organizationId)
    .first<{ id: string; name: string; status: string; starts_on: string | null; ends_on: string | null; note: string | null; account_id: string; account_name: string; version: number }>();
  if (!contract) return null;
  const now = new Date();
  const [steps, learners] = await Promise.all([
    db.prepare('SELECT id, name, position, done_at, version FROM partner_contract_step WHERE contract_id = ? ORDER BY position, created_at')
      .bind(contractId).all<{ id: string; name: string; position: number; done_at: string | null; version: number }>(),
    db.prepare(`SELECT ${CONTACT_STATE_COLUMNS}, l.id AS lead_id, l.code, l.stage, l.created_at, ow.display_name AS owner_name,
        (SELECT cp.value FROM contact_point cp WHERE cp.contact_id = c.id AND cp.type = 'phone' ORDER BY cp.created_at LIMIT 1) AS phone
      FROM lead l JOIN contact c ON c.id = l.contact_id LEFT JOIN app_user ow ON ow.id = c.owner_user_id
      WHERE l.partner_contract_id = ? AND l.pipeline = 'learner' AND l.organization_id = ?
      ORDER BY l.created_at DESC, l.rowid DESC LIMIT ${LIST_LIMIT}`).bind(contractId, actor.organizationId)
      .all<ContactState & { lead_id: string; code: string; stage: string; created_at: string; owner_name: string | null; phone: string | null }>(),
  ]);
  return {
    contract: {
      id: contract.id, name: contract.name, status: contract.status, startsOn: contract.starts_on, endsOn: contract.ends_on, note: contract.note,
      accountId: contract.account_id, accountName: contract.account_name, version: contract.version,
    },
    steps: steps.results.map((s) => ({ id: s.id, name: s.name, position: s.position, doneAt: s.done_at, version: s.version })),
    learners: learners.results.map((r) => {
      const held = heldNow(r, now);
      const inspect = mayInspect(actor, r, held);
      return {
        leadId: r.lead_id, code: r.code, contactId: r.id, name: r.display_name, phone: inspect ? r.phone : null,
        ownerName: ownerLabel(held, inspect, r.owner_name), stage: r.stage, stageLabel: stageLabel(r.stage, 'learner'), createdAt: r.created_at,
      };
    }),
  };
}
