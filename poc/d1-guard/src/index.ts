import { Hono } from 'hono';
import { changeStage, completeNextAction, type CommandResult } from './guarded-write';

const app = new Hono<{ Bindings: { DB: D1Database } }>();
const resultStatus = (result: CommandResult) => result.ok ? 200
  : result.code === 'NOT_FOUND' ? 404 : result.code === 'VALIDATION_FAILED' ? 400 : 409;

app.onError(() => Response.json({ ok: false, code: 'INTERNAL_ERROR' }, { status: 500 }));

app.post('/lead/:id/stage', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body.expectedVersion !== 'number' || typeof body.stage !== 'string'
    || typeof body.idempotencyKey !== 'string') {
    return c.json({ ok: false, code: 'VALIDATION_FAILED' }, 400);
  }
  const result = await changeStage(c.env.DB, {
    leadId: c.req.param('id'), expectedVersion: body.expectedVersion,
    stage: body.stage, idempotencyKey: body.idempotencyKey,
  });
  return c.json(result, resultStatus(result));
});

app.post('/lead/:id/complete-next-action', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const replacement = body?.newTask as Record<string, unknown> | undefined;
  if (!body || typeof body.expectedVersion !== 'number' || typeof body.taskId !== 'string'
    || !replacement || typeof replacement.id !== 'string' || typeof replacement.dueAt !== 'string') {
    return c.json({ ok: false, code: 'VALIDATION_FAILED' }, 400);
  }
  const result = await completeNextAction(c.env.DB, {
    leadId: c.req.param('id'), taskId: body.taskId, expectedVersion: body.expectedVersion,
    newTask: { id: replacement.id, dueAt: replacement.dueAt },
  });
  return c.json(result, resultStatus(result));
});

// Synthetic PoC observation endpoint used by the remote race verifier.
app.get('/lead/:id', async (c) => {
  const leadId = c.req.param('id');
  const lead = await c.env.DB.prepare('SELECT id, stage, version FROM lead WHERE id=?').bind(leadId).first();
  if (!lead) return c.json({ ok: false, code: 'NOT_FOUND' }, 404);
  const counts = await c.env.DB.prepare(`SELECT COUNT(*) AS audit FROM audit_log
    WHERE entity='lead' AND entity_id=? AND action='changeStage'`).bind(leadId).first<{ audit: number }>();
  return c.json({ ok: true, lead, audit: counts?.audit ?? 0 });
});

export default app;
