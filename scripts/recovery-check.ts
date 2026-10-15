import { readFileSync, writeFileSync } from "node:fs";
const origin = "http://127.0.0.1:3000";
async function main() {
  if (process.argv.includes("--prepare")) {
    const r = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.LOCAL_ADMIN_EMAIL,
        password: process.env.LOCAL_ADMIN_PASSWORD,
      }),
    });
    if (!r.ok) throw Error("Login failed");
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    const call = async (path: string, body?: unknown, token?: string) => {
      const res = await fetch(origin + "/api" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw Error("API failed " + res.status);
      return res.json();
    };
    const { id } = await call("/sessions", {
      gameId: "word-race",
      duration: 420,
      feedback: "immediate",
    });
    const s = await call("/sessions/" + id);
    const p = await call("/join", { pin: s.pin, name: "Recovery test" });
    await call(`/sessions/${id}/command`, { action: "start" });
    await call(
      `/sessions/${id}/answer`,
      { index: 0, answer: ["library"] },
      p.token,
    );
    await call(`/sessions/${id}/command`, { action: "pause" });
    writeFileSync(
      ".local/recovery.json",
      JSON.stringify({ id, token: p.token }),
      { mode: 0o600 },
    );
    console.log(
      "Paused recovery session saved; restart the server before verifying.",
    );
  } else {
    const { id, token } = JSON.parse(
      readFileSync(".local/recovery.json", "utf8"),
    );
    const r = await fetch(origin + "/api/sessions/" + id, {
      headers: { Authorization: "Bearer " + token },
    });
    const s = await r.json();
    if (!r.ok || s.state !== "PAUSED" || !s.submitted || s.own?.points !== 100)
      throw Error("Restart recovery failed");
    console.log(
      "Process restart recovery verified: participant identity, submitted answer, score and paused timer retained.",
    );
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
