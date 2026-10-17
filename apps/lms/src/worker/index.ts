import { Hono } from 'hono';
import { originGuard, publicAuthRoutes, requireLearner, sessionAuthRoutes } from './auth';
import type { AppBindings } from './env';
import { learningRoutes } from './learning';

const app = new Hono<AppBindings>().basePath('/api');

app.onError((error, c) => {
  console.error('lms_api_error', error instanceof Error ? error.message : error);
  return c.json({ ok: false, error: { code: 'INTERNAL', message: 'Lỗi hệ thống, thử lại sau' } }, 500);
});

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'no-store');
});

app.get('/health', (c) => c.json({ ok: true }));

app.use('*', originGuard);
app.route('/auth', publicAuthRoutes);

app.use('*', requireLearner);
app.route('/auth', sessionAuthRoutes);

app.get('/me', async (c) => {
  const learner = c.get('learner');
  const contact = await c.env.DB.prepare('SELECT display_name FROM contact WHERE id = ?')
    .bind(learner.contactId)
    .first<{ display_name: string }>();
  return c.json({
    ok: true,
    data: {
      displayName: contact?.display_name ?? learner.email,
      email: learner.email,
      usesDefaultPassword: learner.usesDefaultPassword,
    },
  });
});

app.route('/', learningRoutes);

app.all('*', (c) =>
  c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy đường dẫn' } }, 404),
);

export default app;
