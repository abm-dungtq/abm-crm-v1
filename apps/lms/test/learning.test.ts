import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import type { Env } from '../src/worker/env';
import {
  resetDb,
  seedAccount,
  seedClass,
  seedContact,
  seedOrg,
  seedProgram,
} from './helpers/reset-db';

const ORIGIN = 'http://lms.test';
const EMAIL = 'hocvien@bsr.com.vn';
const DEFAULT_PW = 'AbmMacDinh2026';

let learnerCookie = '';

async function call(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; envOverride?: Partial<Env> } = {},
) {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (method !== 'GET' && method !== 'HEAD') {
    headers.Origin = ORIGIN;
  }
  const cookie = opts.cookie ?? learnerCookie;
  if (cookie) {
    headers.Cookie = cookie;
  }
  const res = await app.fetch(
    new Request(`${ORIGIN}/api${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    { ...env, ...opts.envOverride },
  );
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const newCookie = /abm_learner=([^;]*)/.exec(setCookie)?.[0];
  const json = (await res.json()) as {
    ok: boolean;
    data?: any;
    error?: { code: string; message: string };
  };
  return { status: res.status, json, cookie: newCookie };
}

beforeEach(async () => {
  await resetDb(env.DB);
  await seedOrg(env.DB, { defaultPassword: DEFAULT_PW });
  const { contactId } = await seedContact(env.DB, {
    contactId: 'ct-1',
    displayName: 'Nguyễn Văn Học',
    email: EMAIL,
  });
  await seedAccount(env.DB, {
    accountId: 'acc-1',
    contactId,
    email: EMAIL,
  });
  const loginRes = await call('/auth/login', {
    body: { email: EMAIL, password: DEFAULT_PW },
    cookie: '',
  });
  expect(loginRes.status).toBe(200);
  learnerCookie = loginRes.cookie!;
});

describe('LMS learning endpoints', () => {
  it('1. enrolled confirmed -> /api/programs lists it open; /api/programs/:id returns lessons and contentUrl starting with https://content.test/c/', async () => {
    await seedClass(env.DB, {
      classId: 'class-1',
      className: 'Lớp BSR-AI-K1',
      enrollments: [{ contactId: 'ct-1', status: 'confirmed' }],
    });
    await seedProgram(env.DB, {
      programId: 'prog-1',
      classId: 'class-1',
      title: 'Cẩm Nang BSR',
      contentVersion: 2,
      lessons: [
        {
          id: 'les-1',
          sectionId: 'b1p1',
          title: 'Phần 1',
          groupTitle: 'Buổi 1',
          position: 0,
          videos: [{ id: 'vid-1', title: 'Record Buổi 1', streamUid: '0123456789abcdef0123456789abcdef' }],
        },
        {
          id: 'les-2',
          sectionId: 'b1p2',
          title: 'Phần 2',
          groupTitle: 'Buổi 1',
          position: 1,
        },
      ],
    });

    const list = await call('/programs');
    expect(list.status).toBe(200);
    expect(list.json.data).toEqual([
      {
        id: 'prog-1',
        title: 'Cẩm Nang BSR',
        className: 'Lớp BSR-AI-K1',
        state: 'open',
        until: null,
        endedAt: null,
        lessonCount: 2,
        completedCount: 0,
        nextSectionId: 'b1p1',
        nextLessonTitle: 'Phần 1',
      },
    ]);

    const detail = await call('/programs/prog-1');
    expect(detail.status).toBe(200);
    expect(detail.json.data.program).toEqual({
      id: 'prog-1',
      title: 'Cẩm Nang BSR',
      className: 'Lớp BSR-AI-K1',
      until: null,
    });
    expect(detail.json.data.lessons).toHaveLength(2);
    expect(detail.json.data.lessons[0]).toMatchObject({
      id: 'les-1',
      sectionId: 'b1p1',
      title: 'Phần 1',
      done: false,
      videos: [{ id: 'vid-1', title: 'Record Buổi 1' }],
    });
    expect(detail.json.data.contentUrl.startsWith('https://content.test/c/prog-1/2?')).toBe(true);
  });

  it('2. not enrolled -> 404; live block -> 404; live grant without enrollment -> open', async () => {
    await seedClass(env.DB, {
      classId: 'class-1',
      className: 'Lớp BSR-AI-K1',
    });
    await seedProgram(env.DB, {
      programId: 'prog-1',
      classId: 'class-1',
      title: 'Cẩm Nang BSR',
      lessons: [{ id: 'les-1', sectionId: 'b1p1', title: 'Phần 1', position: 0 }],
    });

    // Not enrolled -> 404
    const notEnrolled = await call('/programs/prog-1');
    expect(notEnrolled.status).toBe(404);

    // Live grant without enrollment -> open
    await env.DB.prepare(
      `INSERT INTO lms_access (id, organization_id, contact_id, program_id, mode, expires_at, created_at, updated_at, version)
       VALUES ('acc-grant-1', 'org-abm', 'ct-1', 'prog-1', 'grant', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`,
    ).run();

    const granted = await call('/programs/prog-1');
    expect(granted.status).toBe(200);

    // Live block -> 404
    await env.DB.prepare(
      `INSERT INTO lms_access (id, organization_id, contact_id, program_id, mode, expires_at, created_at, updated_at, version)
       VALUES ('acc-block-1', 'org-abm', 'ct-1', 'prog-1', 'block', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`,
    ).run();

    const blocked = await call('/programs/prog-1');
    expect(blocked.status).toBe(404);
    const listBlocked = await call('/programs');
    expect(listBlocked.json.data).toEqual([]);
  });

  it('3. review_days = 1 with last session 3 days ago -> listed expired; detail -> 403', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await seedClass(env.DB, {
      classId: 'class-exp',
      className: 'Lớp Đã Kết Thúc',
      sessions: [{ startsAt: threeDaysAgo, status: 'scheduled' }],
      enrollments: [{ contactId: 'ct-1', status: 'completed' }],
    });
    await seedProgram(env.DB, {
      programId: 'prog-exp',
      classId: 'class-exp',
      title: 'Cẩm Nang Đã Hết Hạn',
      reviewDays: 1,
      lessons: [{ id: 'les-exp-1', sectionId: 'b1p1', title: 'Phần 1', position: 0 }],
    });

    const list = await call('/programs');
    expect(list.status).toBe(200);
    expect(list.json.data).toHaveLength(1);
    expect(list.json.data[0].state).toBe('expired');
    expect(list.json.data[0].endedAt).toBeTruthy();

    const detail = await call('/programs/prog-exp');
    expect(detail.status).toBe(403);
    expect(detail.json.error?.code).toBe('FORBIDDEN');
    expect(detail.json.error?.message).toBe('Đã hết hạn xem lại chương trình này');

    const progress = await call('/lessons/les-exp-1/progress', { method: 'PUT', body: { done: true } });
    expect(progress.status).toBe(403);
  });

  it('4. progress PUT true then false', async () => {
    await seedClass(env.DB, {
      classId: 'class-1',
      enrollments: [{ contactId: 'ct-1', status: 'confirmed' }],
    });
    await seedProgram(env.DB, {
      programId: 'prog-1',
      classId: 'class-1',
      lessons: [
        { id: 'les-1', sectionId: 'b1p1', title: 'Phần 1', position: 0 },
        { id: 'les-2', sectionId: 'b1p2', title: 'Phần 2', position: 1 },
      ],
    });

    const markDone = await call('/lessons/les-1/progress', {
      method: 'PUT',
      body: { done: true },
    });
    expect(markDone.status).toBe(200);
    expect(markDone.json.data).toEqual({ done: true });

    const list1 = await call('/programs');
    expect(list1.json.data[0]).toMatchObject({
      completedCount: 1,
      lessonCount: 2,
      nextSectionId: 'b1p2',
      nextLessonTitle: 'Phần 2',
    });

    const markUndone = await call('/lessons/les-1/progress', {
      method: 'PUT',
      body: { done: false },
    });
    expect(markUndone.status).toBe(200);
    expect(markUndone.json.data).toEqual({ done: false });

    const list2 = await call('/programs');
    expect(list2.json.data[0]).toMatchObject({
      completedCount: 0,
      lessonCount: 2,
      nextSectionId: 'b1p1',
    });
  });

  it('5. video token: missing STREAM_SIGNING_JWK -> 503; with generated key -> iframeUrl contains customer-testcode.cloudflarestream.com', async () => {
    await seedClass(env.DB, {
      classId: 'class-1',
      enrollments: [{ contactId: 'ct-1', status: 'confirmed' }],
    });
    await seedProgram(env.DB, {
      programId: 'prog-1',
      classId: 'class-1',
      lessons: [
        {
          id: 'les-1',
          sectionId: 'b1p1',
          title: 'Phần 1',
          position: 0,
          videos: [
            {
              id: 'vid-1',
              title: 'Video 1',
              streamUid: '0123456789abcdef0123456789abcdef',
            },
          ],
        },
      ],
    });

    const missingKey = await call('/videos/vid-1/token');
    expect(missingKey.status).toBe(503);
    expect(missingKey.json.error?.message).toBe('Video chưa sẵn sàng');

    const keyPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const jwkBase64 = btoa(JSON.stringify(privateJwk));

    const withKey = await call('/videos/vid-1/token', {
      envOverride: {
        STREAM_SIGNING_KEY_ID: 'kid-1',
        STREAM_SIGNING_JWK: jwkBase64,
      },
    });
    expect(withKey.status, JSON.stringify(withKey.json)).toBe(200);
    expect(withKey.json.data.iframeUrl).toContain('customer-testcode.cloudflarestream.com');
    expect(withKey.json.data.iframeUrl.endsWith('/iframe')).toBe(true);
  });

  it('6. hidden lesson and deleted video are not returned', async () => {
    await seedClass(env.DB, {
      classId: 'class-1',
      enrollments: [{ contactId: 'ct-1', status: 'confirmed' }],
    });
    await seedProgram(env.DB, {
      programId: 'prog-1',
      classId: 'class-1',
      lessons: [
        {
          id: 'les-visible',
          sectionId: 'b1p1',
          title: 'Phần Hiện',
          position: 0,
          videos: [
            { id: 'vid-visible', title: 'Video Hiện', streamUid: '11111111111111111111111111111111', position: 0 },
            {
              id: 'vid-deleted',
              title: 'Video Xoá',
              streamUid: '22222222222222222222222222222222',
              position: 1,
              deletedAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
        {
          id: 'les-hidden',
          sectionId: 'b1p2',
          title: 'Phần Ẩn',
          position: 1,
          hiddenAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    const detail = await call('/programs/prog-1');
    expect(detail.status).toBe(200);
    expect(detail.json.data.lessons).toHaveLength(1);
    expect(detail.json.data.lessons[0].id).toBe('les-visible');
    expect(detail.json.data.lessons[0].videos).toEqual([{ id: 'vid-visible', title: 'Video Hiện' }]);

    const deletedVideoToken = await call('/videos/vid-deleted/token');
    expect(deletedVideoToken.status).toBe(404);
  });
});
