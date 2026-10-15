import { it, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createHmac } from "node:crypto";
it("Durable Object authenticates tickets and broadcasts role-filtered persisted views", async () => {
  const secret = "test-fixture-secret-not-a-real-credential";
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "cloudflare/.local/worker-build/worker.js",
      compatibilityDate: "2026-10-15",
      durableObjects: { ROOMS: { className: "Room", useSQLite: true } },
      bindings: { RELAY_SECRET: secret, APP_ORIGIN: "http://classroom.test" },
    }),
  );
  try {
    const base = "http://local/room/testroom";
    const bad = await mf.dispatchFetch(base + "/publish", {
      method: "POST",
      body: "{}",
    });
    expect(bad.status).toBe(403);
    await mf.dispatchFetch(base + "/publish", {
      method: "POST",
      headers: { Authorization: "Bearer " + secret },
      body: JSON.stringify({
        display: { state: "LOBBY", count: 2 },
        host: { private: "private nicknames" },
      }),
    });
    const payload = Buffer.from(
      JSON.stringify({
        id: "testroom",
        role: "display",
        exp: Date.now() + 60000,
      }),
    ).toString("base64url");
    const ticket =
      payload +
      "." +
      createHmac("sha256", secret).update(payload).digest("base64url");
    const denied = await mf.dispatchFetch(base + "?ticket=invalid", {
      headers: { Upgrade: "websocket", Origin: "http://classroom.test" },
    });
    expect(denied.status).toBe(401);
    const response = await mf.dispatchFetch(base + "?ticket=" + ticket, {
      headers: { Upgrade: "websocket", Origin: "http://classroom.test" },
    });
    expect(response.status).toBe(101);
    const ws = response.webSocket!;
    const message = new Promise<string>((resolve) =>
      ws.addEventListener("message", (e) => resolve(String(e.data)), {
        once: true,
      }),
    );
    ws.accept();
    expect(JSON.parse(await message)).toEqual({ state: "LOBBY", count: 2 });
    const next = new Promise<string>((resolve) =>
      ws.addEventListener("message", (e) => resolve(String(e.data)), {
        once: true,
      }),
    );
    await mf.dispatchFetch(base + "/publish", {
      method: "POST",
      headers: { Authorization: "Bearer " + secret },
      body: JSON.stringify({
        display: { state: "ACTIVE" },
        host: { answer: "secret" },
      }),
    });
    expect(JSON.parse(await next)).toEqual({ state: "ACTIVE" });
    const deleted = await mf.dispatchFetch(base + "/publish", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + secret },
    });
    expect(deleted.status).toBe(200);
    ws.close();
  } finally {
    await mf.dispose();
  }
}, 15000);
