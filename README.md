# English Brain Games

Working classroom game application for grades 6–8: teacher control, phone participation using PIN/QR, shared board, five playable sample templates, results and content copies. Kazakh/English interface; student questions in English.

**Status:** functional local implementation; not a completed production release or fully verified Kazakhstan curriculum. Read [research audit](docs/RESEARCH.md), [deployment](docs/DEPLOYMENT.md) and [implementation report](docs/IMPLEMENTATION.md) before use with real students.

## Vercel

See [Vercel setup and the HTML/JSON API fix](docs/VERCEL.md). Next.js HTTP routes now support Vercel with a PostgreSQL DATABASE_URL; the build applies migrations automatically when configured. No native WebSocket server runs inside a Vercel function: an optional Cloudflare relay or authenticated 3-second polling provides session updates. Missing database configuration returns a clear JSON 503 error. Teacher access stays passwordless.

## Run locally

Requirements: Node 24, npm. PostgreSQL 17 recommended; Docker optional. System Chromium or another Playwright-supported installation for browser tests.

```bash
cd /workspace/english
bash scripts/setup.sh
npm run dev
```

The teacher workspace opens immediately without registration, login or password. Each browser receives its own random HttpOnly workspace cookie valid for 30 days; other browsers cannot control its sessions or edit its private copies. Clearing cookies or changing devices does not recover that workspace. `/login` redirects to `/dashboard`. Administration remains separate at `/admin/login`. Setup preserves an existing .env.local; a new one receives optional private administrator credentials. Those credentials are not needed to play or host. The setup does not create a Supabase account. Never share or commit the private environment file. For SQLite fallback leave DATABASE_URL unset; local data lives in `.local/brain-games.sqlite`. Node's SQLite API is experimental. Production requires PostgreSQL unless ALLOW_LOCAL_DEMO is explicitly set for a local smoke test.

For PostgreSQL, set DATABASE_URL in the private environment and run `npm run db:migrate`. Then use `npm run dev`. See `.env.example`. Set PUBLIC_ORIGIN when phones must connect from another device. Server listens on port 3000 by default. HTTPS is mandatory outside local development.

## Classroom workflow

1. Open Games directly, choose a sample and inspect its answer key. No teacher password is required.
2. Select 3–7 minutes and immediate or teacher-controlled feedback; launch a session.
3. Open the board, show its PIN/QR. Learners enter a nickname on Join without an account.
4. Start, pause/resume, reveal, advance questions, finish. The timer covers the whole game.
5. View results or export CSV; replay creates a fresh session. Delete session data when appropriate.
6. Use Make my copy to edit validated game JSON without changing the original. Personal drafts can be played by their owner. An admin can change draft/reviewed/published/archived status.

Word Race uses vocabulary and ordering; Picture Quest uses an original illustration; Odd One Out uses categorization; Mystery Box uses clues; Brain Battle mixes multi-select, grammar and discussion. All templates share the same authoritative engine. Discussion submissions are ungraded, never automatically incorrect. These are small original samples, not a complete textbook.

## Commands

```bash
npm run curriculum:check
npm test                     # includes local Cloudflare bundle + workerd relay test
npm run typecheck
npm run worker:check
npm run build
npm start                    # requires PostgreSQL in production mode
npm run test:e2e              # running app + .env.local admin required
```

Playwright config uses `/usr/bin/chromium` by default. Override CHROMIUM_PATH for your installation. Browser tests include a teacher, phone and board, plus 30 concurrent API/WebSocket learners. They are not 30 real smartphones or an internet load test. Raw measurements are in `data/classroom-report.json`; new runs overwrite them. Do not publish raw Playwright traces: they can contain local credentials entered during sign-in.

Verified curriculum JSON can be validated/imported with `node --env-file-if-exists=.env.local --import tsx scripts/curriculum.ts data/curriculum.json --import`. Currently it imports only the blocked-source record, no official objectives. Do not mark coverage complete until sources are retrieved and reviewed.

## Structure

- `app/`: Next App Router shell and responsive Kazakh/English views for all requested routes.
- `lib/content.ts`: Zod schema, original game samples and scoring.
- `server/`: HTTP authorization, SQLite/PostgreSQL adapters, Supabase/local Auth, authoritative state engine, WebSocket transport.
- `supabase/migrations/`: relational curriculum schema and protected runtime persistence.
- `scripts/`: setup, migrations, curriculum import/validation and retention.
- `cloudflare/`: optional Durable Object relay and Wrangler configuration.
- `tests/`: engine/provenance tests, workerd relay test, browser/classroom simulation.
- `data/`: honest source status, verification inventory and measured classroom results.

No deployment or public URL is provisioned automatically. No real external credentials are included. This environment already provides an isolated checkout; use it directly and do not create a Git worktree unless explicitly requested.
