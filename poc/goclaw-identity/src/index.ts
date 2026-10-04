import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { callTool, resolveSubject, tokenHash, tools, type Subject } from './mcp-tools';

type Bindings = { DB: D1Database; ADMIN_TOKEN?: string };
const app = new Hono<{ Bindings: Bindings; Variables: { subject: Subject } }>();
app.onError((_error, c) => c.json({ code: 'INTERNAL_ERROR' }, 500));
app.use('*', bodyLimit({ maxSize: 65536 }));
// GoClaw is a server client and sends no browser Origin.
app.use('*', async (c, next) => {
  if (c.req.header('Origin')) return c.json({ code: 'ORIGIN_DENIED' }, 403);
  await next();
});
app.get('/health', c => c.json({ status: 'ok' }));
app.use('/admin/*', async (c, next) => {
  const supplied = c.req.header('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!c.env.ADMIN_TOKEN || !supplied || await tokenHash(supplied) !== await tokenHash(c.env.ADMIN_TOKEN)) {
    return c.json({ code: 'UNAUTHORIZED' }, 401);
  }
  await next();
});
app.post('/admin/kill-switch', async c => {
  const body = await c.req.json<{ enabled?: unknown }>().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') return c.json({ code: 'INVALID_INPUT' }, 400);
  await c.env.DB.prepare('UPDATE agent_kill_switch SET enabled = ? WHERE id = 1').bind(Number(body.enabled)).run();
  return c.json({ enabled: body.enabled });
});
app.get('/admin/activity', async c => c.json(await c.env.DB.prepare('SELECT * FROM activity ORDER BY created_at, id LIMIT 100').all()));
// The hook must stay closed until its live trusted-sender payload is inspected.
app.post('/hooks/pre-tool-use', c => c.json({ decision: 'deny', reason: 'HOOK_NOT_CONFIGURED' }, 503));
app.use('/mcp', async (c, next) => {
  const subject = await resolveSubject(c.env.DB, c.req.header('Authorization'));
  if (!subject) return c.json({ code: 'UNAUTHORIZED' }, 401);
  c.set('subject', subject);
  await next();
});
app.get('/mcp', c => c.body(null, 405));
app.delete('/mcp', c => c.body(null, 405));
app.post('/mcp', async c => {
  const message: unknown = await c.req.json().catch(() => null);
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC request' } }, 400);
  }
  const rpc = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> };
  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' ||
      (rpc.id !== undefined && typeof rpc.id !== 'string' && typeof rpc.id !== 'number')) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 400);
  }
  if (rpc.id === undefined) {
    return rpc.method.startsWith('notifications/') ? c.body(null, 202) : c.body(null, 400);
  }
  const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id: rpc.id, result });
  if (rpc.method === 'initialize') return reply({
    protocolVersion: '2025-11-25', capabilities: { tools: {} },
    serverInfo: { name: 'abm-crm-poc-identity', version: '0.1.0' }
  });
  if (rpc.method === 'ping') return reply({});
  if (rpc.method === 'tools/list') return reply({ tools });
  if (rpc.method === 'tools/call') {
    const name = rpc.params?.name;
    const args = rpc.params?.arguments ?? {};
    if (typeof name !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) {
      return c.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'Invalid parameters' } });
    }
    return reply(await callTool(c.env.DB, c.get('subject'), name, args as Record<string, unknown>));
  }
  return c.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } });
});
export default app;
