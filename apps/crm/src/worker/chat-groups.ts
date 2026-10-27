/**
 * Department groups: one group per department (`dept:<department id>`, `system_key` the same), whose members are the
 * active users of that department; a department head is an owner. The sync is a fixed list of set-based statements,
 * so it costs the same whatever the head count and can join an admin save's batch or run alone.
 */
export function departmentGroupSyncStatements(db: D1Database, organizationId: string, now: string): D1PreparedStatement[] {
  return [
    // Create missing department groups.
    db.prepare(`INSERT OR IGNORE INTO chat_conversation (id, organization_id, kind, title, system_key, department_id, mode, created_at, updated_at)
      SELECT 'dept:' || d.id, d.organization_id, 'group', d.name, 'dept:' || d.id, d.id, 'chat', ?2, ?2
      FROM department d WHERE d.organization_id = ?1`)
      .bind(organizationId, now),
    // Follow the current department name.
    db.prepare(`UPDATE chat_conversation SET title = (SELECT d.name FROM department d WHERE d.id = chat_conversation.department_id), updated_at = ?2
      WHERE organization_id = ?1 AND department_id IS NOT NULL
        AND title IS NOT (SELECT d.name FROM department d WHERE d.id = chat_conversation.department_id)`)
      .bind(organizationId, now),
    // Remove people who no longer qualify (moved, disabled).
    db.prepare(`DELETE FROM chat_member WHERE conversation_id IN (SELECT id FROM chat_conversation WHERE organization_id = ?1 AND department_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM chat_conversation c JOIN app_user u ON u.department_id = c.department_id
        WHERE c.id = chat_member.conversation_id AND u.id = chat_member.user_id AND u.status = 'active')`)
      .bind(organizationId),
    // Add new members, marked as read now so a newcomer does not start with the whole history unread.
    db.prepare(`INSERT OR IGNORE INTO chat_member (conversation_id, user_id, role, joined_at, last_read_at)
      SELECT 'dept:' || u.department_id, u.id, CASE WHEN u.role = 'head' THEN 'owner' ELSE 'member' END, ?2, ?2
      FROM app_user u WHERE u.organization_id = ?1 AND u.status = 'active' AND u.department_id IS NOT NULL`)
      .bind(organizationId, now),
    // Keep roles current.
    db.prepare(`UPDATE chat_member SET role = (SELECT CASE WHEN u.role = 'head' THEN 'owner' ELSE 'member' END FROM app_user u WHERE u.id = chat_member.user_id)
      WHERE conversation_id IN (SELECT id FROM chat_conversation WHERE organization_id = ?1 AND department_id IS NOT NULL)
        AND role IS NOT (SELECT CASE WHEN u.role = 'head' THEN 'owner' ELSE 'member' END FROM app_user u WHERE u.id = chat_member.user_id)`)
      .bind(organizationId),
  ];
}

/** Runs the department group sync as one `db.batch`. Statements that find nothing to change write nothing. */
export async function ensureDepartmentGroups(db: D1Database, organizationId: string): Promise<void> {
  await db.batch(departmentGroupSyncStatements(db, organizationId, new Date().toISOString()));
}

/** True for a department group's `system_key`. */
export function isDepartmentGroupKey(systemKey: string | null): boolean {
  return systemKey !== null && systemKey.startsWith('dept:');
}
