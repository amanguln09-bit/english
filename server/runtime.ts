import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, createHmac } from "node:crypto";
import { WebSocket } from "ws";
import { z } from "zod";
import QRCode from "qrcode";
import { createStore } from "./store";
import { login, seedUser, User } from "./auth";
import { Game, games, GameData } from "../lib/content";
import {
  Session,
  createSession,
  command,
  join,
  participant,
  submit,
  view,
  refresh,
  hash,
} from "./engine";

export async function createRuntime(options: { serverless?: boolean } = {}) {
  const store = await createStore();
  for (const g of games) {
    const existing = await store.get<GameData>("game", g.id);
    await store.put("game", g.id, existing || g);
  }
  if (process.env.LOCAL_ADMIN_EMAIL && process.env.LOCAL_ADMIN_PASSWORD)
    await seedUser(
      store,
      process.env.LOCAL_ADMIN_EMAIL,
      process.env.LOCAL_ADMIN_PASSWORD,
      "admin",
    );
  const sessions = new Map<string, Session>(
    (await store.list<Session>("session")).map((s) => [s.id, s]),
  );
  if (!options.serverless)
    for (const s of sessions.values()) await store.put("session", s.id, s);
  const clients = new Map<
    WebSocket,
    { id: string; role: "host" | "display" | "student"; pid?: string }
  >();
  const limits = new Map<string, { n: number; t: number }>();
  const locks = new Map<string, Promise<unknown>>();
  async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) || Promise.resolve();
    const p = prev.catch(() => {}).then(fn);
    locks.set(key, p);
    try {
      return await p;
    } finally {
      if (locks.get(key) === p) locks.delete(key);
    }
  }
  async function user(req: IncomingMessage) {
    const raw = req.headers.cookie?.match(/(?:^|; )ebg=([^;]+)/)?.[1];
    const a = raw
      ? await store.get<{ user: User; expires: number }>("auth", hash(raw))
      : null;
    return a && a.expires > Date.now() ? a.user : null;
  }
  async function persist(s: Session) {
    await store.put("session", s.id, s);
    if (process.env.CLOUDFLARE_RELAY_URL && process.env.RELAY_SECRET) {
      const views: Record<string, unknown> = {
        host: view(s, "host"),
        display: view(s, "display"),
        _expires: s.expires,
      };
      for (const p of s.participants)
        views["student:" + p.id] = view(s, "student", p.id);
      try {
        const r = await fetch(
          `${process.env.CLOUDFLARE_RELAY_URL}/room/${s.id}/publish`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + process.env.RELAY_SECRET,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(views),
            signal: AbortSignal.timeout(3000),
          },
        );
        if (!r.ok) console.error("Relay publish failed", r.status);
      } catch {
        console.error("Relay unreachable; clients use polling fallback");
      }
    }
    for (const [ws, c] of clients)
      if (c.id === s.id && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(view(s, c.role, c.pid)));
  }
  async function rate(key: string, max = 40) {
    if (options.serverless) {
      const id = hash(key);
      const prior = await store.get<{ n: number; t: number }>("rate", id);
      const l =
        prior && prior.t > Date.now() ? prior : { n: 0, t: Date.now() + 60000 };
      if (l.n >= max) throw Error("Too many requests");
      l.n++;
      await store.put("rate", id, l);
      return;
    }
    const now = Date.now();
    let l = limits.get(key);
    if (!l || l.t < now) {
      l = { n: 0, t: now + 60000 };
      limits.set(key, l);
    }
    if (++l.n > max) throw Error("Too many requests");
  }
  async function handleApi(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, `http://${req.headers.host || "localhost"}`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (v: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(v));
    };
    try {
      if (!["GET", "POST"].includes(req.method || ""))
        return send({ error: "Method not allowed" }, 405);
      if (
        req.method === "GET" &&
        (/\/(command|answer|delete|copy|approve)$/.test(url.pathname) ||
          url.pathname === "/api/logout" ||
          url.pathname === "/api/login" ||
          url.pathname === "/api/join")
      )
        return send({ error: "POST required" }, 405);
      if (
        req.method !== "GET" &&
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        return send({ error: "Invalid origin" }, 403);
      let body: any = {};
      if (req.method !== "GET") {
        let raw = "";
        for await (const c of req) {
          raw += c;
          if (raw.length > 100000) throw Error("Request too large");
        }
        body = raw ? JSON.parse(raw) : {};
      }
      const u = await user(req);
      const path = url.pathname;
      const requireUser = () => {
        if (!u) throw Error("Unauthorized");
        return u;
      };
      if (path === "/api/me") {
        let current = u;
        if (!current) {
          await rate("workspace:" + req.socket.remoteAddress, 90);
          current = {
            id: randomBytes(16).toString("hex"),
            email: "",
            role: "teacher",
            guest: true,
          };
          const token = randomBytes(32).toString("base64url");
          await store.put("auth", hash(token), {
            user: current,
            expires: Date.now() + 30 * 86400000,
          });
          res.setHeader(
            "Set-Cookie",
            `ebg=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
          );
        }
        return send({
          user: {
            id: current.id,
            email: current.email,
            role: current.role,
            guest: !!current.guest,
          },
          local: !process.env.SUPABASE_URL,
        });
      }
      if (path === "/api/login" && req.method === "POST") {
        await rate("login:" + req.socket.remoteAddress, 10);
        const b = z
          .object({
            email: z.string().email(),
            password: z.string().min(1).max(200),
          })
          .parse(body);
        const found = await login(store, b.email, b.password);
        const token = randomBytes(32).toString("base64url");
        await store.put("auth", hash(token), {
          user: { id: found.id, email: found.email, role: found.role },
          expires: Date.now() + 8 * 3600000,
        });
        res.setHeader(
          "Set-Cookie",
          `ebg=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        );
        return send({ ok: true });
      }
      if (path === "/api/logout") {
        const raw = req.headers.cookie?.match(/(?:^|; )ebg=([^;]+)/)?.[1];
        if (raw) await store.remove("auth", hash(raw));
        res.setHeader(
          "Set-Cookie",
          "ebg=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        );
        return send({ ok: true });
      }
      if (path === "/api/curriculum")
        return send({
          verified: false,
          objectives: [],
          topics: games.map((g) => ({
            id: g.id,
            title: g.topic,
            grade: g.grade,
            term: g.term,
            mappingStatus: "unverified",
            objective: g.objective,
          })),
          message:
            "Official curriculum source access blocked; sample topics are not official curriculum.",
        });
      if (path === "/api/games") {
        requireUser();
        const all = await store.list<GameData>("game");
        return send(
          all.filter(
            (g) =>
              g.status === "published" ||
              g.owner === u!.id ||
              u!.role === "admin",
          ),
        );
      }
      const gm = path.match(/^\/api\/games\/([^/]+)(?:\/(copy|approve))?$/);
      if (gm) {
        requireUser();
        const g = await store.get<GameData>("game", gm[1]);
        if (!g) throw Error("Not found");
        if (
          g.status !== "published" &&
          g.owner !== u!.id &&
          u!.role !== "admin"
        )
          throw Error("Forbidden");
        if (req.method === "GET") return send(g);
        if (gm[2] === "copy") {
          const copy = {
            ...g,
            id: randomBytes(12).toString("hex"),
            owner: u!.id,
            status: "draft" as const,
            title: g.title + " (my copy)",
          };
          await store.put("game", copy.id, copy);
          return send(copy);
        }
        if (gm[2] === "approve") {
          if (u!.role !== "admin") throw Error("Forbidden");
          g.status = z
            .enum(["draft", "reviewed", "published", "archived"])
            .parse(body.status);
          await store.put("game", g.id, g);
          await store.put("audit", randomBytes(12).toString("hex"), {
            actor: u!.id,
            action: "content-status",
            game: g.id,
            status: g.status,
            at: Date.now(),
          });
          return send(g);
        }
        if (g.owner !== u!.id) throw Error("Copy the game before editing");
        const updated = Game.parse({
          ...body,
          id: g.id,
          owner: g.owner,
          status: "draft",
        });
        await store.put("game", g.id, updated);
        return send(updated);
      }
      if (path === "/api/sessions" && req.method === "GET") {
        requireUser();
        return send(
          [...sessions.values()]
            .filter((s) => s.owner === u!.id)
            .map((s) => ({
              id: s.id,
              title: s.game.title,
              state: s.state,
              count: s.participants.length,
              created: s.created,
            })),
        );
      }
      if (path === "/api/sessions" && req.method === "POST") {
        requireUser();
        const b = z
          .object({
            gameId: z.string(),
            duration: z.number().int().min(180).max(420),
            feedback: z.enum(["immediate", "teacher"]).default("teacher"),
          })
          .parse(body);
        const g = await store.get<GameData>("game", b.gameId);
        if (!g || !(g.status === "published" || g.owner === u!.id))
          throw Error("Forbidden");
        let s = createSession(g, u!.id, b.duration, b.feedback);
        while (
          [...sessions.values()].some(
            (x) => x.pin === s.pin && x.expires > Date.now(),
          )
        )
          s = createSession(g, u!.id, b.duration, b.feedback);
        sessions.set(s.id, s);
        await persist(s);
        return send({ id: s.id });
      }
      if (path === "/api/join" && req.method === "POST") {
        await rate("join:" + req.socket.remoteAddress, 90);
        const b = z
          .object({
            pin: z.string().regex(/^\d{6}$/),
            name: z.string().trim().min(1).max(24),
          })
          .parse(body);
        return await locked("join", async () => {
          const s = [...sessions.values()].find(
            (s) => s.pin === b.pin && s.expires > Date.now(),
          );
          if (!s) throw Error("Invalid or expired PIN");
          const result = join(s, b.name);
          await persist(s);
          return send({ ...result, sessionId: s.id });
        });
      }
      const sm = path.match(
        /^\/api\/sessions\/([^/]+)(?:\/(command|answer|qr|export|delete|realtime))?$/,
      );
      if (sm) {
        const s = sessions.get(sm[1]);
        if (!s) throw Error("Not found");
        refresh(s);
        const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
        const role =
          url.searchParams.get("role") === "display"
            ? "display"
            : token
              ? "student"
              : u?.id === s.owner
                ? "host"
                : "student";
        const p = role === "student" ? participant(s, token) : null;
        if (sm[2] === "realtime") {
          if (!process.env.CLOUDFLARE_RELAY_URL || !process.env.RELAY_SECRET)
            return send({
              url: null,
              transport: options.serverless ? "polling" : "websocket",
            });
          const claims = Buffer.from(
            JSON.stringify({
              id: s.id,
              role,
              pid: p?.id,
              exp: Math.min(s.expires, Date.now() + 5 * 60000),
            }),
          ).toString("base64url");
          const ticket =
            claims +
            "." +
            createHmac("sha256", process.env.RELAY_SECRET)
              .update(claims)
              .digest("base64url");
          return send({
            url:
              process.env.CLOUDFLARE_RELAY_URL.replace(/^http/, "ws") +
              "/room/" +
              s.id +
              "?ticket=" +
              ticket,
          });
        }
        if (sm[2] === "qr") {
          if (role !== "host") throw Error("Forbidden");
          return send({
            image: await QRCode.toDataURL(
              `${process.env.PUBLIC_ORIGIN || url.origin.replace("localhost", req.headers.host || "localhost")}/join?pin=${s.pin}`,
            ),
          });
        }
        if (sm[2] === "command") {
          if (role !== "host") throw Error("Forbidden");
          return await locked(s.id, async () => {
            command(
              s,
              u!.id,
              z
                .enum([
                  "start",
                  "pause",
                  "resume",
                  "reveal",
                  "next",
                  "finish",
                  "cancel",
                ])
                .parse(body.action),
            );
            await persist(s);
            return send(view(s, "host"));
          });
        }
        if (sm[2] === "answer") {
          if (!p) throw Error("Participant token required");
          const b = z
            .object({
              index: z.number().int().min(0),
              answer: z.array(z.string().max(500)).max(20),
            })
            .parse(body);
          return await locked(s.id, async () => {
            submit(s, token, b.index, b.answer);
            await persist(s);
            return send(view(s, "student", p.id));
          });
        }
        if (sm[2] === "export") {
          if (role !== "host") throw Error("Forbidden");
          res.writeHead(200, {
            "Content-Type": "text/csv",
            "Content-Disposition": 'attachment; filename="results.csv"',
          });
          const cell = (v: string) =>
            '"' +
            (/^[=+@\-\t\r]/.test(v) ? "'" : "") +
            v.replaceAll('"', '""') +
            '"';
          return res.end(
            "participant,score\n" +
              s.participants
                .map((p) => `${cell(p.name)},${p.score}`)
                .join("\n"),
          );
        }
        if (sm[2] === "delete") {
          if (role !== "host") throw Error("Forbidden");
          if (process.env.CLOUDFLARE_RELAY_URL && process.env.RELAY_SECRET) {
            const r = await fetch(
              `${process.env.CLOUDFLARE_RELAY_URL}/room/${s.id}/publish`,
              {
                method: "DELETE",
                headers: {
                  Authorization: "Bearer " + process.env.RELAY_SECRET,
                },
                signal: AbortSignal.timeout(5000),
              },
            );
            if (!r.ok)
              throw Error(
                "Relay deletion failed; retry before deleting local data",
              );
          }
          sessions.delete(s.id);
          await store.remove("session", s.id);
          for (const [ws, c] of clients)
            if (c.id === s.id) ws.close(1000, "Deleted");
          return send({ ok: true });
        }
        return send(view(s, role, p?.id));
      }
      if (path === "/api/admin/users") {
        if (requireUser().role !== "admin") throw Error("Forbidden");
        if (req.method === "GET")
          return send(
            (await store.list<User>("user")).map((x) => ({
              id: x.id,
              email: x.email,
              role: x.role,
            })),
          );
        if (process.env.SUPABASE_URL)
          throw Error(
            "Provision Supabase users in the Supabase administration console",
          );
        const b = z
          .object({
            email: z.string().email(),
            password: z.string().min(12).max(200),
          })
          .parse(body);
        await seedUser(store, b.email, b.password, "teacher");
        await store.put("audit", randomBytes(12).toString("hex"), {
          actor: u!.id,
          action: "teacher-create",
          email: b.email,
          at: Date.now(),
        });
        return send({ ok: true });
      }
      if (path === "/api/admin") {
        if (requireUser().role !== "admin") throw Error("Forbidden");
        return send({
          games: await store.list("game"),
          audit: await store.list("audit"),
          curriculumVerified: false,
        });
      }
      return send({ error: "Not found" }, 404);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Request failed";
      const status = /Unauthorized|credentials|participant/i.test(message)
        ? 401
        : /Forbidden|before editing/.test(message)
          ? 403
          : /Not found/.test(message)
            ? 404
            : /Too many/.test(message)
              ? 429
              : 400;
      send({ error: message }, status);
    }
  }
  async function reloadSessions() {
    sessions.clear();
    for (const s of await store.list<Session>("session")) {
      const prior = s.state;
      refresh(s);
      if (s.state !== prior) await store.put("session", s.id, s);
      sessions.set(s.id, s);
    }
  }
  return { handleApi, reloadSessions, sessions, clients, user, persist, rate };
}
