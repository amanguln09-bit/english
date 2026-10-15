import { writeFileSync } from "node:fs";
const primary = process.env.PRIMARY_SERVER || "http://127.0.0.1:3000";
const secondary = process.env.SECONDARY_SERVER || "http://127.0.0.1:3100";
async function request(
  base: string,
  path: string,
  body?: unknown,
  cookie?: string,
  token?: string,
) {
  return fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function check(ok: boolean, message: string) {
  if (!ok) throw Error(message);
}
async function main() {
  const me = await request(primary, "/me");
  check(me.ok, "Primary workspace unavailable");
  const cookie = me.headers.get("set-cookie")?.split(";")[0];
  check(!!cookie, "Workspace cookie missing");
  const created = await request(
    primary,
    "/sessions",
    { gameId: "word-race", duration: 180, feedback: "immediate" },
    cookie,
  );
  check(created.ok, "Create session failed");
  const { id } = await created.json();
  try {
    const fromSecond = await request(
      secondary,
      "/sessions/" + id,
      undefined,
      cookie,
    );
    check(
      fromSecond.ok,
      "Session or ownership did not survive another server instance (HTTP " +
        fromSecond.status +
        ")",
    );
    const session = await fromSecond.json();
    const joined = await request(secondary, "/join", {
      pin: session.pin,
      name: "Instance check",
    });
    check(joined.ok, "Join on secondary instance failed");
    const { token } = await joined.json();
    check(
      (
        await request(
          primary,
          `/sessions/${id}/command`,
          { action: "start" },
          cookie,
        )
      ).ok,
      "Start failed",
    );
    const answers = await Promise.all(
      [primary, secondary].map((base) =>
        request(
          base,
          `/sessions/${id}/answer`,
          { index: 0, answer: ["library"] },
          undefined,
          token,
        ),
      ),
    );
    const statuses = answers.map((a) => a.status).sort();
    check(
      statuses[0] === 200 && statuses[1] === 400,
      "Concurrent duplicate was not scored exactly once",
    );
    check(
      (
        await request(
          secondary,
          `/sessions/${id}/command`,
          { action: "finish" },
          cookie,
        )
      ).ok,
      "Finish on second instance failed",
    );
    const result = await (
      await request(primary, "/sessions/" + id, undefined, cookie)
    ).json();
    check(result.leaderboard[0]?.score === 100, "Duplicate changed score");
    const report = {
      timestamp: new Date().toISOString(),
      conditions:
        "Two separate next start processes sharing PostgreSQL 17 on loopback. Not a deployed Vercel or WAN test.",
      instanceCount: 2,
      sharedSession: true,
      sharedOwnership: true,
      concurrentDuplicateStatuses: statuses,
      score: 100,
      errors: [],
    };
    writeFileSync(
      "data/serverless-report.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      "Two-instance verification passed: shared state, owner authorization and exactly-once scoring.",
    );
  } finally {
    const deleted = await request(
      primary,
      `/sessions/${id}/delete`,
      {},
      cookie,
    );
    check(deleted.ok, "Test-session cleanup failed");
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
