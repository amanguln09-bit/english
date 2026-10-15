import { mkdirSync } from "node:fs";
import { Pool } from "pg";
import type { GameData } from "../lib/content";
import type { Session } from "./engine";
export interface Store {
  get<T>(kind: string, id: string): Promise<T | null>;
  list<T>(kind: string): Promise<T[]>;
  put(kind: string, id: string, value: unknown): Promise<void>;
  remove(kind: string, id: string): Promise<void>;
}
let pool: Pool | undefined;
let lockPool: Pool | undefined;
function databasePool() {
  return (pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  }));
}
/** PostgreSQL serializes short HTTP mutations across independent serverless instances. */
export async function withDatabaseLock<T>(fn: () => Promise<T>): Promise<T> {
  lockPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 10000,
  });
  const db = await lockPool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('ebg_serverless_api'))",
    );
    const result = await fn();
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function createStore(): Promise<Store> {
  if (process.env.DATABASE_URL) {
    const p = databasePool();
    await p.query("SELECT 1");
    return {
      async get<T>(k: string, id: string) {
        return (
          ((
            await p.query(
              "SELECT body FROM runtime_records WHERE kind=$1 AND id=$2",
              [k, id],
            )
          ).rows[0]?.body as T) ?? null
        );
      },
      async list<T>(k: string) {
        return (
          await p.query("SELECT body FROM runtime_records WHERE kind=$1", [k])
        ).rows.map((r) => r.body) as T[];
      },
      async put(k, id, v) {
        const db = await p.connect();
        try {
          await db.query("BEGIN");
          await db.query(
            "INSERT INTO runtime_records(kind,id,body) VALUES($1,$2,$3) ON CONFLICT(kind,id) DO UPDATE SET body=EXCLUDED.body",
            [k, id, JSON.stringify(v)],
          );
          if (k === "game") {
            const g = v as GameData;
            await db.query(
              "INSERT INTO games(id,owner,title,template,status,sample,body) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,status=EXCLUDED.status,body=EXCLUDED.body",
              [
                id,
                g.owner,
                g.title,
                g.template,
                g.status,
                g.sample,
                JSON.stringify(g),
              ],
            );
            await db.query("DELETE FROM questions WHERE game_id=$1", [id]);
            for (const q of g.questions)
              await db.query(
                "INSERT INTO questions(id,game_id,kind,body) VALUES($1,$2,$3,$4)",
                [id + ":" + q.id, id, q.kind, JSON.stringify(q)],
              );
          }
          if (k === "session") {
            const s = v as Session;
            await db.query(
              "INSERT INTO sessions(id,owner,game_id,state,expires_at,body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,body=EXCLUDED.body",
              [
                id,
                s.owner,
                s.game.id,
                s.state,
                new Date(s.expires),
                JSON.stringify(s),
              ],
            );
            for (const a of s.participants)
              await db.query(
                "INSERT INTO participants(id,session_id,nickname,token_hash,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",
                [a.id, id, a.name, a.tokenHash, new Date(a.expires)],
              );
            for (const a of s.answers)
              await db.query(
                "INSERT INTO answers(session_id,participant_id,question_id,body) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,participant_id,question_id) DO NOTHING",
                [
                  id,
                  a.participantId,
                  s.game.questions[a.question].id,
                  JSON.stringify(a),
                ],
              );
          }
          if (k === "audit") {
            const a = v as { actor: string; action: string };
            await db.query(
              "INSERT INTO audit_events(actor,action,body) VALUES($1,$2,$3)",
              [a.actor, a.action, JSON.stringify(v)],
            );
          }
          await db.query("COMMIT");
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      },
      async remove(k, id) {
        const db = await p.connect();
        try {
          await db.query("BEGIN");
          await db.query(
            "DELETE FROM runtime_records WHERE kind=$1 AND id=$2",
            [k, id],
          );
          if (k === "session")
            await db.query("DELETE FROM sessions WHERE id=$1", [id]);
          await db.query("COMMIT");
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      },
    };
  }
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_LOCAL_DEMO)
    throw Error("DATABASE_URL required in production");
  mkdirSync(".local", { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(
    process.env.LOCAL_DB || ".local/brain-games.sqlite",
  );
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,body TEXT NOT NULL,PRIMARY KEY(kind,id))",
  );
  return {
    async get<T>(k: string, id: string) {
      const r = db
        .prepare("SELECT body FROM records WHERE kind=? AND id=?")
        .get(k, id);
      return r ? (JSON.parse(r.body as string) as T) : null;
    },
    async list<T>(k: string) {
      return db
        .prepare("SELECT body FROM records WHERE kind=?")
        .all(k)
        .map((r) => JSON.parse(r.body as string)) as T[];
    },
    async put(k, id, v) {
      db.prepare(
        "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
      ).run(k, id, JSON.stringify(v));
    },
    async remove(k, id) {
      db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(k, id);
    },
  };
}
