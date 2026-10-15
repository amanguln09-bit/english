// Optional Durable Object broadcast transport. The Node backend remains authoritative.
import { DurableObject } from "cloudflare:workers";
interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  RELAY_SECRET: string;
  APP_ORIGIN: string;
}
type Claims = {
  id: string;
  role: "host" | "display" | "student";
  pid?: string;
  exp: number;
};
async function verify(ticket: string, secret: string): Promise<Claims> {
  const [data, sig] = ticket.split(".");
  if (!data || !sig) throw Error("Invalid ticket");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(
    atob(sig.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      bytes,
      new TextEncoder().encode(data),
    ))
  )
    throw Error("Invalid signature");
  const c = JSON.parse(
    atob(data.replace(/-/g, "+").replace(/_/g, "/")),
  ) as Claims;
  if (c.exp < Date.now() || !["host", "display", "student"].includes(c.role))
    throw Error("Expired");
  return c;
}
export class Room extends DurableObject<Env> {
  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/publish")) {
      if (
        req.headers.get("Authorization") !== `Bearer ${this.env.RELAY_SECRET}`
      )
        return new Response("Forbidden", { status: 403 });
      if (req.method === "DELETE") {
        for (const ws of this.ctx.getWebSockets())
          ws.close(1000, "Session deleted");
        await this.ctx.storage.deleteAll();
        return Response.json({ ok: true });
      }
      const payload = (await req.json()) as Record<string, unknown>;
      const expires =
        typeof payload._expires === "number"
          ? payload._expires
          : Date.now() + 4 * 3600000;
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, expires));
      await this.ctx.storage.put("views", payload);
      for (const ws of this.ctx.getWebSockets()) {
        const c = ws.deserializeAttachment() as Claims;
        if (c.exp < Date.now()) {
          ws.close(1008, "Ticket expired; reconnect");
          continue;
        }
        const v = payload[c.role === "student" ? "student:" + c.pid : c.role];
        if (v) ws.send(JSON.stringify(v));
      }
      return Response.json({ ok: true });
    }
    if (
      req.headers.get("Upgrade") !== "websocket" ||
      req.headers.get("Origin") !== this.env.APP_ORIGIN
    )
      return new Response("Forbidden", { status: 403 });
    try {
      const c = await verify(
        url.searchParams.get("ticket") || "",
        this.env.RELAY_SECRET,
      );
      if (c.id !== url.pathname.split("/")[2]) throw Error("Room mismatch");
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment(c);
      const payload =
        await this.ctx.storage.get<Record<string, unknown>>("views");
      const value =
        payload?.[c.role === "student" ? "student:" + c.pid : c.role];
      if (value) pair[1].send(JSON.stringify(value));
      return new Response(null, { status: 101, webSocket: pair[0] });
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets())
      ws.close(1000, "Session expired");
    await this.ctx.storage.deleteAll();
  }
  webSocketMessage(ws: WebSocket) {
    ws.close(1008, "Use authenticated application API for commands");
  }
  webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }
}
export default {
  async fetch(req: Request, env: Env) {
    const path = new URL(req.url).pathname;
    const m = path.match(/^\/room\/([A-Za-z0-9_-]+)(?:\/publish)?$/);
    if (!m) return new Response("Not found", { status: 404 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};
