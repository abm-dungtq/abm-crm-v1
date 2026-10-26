import { DurableObject } from 'cloudflare:workers';

/**
 * Relays internal chat events to connected browsers. One instance per organization; every socket is tagged
 * with its user id. Holds no data: D1 is the message store, so a reconnecting client reloads from D1.
 */
export class ChatHub extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so idle keep-alives cost nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/connect') {
      const userId = request.headers.get('X-Chat-User');
      if (!userId || request.headers.get('Upgrade') !== 'websocket') return new Response('bad request', { status: 400 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [userId]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const { userIds, event } = await request.json<{ userIds: string[]; event: unknown }>();
      const text = JSON.stringify(event);
      let delivered = 0;
      for (const id of new Set(userIds)) {
        for (const ws of this.ctx.getWebSockets(id)) {
          try { ws.send(text); delivered += 1; } catch { /* closed socket; the runtime drops it */ }
        }
      }
      return Response.json({ delivered });
    }
    if (url.pathname === '/online') {
      const ids = new Set(this.ctx.getWebSockets().flatMap((ws) => this.ctx.getTags(ws)));
      return Response.json({ userIds: [...ids] });
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage() { /* clients only send 'ping', answered by auto-response */ }
  async webSocketClose(ws: WebSocket, code: number) {
    // 1005/1006 are reserved and make close() throw.
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closed'); } catch { /* already closed */ }
  }
}
