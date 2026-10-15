# Deployment and operations

## Supported baseline

Use Node 24 and PostgreSQL 17. Run exactly one Node application instance. A TLS reverse proxy must forward HTTP and WebSocket upgrades on `/realtime`, preserve Host/Origin and enforce request limits. Set PUBLIC_ORIGIN to the externally reachable HTTPS origin before creating QR codes. Loopback PIN tests do not prove that phones can reach your deployment.

1. Provision a PostgreSQL database in an approved region; configure server-only DATABASE_URL with verified TLS. Do not disable certificate validation.
2. `npm ci`, then `npm run db:migrate`. Migration runner records applied versions; first migrations must be run against an empty application schema. Do not manually run an applied migration a second time.
3. Set SUPABASE_URL and SUPABASE_ANON_KEY for the school tenant. Provision teachers, disable open signup and set trusted admin app_metadata. The app's local administrator provisioning is not the hosted Supabase administration API.
4. `npm run build`, then `npm start`. Keep `.env.local` private or use your hosting secret manager. Both scripts accept process environment; the server also reads an optional .env.local.
5. Verify login, a private draft, PIN joining, teacher authorization, timed game, WebSocket reconnection and CSV on the actual host before a classroom trial.

`Dockerfile` packages the Next/custom Node server. `compose.yaml` provisions a local PostgreSQL database using an operator-supplied password; use `docker compose --env-file .env.local up -d db` after adding POSTGRES_PASSWORD. Generate a matching DATABASE_URL yourself without committing either value. The onboarding instance used a separate `ebg-postgres` test container. Container image build/deployment to a public registry has not been performed.

## Optional Cloudflare Durable Object relay

`cloudflare/worker.ts` and `wrangler.toml` implement a role-filtered, persistent WebSocket broadcast service. Local workerd tests verify ticket authorization and board-view isolation. The Node engine still owns commands, timers, scoring and PostgreSQL persistence. This differs from a fully Durable-Object-authoritative engine and does not remove the single-Node-instance restriction.

Set APP_ORIGIN in wrangler.toml to your exact HTTPS application origin. Create a random shared RELAY_SECRET securely; configure it both on the Node host and using `wrangler secret put RELAY_SECRET --config cloudflare/wrangler.toml`. Deploy with `npx wrangler deploy --config cloudflare/wrangler.toml`. Set CLOUDFLARE_RELAY_URL on the Node host to the worker's HTTPS origin. Do not use a trailing slash. Never commit the secret. No account token was available here; remote deployment and real edge/WAN performance are not verified.

The Node `/realtime` transport is default. With the relay enabled, clients obtain short-lived role-bound tickets and reconnect to the relay; periodic authenticated HTTP polling is a fallback. Redact query strings from relay access logs because scoped tickets are bearer capabilities. A 5-minute ticket lifetime forces renewal on a later broadcast/reconnection. Relay persisted views have a session-expiry alarm. Explicit Node session deletion requests authenticated relay deletion first and fails if the relay rejects it, allowing a retry. Local workerd tests cover the transport; remote deletion and alarm behavior still require a deployment check.

## Monitoring, recovery and retention

Monitor process restarts, 4xx/5xx rates, login failures, joining latency, WebSocket disconnects, DB saturation, relay failures and clock synchronization. Do not log bearer tokens, cookies, passwords, full question keys or personal names. Add structured metrics and alert routing before production; no monitoring vendor has been configured.

PostgreSQL session snapshots allow reconnect after a process restart. The timer uses absolute server deadlines, so elapsed time continues during downtime. PAUSED sessions retain remaining time. Hibernating connections themselves do not survive process replacement. Session PINs expire after four hours; participants have session-bound random hashed tokens. Local rate limits reset on process restart; production needs edge/global throttling and trusted proxy client-IP handling.

Use encrypted daily database backups and a documented retention schedule. Example operator command: `pg_dump --format=custom --file=backup.dump "$DATABASE_URL"`; store outside the webroot, restrict permissions, and test restoration into an isolated database. Coordinate backups with school deletion policy. A local pg_dump/pg_restore drill into the isolated ebg_restore_test database passed. Remote encrypted backup storage and production restore drills remain unconfigured.

Teacher session deletion removes its stored session snapshot, participants and answers from application persistence. `npm run data:prune` removes snapshots older than RETENTION_DAYS (default 30); run it only while the application is stopped, because the single-process in-memory session map would otherwise retain those sessions. Automated scheduling and expired auth cleanup remain outstanding. The offline pruning helper does not coordinate relay deletion; expired relay views are cleared by their session alarm.

## Cost planning, not current price quotes

Budget roughly USD 10–40/month for a small Node VM, USD 0–30+ for a small PostgreSQL/Supabase plan, USD 0–10+ for low-traffic Worker/DO transport, plus domain, backups and regional hosting. These are planning ranges only, not verified vendor quotes, promises of free-tier suitability, or an assessment of Kazakhstan localization compliance. Recheck official pricing, educational discounts, quotas, payment availability and regional constraints at deployment time.
