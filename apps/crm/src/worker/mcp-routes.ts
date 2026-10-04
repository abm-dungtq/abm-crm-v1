import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { loadAgentActor } from './actor';
import { sha256 } from './commands';
import { background, type AppBindings } from './env';
import { callTool, tools } from './mcp-tools';

/**
 * MCP (Streamable HTTP, JSON-RPC) for the chat agent. Each person has their own Bearer token and the
 * agent acts with exactly that person's rights. It never reads the browser session cookie.
 */
export const mcpRoutes = new Hono<AppBindings>();

mcpRoutes.use('*', bodyLimit({ maxSize: 65536 }));
mcpRoutes.use('*', async (c, next) => {
  // The agent is a server client; a browser Origin means someone is trying to reach this from a page.
  if (c.req.header('Origin')) return c.json({ error: 'browser requests are not allowed' }, 403);
  const token = c.req.header('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const db = c.env.DB;
  const row = await db.prepare('SELECT id, user_id FROM agent_token WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await sha256(token)).first<{ id: string; user_id: string }>();
  const actor = row ? await loadAgentActor(db, row.user_id) : null;
  if (!row || !actor) return c.json({ error: 'unauthorized' }, 401);
  await background(c, db.prepare('UPDATE agent_token SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run());
  c.set('actor', actor);
  await next();
});

mcpRoutes.post('/', async (c) => {
  const message: unknown = await c.req.json().catch(() => null);
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC request' } }, 400);
  }
  const rpc = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> };
  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string'
    || (rpc.id !== undefined && typeof rpc.id !== 'string' && typeof rpc.id !== 'number')) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 400);
  }
  if (rpc.id === undefined) return rpc.method.startsWith('notifications/') ? c.body(null, 202) : c.body(null, 400);
  const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id: rpc.id, result });

  if (rpc.method === 'initialize') {
    return reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'abm-crm', version: '1.0.0' } });
  }
  if (rpc.method === 'ping') return reply({});
  if (rpc.method === 'tools/list') return reply({ tools });
  if (rpc.method === 'tools/call') {
    const name = rpc.params?.name;
    const args = rpc.params?.arguments ?? {};
    if (typeof name !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) {
      return c.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'Invalid parameters' } });
    }
    try {
      return reply(await callTool(c.env.DB, c.get('actor'), name, args as Record<string, unknown>, new URL(c.req.url).origin));
    } catch (error) {
      console.error('mcp_error', error instanceof Error ? error.message : error);
      return c.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32603, message: 'Internal error' } });
    }
  }
  return c.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } });
});

mcpRoutes.all('/', (c) => c.body(null, 405));
