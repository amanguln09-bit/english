import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { createHash } from "node:crypto";
import { Pool } from "pg";
const schema = z.object({
  verified: z.boolean(),
  checkedAt: z.string(),
  sources: z.array(
    z.object({
      id: z.string(),
      url: z.string().url(),
      title: z.string(),
      status: z.enum(["blocked", "verified", "unverified"]),
    }),
  ),
  objectives: z.array(
    z.object({
      code: z.string().regex(/^[678]\.\d+\.\d+\.\d+$/),
      sourceId: z.string(),
      grade: z.number().int().min(6).max(8),
      skill: z.string(),
      officialText: z.string().min(1),
      verified: z.boolean(),
    }),
  ),
  topics: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      grade: z.number().int().min(6).max(8),
      term: z.number().int().min(1).max(4),
    }),
  ),
  textbooks: z.array(z.unknown()),
  mappings: z.array(
    z.object({
      topicId: z.string(),
      objectiveCode: z.string(),
      status: z.enum(["verified", "unverified"]),
      rationale: z.string().min(1),
    }),
  ),
});
export function validateCurriculum(input: unknown) {
  const c = schema.parse(input);
  const codes = new Set<string>(),
    sources = new Set(c.sources.map((s) => s.id)),
    topics = new Set(c.topics.map((t) => t.id));
  if (sources.size !== c.sources.length || topics.size !== c.topics.length)
    throw Error("Duplicate source/topic");
  for (const o of c.objectives) {
    if (codes.has(o.code)) throw Error("Duplicate objective");
    if (+o.code[0] !== o.grade || !sources.has(o.sourceId))
      throw Error("Objective source/grade mismatch");
    if (
      o.verified &&
      c.sources.find((s) => s.id === o.sourceId)?.status !== "verified"
    )
      throw Error("Unverified source");
    codes.add(o.code);
  }
  for (const m of c.mappings)
    if (!topics.has(m.topicId) || !codes.has(m.objectiveCode))
      throw Error("Dangling mapping");
  if (c.verified)
    throw Error(
      "Full coverage requires independent source inventory and human review; automatic full-coverage assertion is disabled",
    );
  return c;
}
async function main() {
  const filename = process.argv[2] || "data/curriculum.json";
  const raw = readFileSync(filename, "utf8");
  const c = validateCurriculum(JSON.parse(raw));
  const report = {
    checkedAt: c.checkedAt,
    sha256: createHash("sha256").update(raw).digest("hex"),
    sourceCount: c.sources.length,
    objectives: c.objectives.length,
    byGrade: [6, 7, 8].map((grade) => ({
      grade,
      count: c.objectives.filter((o) => o.grade === grade).length,
    })),
    complete: false,
    reason: "Official inventory and textbook verification outstanding",
  };
  writeFileSync(
    "data/verification-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  if (process.argv.includes("--import")) {
    if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
    const p = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = await p.connect();
    try {
      await db.query("BEGIN");
      for (const s of c.sources)
        await db.query(
          "INSERT INTO curriculum_sources(id,url,title,checked_at,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET url=EXCLUDED.url,title=EXCLUDED.title,checked_at=EXCLUDED.checked_at,status=EXCLUDED.status",
          [s.id, s.url, s.title, c.checkedAt, s.status],
        );
      for (const o of c.objectives)
        await db.query(
          "INSERT INTO objectives(source_id,code,grade,skill,official_text,verified) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(code) DO UPDATE SET official_text=EXCLUDED.official_text,verified=EXCLUDED.verified",
          [o.sourceId, o.code, o.grade, o.skill, o.officialText, o.verified],
        );
      for (const t of c.topics)
        await db.query(
          "INSERT INTO topics(id,title,grade,term) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
          [t.id, t.title, t.grade, t.term],
        );
      for (const m of c.mappings)
        await db.query(
          "INSERT INTO topic_objectives(topic_id,objective_id,status,rationale) SELECT $1,id,$3,$4 FROM objectives WHERE code=$2 ON CONFLICT(topic_id,objective_id) DO UPDATE SET status=EXCLUDED.status,rationale=EXCLUDED.rationale",
          [m.topicId, m.objectiveCode, m.status, m.rationale],
        );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
      await p.end();
    }
  }
  console.log(report);
}
if (process.argv[1]?.endsWith("curriculum.ts"))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
