import { it, expect, vi } from "vitest";
import { GET } from "../app/api/[...path]/route";
it("returns a useful JSON error, not an HTML page, when Vercel has no database", async () => {
  vi.stubEnv("DATABASE_URL", "");
  try {
    const r = await GET(new Request("https://example.test/api/me"));
    expect(r.status).toBe(503);
    expect(r.headers.get("content-type")).toContain("application/json");
    const body = await r.json();
    expect(body.code).toBe("DATABASE_NOT_CONFIGURED");
    expect(body.error).toContain("DATABASE_URL");
  } finally {
    vi.unstubAllEnvs();
  }
});
