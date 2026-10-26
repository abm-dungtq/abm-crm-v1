import { env, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { resetDb } from './helpers/reset-db';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MEDIA: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
      DEMO_MODE: string;
      AUTH_MODE: string;
    }
  }
}

const db = env.DB;
beforeEach(() => resetDb(db, seedSql));

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; fields?: Record<string, string>; details?: any } };

async function call(user: string, method: string, path: string, body?: unknown, key: string = crypto.randomUUID()) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, json: (await response.json()) as Json };
}
const command = (user: string, name: string, body: unknown, key?: string) => call(user, 'POST', `/commands/${name}`, body, key);
const lead = (id: string) => db.prepare('SELECT * FROM lead WHERE id = ?').bind(id).first<Record<string, any>>();

describe('task engine', () => {
  test('1. internal task visibility across creator, assignee, member, team leader and other team leader', async () => {
    const created = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Chuẩn bị tài liệu đào tạo nội bộ',
      priority: 'high',
      assigneeUserId: 'u-long',
      memberUserIds: ['u-huy'],
    });
    expect(created.status).toBe(200);
    expect(created.json.ok).toBe(true);
    const taskId = created.json.data.taskId as string;

    for (const viewer of ['u-long', 'u-huy', 'u-hung']) {
      const list = await call(viewer, 'GET', '/tasks');
      expect(list.status).toBe(200);
      expect(list.json.data.some((t: any) => t.id === taskId)).toBe(true);
    }

    const otherLeader = await call('u-mai', 'GET', '/tasks');
    expect(otherLeader.status).toBe(200);
    expect(otherLeader.json.data.some((t: any) => t.id === taskId)).toBe(false);
  });

  test('2. internal task transitions open -> in_progress -> completed', async () => {
    const created = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Soạn quy trình bàn giao',
      assigneeUserId: 'u-long',
    });
    const taskId = created.json.data.taskId as string;

    const updated = await command('u-long', 'updateTask', {
      taskId,
      expectedVersion: 1,
      status: 'in_progress',
    });
    expect(updated.status).toBe(200);
    const inProgressRow = await db.prepare('SELECT status, version FROM task WHERE id = ?').bind(taskId).first<{ status: string; version: number }>();
    expect(inProgressRow).toEqual({ status: 'in_progress', version: 2 });

    const completed = await command('u-long', 'completeTask', {
      taskId,
      expectedVersion: 2,
      outcome: 'Đã hoàn tất quy trình',
    });
    expect(completed.status).toBe(200);
    const completedRow = await db.prepare('SELECT status FROM task WHERE id = ?').bind(taskId).first<{ status: string }>();
    expect(completedRow).toEqual({ status: 'completed' });
  });

  test('3. CRM task rejects in_progress in updateTask and in DB CHECK constraint', async () => {
    const row = await lead('lead-04');
    const crmTaskId = row!.next_action_task_id as string;

    const res = await command('u-lan', 'updateTask', {
      taskId: crmTaskId,
      expectedVersion: 1,
      status: 'in_progress',
    });
    expect(res.json.ok).toBe(false);
    expect(res.json.error?.code).toBe('VALIDATION_FAILED');

    await expect(
      db.prepare("UPDATE task SET status = 'in_progress' WHERE kind = 'crm' AND id = ?").bind(crmTaskId).run(),
    ).rejects.toThrow();
  });

  test('4. completing a lead current Next Action without nextAction still fails with VALIDATION_FAILED', async () => {
    const row = await lead('lead-04');
    const crmTaskId = row!.next_action_task_id as string;

    const blocked = await command('u-lan', 'completeTask', {
      taskId: crmTaskId,
      expectedVersion: 1,
      outcome: 'Đã gọi',
    });
    expect(blocked.json.ok).toBe(false);
    expect(blocked.json.error?.code).toBe('VALIDATION_FAILED');
  });

  test('5. cancelTask on a CRM task fails with VALIDATION_FAILED', async () => {
    const row = await lead('lead-04');
    const crmTaskId = row!.next_action_task_id as string;

    const res = await command('u-lan', 'cancelTask', {
      taskId: crmTaskId,
      expectedVersion: 1,
      reason: 'Không cần nữa',
    });
    expect(res.json.ok).toBe(false);
    expect(res.json.error?.code).toBe('VALIDATION_FAILED');
  });

  test('6. comments: idempotent post by id, visible to task viewers, 404 to unauthorized user', async () => {
    const created = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Rà soát hợp đồng mẫu',
      assigneeUserId: 'u-long',
    });
    const taskId = created.json.data.taskId as string;
    const msgId = crypto.randomUUID();

    const post1 = await call('u-long', 'POST', `/tasks/${taskId}/comments`, {
      id: msgId,
      body: 'Đã kiểm tra mục 1 và 2 @[Lan](user:u-lan)',
    });
    expect(post1.status).toBe(200);

    const post2 = await call('u-long', 'POST', `/tasks/${taskId}/comments`, {
      id: msgId,
      body: 'Đã kiểm tra mục 1 và 2 @[Lan](user:u-lan)',
    });
    expect(post2.status).toBe(200);

    const countRow = await db.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE id = ?').bind(msgId).first<{ n: number }>();
    expect(countRow?.n).toBe(1);

    const readLan = await call('u-lan', 'GET', `/tasks/${taskId}/comments`);
    expect(readLan.status).toBe(200);
    expect(readLan.json.data.messages).toHaveLength(1);
    expect(readLan.json.data.messages[0]).toMatchObject({
      id: msgId,
      body: 'Đã kiểm tra mục 1 và 2 @[Lan](user:u-lan)',
      mentions: ['u-lan'],
    });

    const readMai = await call('u-mai', 'GET', `/tasks/${taskId}/comments`);
    expect(readMai.status).toBe(404);
  });

  test('7. subtask: creating with parentTaskId lists it in parent task detail subtasks', async () => {
    const parent = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Tổ chức workshop tháng 11',
      assigneeUserId: 'u-lan',
    });
    const parentId = parent.json.data.taskId as string;

    const sub = await command('u-lan', 'createTask', {
      kind: 'internal',
      parentTaskId: parentId,
      title: 'Đặt phòng hội thảo',
      assigneeUserId: 'u-long',
    });
    expect(sub.status).toBe(200);
    const subId = sub.json.data.taskId as string;

    const detail = await call('u-lan', 'GET', `/tasks/${parentId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.data.subtasks).toEqual([
      { id: subId, title: 'Đặt phòng hội thảo', status: 'open' },
    ]);
  });
});
