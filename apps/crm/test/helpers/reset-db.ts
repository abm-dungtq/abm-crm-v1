import { applyD1Migrations, env } from 'cloudflare:test';

/** Child tables first, parents last, so deletes never trip a foreign key. */
export const TABLES = [
  'channel_command', 'message', 'lead_intake', 'group_schedule', 'inbox_roster', 'conversation', 'channel_account',
  'customer_bot_switch',
  'privacy_request',
  'payment_allocation', 'payment', 'charge',
  'attendance', 'trial_booking', 'enrollment', 'class_session', 'class_teacher', 'class_group', 'course',
  'agent_token', 'user_session', 'consent', 'customer_product', 'product',
  '_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead_step', 'lead', 'lead_counter',
  'partner_contract_step', 'partner_contract',
  'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department',
  'fee_counter', 'org_setting', 'organization',
];

/** Applies migrations, empties every table and loads the seed INSERT statements. */
export async function resetDb(db: D1Database, seedSql: string) {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)));
  await db.prepare('INSERT OR IGNORE INTO customer_bot_switch (id, enabled) VALUES (1, 0)').run();
  await db.batch(seedSql.split('\n').filter((line) => line.startsWith('INSERT')).map((line) => db.prepare(line)));
}
