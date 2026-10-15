import { spawnSync } from "node:child_process";
// Vercel injects DATABASE_URL before build. Apply versioned migrations once,
// without printing credentials; a failed migration must fail the deployment.
const tasks = process.env.DATABASE_URL ? ["db:migrate", "build"] : ["build"];
if (!process.env.DATABASE_URL)
  console.warn(
    "DATABASE_URL is not set: build can finish, but classroom APIs require PostgreSQL. Add it in Vercel settings and redeploy.",
  );
for (const task of tasks) {
  const r = spawnSync("npm", ["run", task], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
