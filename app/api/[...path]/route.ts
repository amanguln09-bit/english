import type { IncomingMessage, ServerResponse } from "node:http";
import { createRuntime } from "../../../server/runtime";
import { withDatabaseLock } from "../../../server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
let shared: Promise<Awaited<ReturnType<typeof createRuntime>>> | undefined;
async function handler(request: Request) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (!process.env.DATABASE_URL)
    return Response.json(
      {
        error:
          "Vercel ортасында DATABASE_URL бапталмаған. PostgreSQL қосылымын Vercel → Project Settings → Environment Variables бөліміне қосып, қайта жариялаңыз.",
        code: "DATABASE_NOT_CONFIGURED",
      },
      { status: 503, headers },
    );
  try {
    return await withDatabaseLock(async () => {
      shared ??= createRuntime({ serverless: true }).catch((e) => {
        shared = undefined;
        throw e;
      });
      const api = await shared;
      await api.reloadSessions();
      const data = new Uint8Array(await request.arrayBuffer());
      if (data.byteLength > 100000)
        return Response.json(
          { error: "Request too large" },
          { status: 413, headers },
        );
      const requestHeaders = Object.fromEntries(request.headers.entries());
      requestHeaders.host ||= new URL(request.url).host;
      const req = {
        url: `${request.headers.get("x-forwarded-proto") === "https" ? "https:" : new URL(request.url).protocol}//${requestHeaders.host}${new URL(request.url).pathname}${new URL(request.url).search}`,
        method: request.method,
        headers: requestHeaders,
        socket: {
          remoteAddress:
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            "serverless",
        },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(data);
        },
      } as unknown as IncomingMessage;
      let status = 200;
      let body = "";
      const res = {
        setHeader(k: string, v: string) {
          headers.set(k, v);
          return this;
        },
        writeHead(code: number, values: Record<string, string>) {
          status = code;
          for (const [k, v] of Object.entries(values || {})) headers.set(k, v);
          return this;
        },
        end(value?: string) {
          body = value || "";
          return this;
        },
      } as unknown as ServerResponse;
      await api.handleApi(req, res);
      return new Response(body, { status, headers });
    });
  } catch (e) {
    console.error(
      "API request failed",
      e instanceof Error ? e.name : "unknown",
    );
    return Response.json(
      {
        error:
          "Дерекқормен байланыс орнамады. PostgreSQL қосылымы мен миграцияларын тексеріңіз.",
        code: "DATABASE_UNAVAILABLE",
      },
      { status: 503, headers },
    );
  }
}
export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
