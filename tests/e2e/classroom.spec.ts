import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { WebSocket } from "ws";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .trim()
    .split("\n")
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
test("teacher, phone, board and results", async ({ browser, page }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(env.LOCAL_ADMIN_EMAIL);
  await page.locator("input[type=password]").fill(env.LOCAL_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Кіру", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/games/word-race");
  await page.getByRole("button", { name: "Сессия құру" }).click();
  await expect(page).toHaveURL(/sessions\/.*\/host/);
  const id = page.url().split("/")[4];
  await expect(page.locator(".pin")).toBeVisible();
  const pin = (await page.locator(".pin").innerText()).trim();
  const boardContext = await browser.newContext();
  const board = await boardContext.newPage();
  await board.goto(`/sessions/${id}/display`);
  const student = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const phone = await student.newPage();
  await phone.goto("/join?pin=" + pin);
  await phone.getByLabel("Лақап ат").fill("Phone learner");
  await phone.getByRole("button", { name: "Қосылу →", exact: true }).click();
  await expect(phone).toHaveURL(/play/);
  await page.getByRole("button", { name: "Бастау", exact: true }).click();
  await expect(
    phone.getByRole("heading", {
      name: "Which word means a place where you borrow books?",
    }),
  ).toBeVisible();
  await expect(
    board.getByRole("heading", {
      name: "Which word means a place where you borrow books?",
    }),
  ).toBeVisible();
  await phone.getByRole("button", { name: "library", exact: true }).click();
  await phone
    .getByRole("button", { name: "Жауапты жіберу", exact: true })
    .click();
  await expect(phone.getByText("Жауап қабылданды")).toBeVisible();
  await phone.reload();
  await expect(phone.getByText("Жауап қабылданды")).toBeVisible();
  await page.getByRole("button", { name: "Жауапты ашу", exact: true }).click();
  await expect(phone.getByText("Дұрыс · +100")).toBeVisible();
  await page.getByRole("button", { name: "Аяқтау", exact: true }).click();
  await expect(
    phone.getByRole("heading", { name: "Ойын нәтижелері" }),
  ).toBeVisible();
  await expect(
    phone.getByRole("cell", { name: "100", exact: true }),
  ).toBeVisible();
  const result = await page.request.get(`/api/sessions/${id}/export`);
  expect(result.status()).toBe(200);
  expect(await result.text()).toContain("Phone learner");
  await student.close();
  await boardContext.close();
});
test("30 concurrent learners: joins, live delivery, answers, reconnect, export", async ({
  request,
}) => {
  test.setTimeout(60000);
  await request.post("/api/login", {
    data: { email: env.LOCAL_ADMIN_EMAIL, password: env.LOCAL_ADMIN_PASSWORD },
  });
  const created = await request.post("/api/sessions", {
    data: { gameId: "word-race", duration: 180, feedback: "teacher" },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  const host = await (await request.get("/api/sessions/" + id)).json();
  const errors: string[] = [];
  const joins = await Promise.all(
    Array.from({ length: 30 }, async (_, i) => {
      const t = performance.now();
      const r = await request.post("/api/join", {
        data: { pin: host.pin, name: "Learner " + i },
      });
      if (!r.ok()) errors.push("join " + r.status());
      return { ...(await r.json()), joinMs: performance.now() - t };
    }),
  );
  const sockets: WebSocket[] = [];
  let disconnects = 0;
  const deliveries: number[] = [];
  let sentAt = 0;
  await Promise.all(
    joins.map(
      (j) =>
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket("ws://127.0.0.1:3000/realtime", {
            origin: "http://127.0.0.1:3000",
            handshakeTimeout: 5000,
          });
          sockets.push(ws);
          ws.on("open", () =>
            ws.send(JSON.stringify({ id, role: "student", token: j.token })),
          );
          let initialized = false,
            delivered = false;
          ws.on("message", (data) => {
            const v = JSON.parse(data.toString());
            if (!initialized) {
              initialized = true;
              resolve();
            }
            if (v.state === "ACTIVE" && !delivered && sentAt) {
              deliveries.push(performance.now() - sentAt);
              delivered = true;
            }
          });
          ws.on("error", reject);
          ws.on("close", () => {
            disconnects++;
            if (!initialized)
              reject(Error("WebSocket closed before authentication"));
          });
        }),
    ),
  );
  sentAt = performance.now();
  expect(
    (
      await request.post(`/api/sessions/${id}/command`, {
        data: { action: "start" },
      })
    ).ok(),
  ).toBeTruthy();
  const answerMs = await Promise.all(
    joins.map(async (j) => {
      const t = performance.now();
      const r = await request.post(`/api/sessions/${id}/answer`, {
        data: { index: 0, answer: ["library"] },
        headers: { Authorization: "Bearer " + j.token },
      });
      if (!r.ok()) errors.push("answer " + r.status());
      return performance.now() - t;
    }),
  );
  const dup = await request.post(`/api/sessions/${id}/answer`, {
    data: { index: 0, answer: ["library"] },
    headers: { Authorization: "Bearer " + joins[0].token },
  });
  expect(dup.status()).toBe(400);
  const unauthorized = await request.post(`/api/sessions/${id}/command`, {
    data: { action: "pause" },
    headers: { Cookie: "", Authorization: "Bearer " + joins[0].token },
  });
  expect(unauthorized.status()).toBe(403);
  await request.post(`/api/sessions/${id}/command`, {
    data: { action: "finish" },
  });
  const result = await (await request.get("/api/sessions/" + id)).json();
  expect(result.leaderboard).toHaveLength(30);
  expect(result.leaderboard.every((p: any) => p.score === 100)).toBe(true);
  expect(deliveries).toHaveLength(30);
  expect(errors).toEqual([]);
  const report = {
    timestamp: new Date().toISOString(),
    conditions:
      "One Node process, PostgreSQL 17 Docker, loopback network; 30 WebSocket/API learners, one teacher. Not a physical classroom or WAN test.",
    learners: 30,
    deliveryMs: deliveries,
    joinMs: joins.map((j) => j.joinMs),
    answerMs,
    errors,
    unexpectedDisconnects: disconnects,
  };
  writeFileSync("data/classroom-report.json", JSON.stringify(report, null, 2));
  sockets.forEach((s) => s.close());
});
test("public APIs hide private material and reject unauthenticated access", async ({
  request,
  page,
}) => {
  expect((await request.get("/api/games")).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Ойна/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("personal copy, admin approval and teacher role boundaries", async ({
  playwright,
  request,
}) => {
  await request.post("/api/login", {
    data: { email: env.LOCAL_ADMIN_EMAIL, password: env.LOCAL_ADMIN_PASSWORD },
  });
  const copy = await (
    await request.post("/api/games/word-race/copy", { data: {} })
  ).json();
  expect(copy.status).toBe("draft");
  const edited = await request.post("/api/games/" + copy.id, {
    data: { ...copy, title: "Classroom custom vocabulary" },
  });
  expect(edited.ok()).toBe(true);
  expect(
    (
      await request.post(`/api/games/${copy.id}/approve`, {
        data: { status: "reviewed" },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`/api/games/${copy.id}/approve`, {
        data: { status: "published" },
      })
    ).ok(),
  ).toBe(true);
  const original = await (await request.get("/api/games/word-race")).json();
  expect(original.title).toBe("Word Race");
  const email = "teacher-" + Date.now() + "@example.test";
  const password = "Test-fixture-password-123";
  expect(
    (
      await request.post("/api/admin/users", { data: { email, password } })
    ).ok(),
  ).toBe(true);
  const teacher = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:3000",
  });
  try {
    expect(
      (await teacher.post("/api/login", { data: { email, password } })).ok(),
    ).toBe(true);
    expect((await teacher.get("/api/admin")).status()).toBe(403);
    expect(
      (
        await teacher.post(`/api/games/${copy.id}/approve`, {
          data: { status: "archived" },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await teacher.dispose();
  }
});
