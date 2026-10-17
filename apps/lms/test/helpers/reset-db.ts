import { hashPassword } from '@abm/lms-core';
import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      LMS_CONTENT_ORIGIN: string;
      STREAM_CUSTOMER_CODE: string;
      CONTENT_SIGNING_SECRET: string;
      STREAM_SIGNING_KEY_ID?: string;
      STREAM_SIGNING_JWK?: string;
    }
  }
}

/** Child tables first, parents last, so deletes never trip a foreign key. */
export const TABLES = [
  'zalo_oa_oauth_state', 'zalo_oa_credential',
  'channel_command', 'message', 'lead_intake', 'group_schedule', 'inbox_roster', 'conversation', 'channel_account',
  'customer_bot_switch', 'inbox_setting',
  'privacy_request',
  'payment_allocation', 'payment', 'charge',
  'lms_progress', 'learner_session', 'lms_lesson_video', 'lms_access', 'lms_lesson', 'lms_program', 'learner_account',
  'attendance', 'trial_booking', 'enrollment', 'class_session', 'class_teacher', 'class_group',
  '_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead_step', 'lead', 'lead_counter',
  'course',
  'agent_token', 'user_session', 'consent', 'customer_product', 'product',
  'partner_contract_step', 'partner_contract',
  'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department',
  'fee_counter', 'org_setting', 'organization',
];

const NOW = '2026-01-01T00:00:00.000Z';

export async function resetDb(db: D1Database = env.DB) {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)));
}

export async function seedOrg(
  db: D1Database = env.DB,
  opts: { orgId?: string; name?: string; defaultPassword?: string | null; userId?: string; depId?: string } = {},
) {
  const orgId = opts.orgId ?? 'org-abm';
  const name = opts.name ?? 'ABM';
  const depId = opts.depId ?? 'dep-abm';
  const userId = opts.userId ?? 'u-admin';
  const hashed = opts.defaultPassword ? await hashPassword(opts.defaultPassword) : null;

  await db.batch([
    db.prepare(`INSERT INTO organization (id, name, created_at, updated_at, version) VALUES (?, ?, ?, ?, 1)`)
      .bind(orgId, name, NOW, NOW),
    db.prepare(`INSERT INTO org_setting (
        id, organization_id, learner_default_password_hash, learner_default_password_salt,
        learner_default_password_iterations, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
      .bind(orgId, orgId, hashed?.hash ?? null, hashed?.salt ?? null, hashed?.iterations ?? null, NOW, NOW),
    db.prepare(`INSERT INTO department (id, organization_id, name, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)`)
      .bind(depId, orgId, 'Phòng Học vụ', NOW, NOW),
    db.prepare(`INSERT INTO app_user (id, organization_id, department_id, display_name, email, role, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'Admin ABM', 'admin@abm.test', 'admin', 'active', ?, ?, 1)`)
      .bind(userId, orgId, depId, NOW, NOW),
  ]);
  return { orgId, depId, userId };
}

export async function seedContact(
  db: D1Database = env.DB,
  opts: { contactId?: string; orgId?: string; displayName?: string; email?: string; phone?: string } = {},
) {
  const contactId = opts.contactId ?? crypto.randomUUID();
  const orgId = opts.orgId ?? 'org-abm';
  const displayName = opts.displayName ?? 'Nguyễn Văn A';

  const stmts: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO contact (id, organization_id, display_name, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'active', ?, ?, 1)`)
      .bind(contactId, orgId, displayName, NOW, NOW),
  ];
  if (opts.email) {
    stmts.push(
      db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at)
        VALUES (?, ?, 'email', ?, ?, ?)`)
        .bind(crypto.randomUUID(), contactId, opts.email, opts.email.trim().toLowerCase(), NOW),
    );
  }
  if (opts.phone) {
    stmts.push(
      db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at)
        VALUES (?, ?, 'phone', ?, ?, ?)`)
        .bind(crypto.randomUUID(), contactId, opts.phone, opts.phone.trim(), NOW),
    );
  }
  await db.batch(stmts);
  return { contactId };
}

export async function seedClass(
  db: D1Database = env.DB,
  opts: {
    classId?: string;
    courseId?: string;
    productId?: string;
    orgId?: string;
    depId?: string;
    className?: string;
    sessions?: { id?: string; startsAt: string; status?: 'scheduled' | 'cancelled'; durationMinutes?: number; kind?: 'regular' | 'trial' | 'makeup' }[];
    enrollments?: { id?: string; contactId: string; status?: string; leadId?: string }[];
  } = {},
) {
  const orgId = opts.orgId ?? 'org-abm';
  const depId = opts.depId ?? 'dep-abm';
  const productId = opts.productId ?? 'prod-1';
  const courseId = opts.courseId ?? 'course-1';
  const classId = opts.classId ?? 'class-1';
  const className = opts.className ?? 'Lớp BSR-AI-K1';

  const stmts: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO product (id, organization_id, name, price_vnd, active, created_at, updated_at, version)
      VALUES (?, ?, 'Khóa AI', 5000000, 1, ?, ?, 1)`)
      .bind(productId, orgId, NOW, NOW),
    db.prepare(`INSERT OR IGNORE INTO course (id, organization_id, product_id, name, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'AI Doanh nghiệp', 'active', ?, ?, 1)`)
      .bind(courseId, orgId, productId, NOW, NOW),
    db.prepare(`INSERT INTO class_group (id, course_id, name, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'open', ?, ?, 1)`)
      .bind(classId, courseId, className, NOW, NOW),
  ];

  for (const s of opts.sessions ?? []) {
    stmts.push(
      db.prepare(`INSERT INTO class_session (id, class_id, starts_at, duration_minutes, kind, status, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .bind(
          s.id ?? crypto.randomUUID(),
          classId,
          s.startsAt,
          s.durationMinutes ?? 120,
          s.kind ?? 'regular',
          s.status ?? 'scheduled',
          NOW,
          NOW,
        ),
    );
  }

  for (const e of opts.enrollments ?? []) {
    const leadId = e.leadId ?? crypto.randomUUID();
    const enrollmentId = e.id ?? crypto.randomUUID();
    stmts.push(
      db.prepare(`INSERT INTO lead (
          id, code, organization_id, department_id, contact_id, source, need_summary,
          stage, status, stage_entered_at, created_at, updated_at, version, pipeline
        ) VALUES (?, ?, ?, ?, ?, 'website', 'Học AI', 'won', 'won', ?, ?, ?, 1, 'learner')`)
        .bind(leadId, `L-${leadId.slice(0, 8)}`, orgId, depId, e.contactId, NOW, NOW, NOW),
      db.prepare(`INSERT INTO enrollment (
          id, organization_id, lead_id, contact_id, class_id, status, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .bind(enrollmentId, orgId, leadId, e.contactId, classId, e.status ?? 'confirmed', NOW, NOW),
    );
  }

  await db.batch(stmts);
  return { productId, courseId, classId };
}

export async function seedProgram(
  db: D1Database = env.DB,
  opts: {
    programId?: string;
    orgId?: string;
    classId?: string | null;
    title?: string;
    contentVersion?: number;
    reviewDays?: number | null;
    publishedAt?: string | null;
    lessons?: {
      id?: string;
      sectionId: string;
      title: string;
      groupTitle?: string | null;
      position?: number;
      hiddenAt?: string | null;
      videos?: {
        id?: string;
        title: string;
        streamUid: string;
        position?: number;
        deletedAt?: string | null;
      }[];
    }[];
  } = {},
) {
  const programId = opts.programId ?? 'prog-1';
  const orgId = opts.orgId ?? 'org-abm';
  const classId = opts.classId !== undefined ? opts.classId : 'class-1';
  const title = opts.title ?? 'Cẩm Nang A.I Toàn Diện';
  const contentVersion = opts.contentVersion ?? 1;
  const reviewDays = opts.reviewDays ?? null;
  const publishedAt = opts.publishedAt !== undefined ? opts.publishedAt : NOW;
  const contentKey = publishedAt ? `programs/${programId}/v${contentVersion}.html` : null;

  const stmts: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO lms_program (
        id, organization_id, class_id, title, content_key, content_version,
        review_days, published_at, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .bind(programId, orgId, classId, title, contentKey, contentVersion, reviewDays, publishedAt, NOW, NOW),
  ];

  for (let i = 0; i < (opts.lessons ?? []).length; i++) {
    const l = opts.lessons![i]!;
    const lessonId = l.id ?? `lesson-${i + 1}`;
    stmts.push(
      db.prepare(`INSERT INTO lms_lesson (
          id, program_id, section_id, title, group_title, position, hidden_at, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .bind(lessonId, programId, l.sectionId, l.title, l.groupTitle ?? null, l.position ?? i, l.hiddenAt ?? null, NOW, NOW),
    );
    for (let j = 0; j < (l.videos ?? []).length; j++) {
      const v = l.videos![j]!;
      stmts.push(
        db.prepare(`INSERT INTO lms_lesson_video (
            id, lesson_id, title, stream_uid, position, deleted_at, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
          .bind(v.id ?? `video-${i + 1}-${j + 1}`, lessonId, v.title, v.streamUid, v.position ?? j, v.deletedAt ?? null, NOW, NOW),
      );
    }
  }

  await db.batch(stmts);
  return { programId };
}

export async function seedAccount(
  db: D1Database = env.DB,
  opts: {
    accountId?: string;
    orgId?: string;
    contactId: string;
    email: string;
    password?: string | null;
    status?: 'active' | 'disabled';
    lockedUntil?: string | null;
    failedLoginCount?: number;
  },
) {
  const accountId = opts.accountId ?? 'acc-1';
  const orgId = opts.orgId ?? 'org-abm';
  const email = opts.email.trim().toLowerCase();
  const hashed = opts.password ? await hashPassword(opts.password) : null;

  await db.prepare(`INSERT INTO learner_account (
      id, organization_id, contact_id, email, password_hash, password_salt, password_iterations,
      status, failed_login_count, locked_until, password_changed_at, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .bind(
      accountId,
      orgId,
      opts.contactId,
      email,
      hashed?.hash ?? null,
      hashed?.salt ?? null,
      hashed?.iterations ?? null,
      opts.status ?? 'active',
      opts.failedLoginCount ?? 0,
      opts.lockedUntil ?? null,
      hashed ? NOW : null,
      NOW,
      NOW,
    )
    .run();

  return { accountId, email };
}
