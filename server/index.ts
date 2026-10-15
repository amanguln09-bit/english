import next from "next";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { createRuntime } from "./runtime";
import { participant, view, refresh } from "./engine";
async function main() {
  const runtime = await createRuntime();
  const { handleApi, sessions, clients, user, persist, rate } = runtime;
  const app = next({
    dev: process.env.NODE_ENV !== "production",
    hostname: "0.0.0.0",
    port: Number(process.env.PORT || 3000),
  });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/")) return handleApi(req, res);
    const result = handle(req, res);
    for (const listener of server.listeners("upgrade"))
      if (listener !== upgrade)
        server.removeListener("upgrade", listener as (...args: any[]) => void);
    return result;
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const upgrade: Parameters<typeof server.on>[1] = async (
    req: any,
    socket: any,
    head: any,
  ) => {
    if (!req.url?.startsWith("/realtime")) {
      app.getUpgradeHandler()(req, socket, head);
      return;
    }
    try {
      if (
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        throw Error("Origin");
      await rate("ws:" + req.socket.remoteAddress, 100);
      wss.handleUpgrade(req, socket, head, (ws) => {
        let authenticated = false;
        const timer = setTimeout(() => {
          if (!authenticated) ws.close(1008, "Authenticate");
        }, 5000);
        ws.on("message", async (data) => {
          try {
            if (authenticated) throw Error("Already connected");
            const b = z
              .object({
                id: z.string(),
                role: z.enum(["host", "display", "student"]),
                token: z.string().optional(),
              })
              .parse(JSON.parse(data.toString()));
            const s = sessions.get(b.id);
            if (!s) throw Error("Not found");
            const u = await user(req);
            if (b.role === "host" && u?.id !== s.owner)
              throw Error("Forbidden");
            const p =
              b.role === "student" ? participant(s, b.token || "") : null;
            authenticated = true;
            clearTimeout(timer);
            clients.set(ws, { id: s.id, role: b.role, pid: p?.id });
            ws.send(JSON.stringify(view(s, b.role, p?.id)));
          } catch {
            ws.close(1008, "Unauthorized");
          }
        });
        ws.on("close", () => {
          clearTimeout(timer);
          clients.delete(ws);
        });
      });
    } catch {
      socket.destroy();
    }
  };
  server.on("upgrade", upgrade);
  setInterval(async () => {
    for (const s of sessions.values()) {
      const old = s.state;
      refresh(s);
      if (old !== s.state) await persist(s);
    }
  }, 1000).unref();
  server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log("English Brain Games ready"),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
