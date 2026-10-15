import { createStore } from "../server/store";
import type { Session } from "../server/engine";
async function main() {
  const days = Number(process.env.RETENTION_DAYS || 30);
  if (!Number.isFinite(days) || days < 1) throw Error("Invalid RETENTION_DAYS");
  const store = await createStore();
  let removed = 0;
  for (const s of await store.list<Session>("session"))
    if (s.created < Date.now() - days * 86400000) {
      await store.remove("session", s.id);
      removed++;
    }
  console.log({ removed, retentionDays: days });
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
