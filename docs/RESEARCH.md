# Research and requirements audit

Checked 2026-10-15. This is a working implementation with explicitly incomplete external verification, not a claim that all dissertation acceptance criteria passed.

## Official curriculum

Requested authoritative source: Kazakhstan Education Order No. 399, 16 September 2022, requested Annex 49, at https://adilet.zan.kz/rus/docs/V2200029767 . The HTTPS request failed at the environment egress proxy with `403 Forbidden` before a document could be read. The site's current consolidated version, amendments, annex subject identity, full objective inventory and exact wording **could not be established**. The URL is a source candidate, not an extracted verified source.

Order No. 216 textbook lists, editions, unit titles and lesson mappings remain unverified. No textbook titles, official objective codes or wordings are invented. `data/curriculum.json` deliberately contains zero objectives. `data/verification-report.json` gives grade counts of zero and `complete: false`. Empty data is an outstanding requirement, not successful coverage. A network draft adds `adilet.zan.kz`; this does not itself enable access in the current process.

To complete verification: obtain the consolidated official document and amendment history; identify the English subject for the correct grades; preserve the complete source file, revision date and SHA-256; independently inventory all skill groups and codes; compare extraction counts against that inventory; verify exact texts and amendments; have a curriculum specialist review textbook edition/unit/objective mappings. Import only verified material using `scripts/curriculum.ts`. The importer rejects duplicates, missing source links, incorrect grade prefixes and dangling mappings. Full-coverage declarations are intentionally rejected pending an independently reviewed inventory. The import format is JSON; this is not an unverified PDF/OCR scraper.

Separate data models exist for sources, statutory objectives, textbooks, topics and topic/objective links. Sample game learning aims are ordinary pedagogical prose, never statutory objectives. The five topic labels and 16 questions are original demonstration content, not textbook transcriptions or official curriculum. “Фотография опубликована” was interpreted as a picture-based game, implemented as Picture Quest; the requested template name was ambiguous.

## Technology audit

Registry metadata and the lockfile establish the actually installed versions. Node 24 meets Next 16's >=20.9 requirement. Next 15 initially exposed a PostCSS advisory; upgrading to Next 16.4.1 and PostCSS 8.5.30 removed production dependency audit findings at this check. Verify audits again before release. Next App Router, React 19, Tailwind 4, Zod 3, ws 8, node-postgres, Supabase JS, qrcode, Vitest, Playwright and Wrangler are used. TypeScript checks, production build and local Cloudflare bundling are executable checks, not proof that a remote host is configured.

Reference documentation (links for operator review; not all remotely retrieved in this environment):

- https://nextjs.org/docs/app/guides/custom-server — the custom Node WebSocket mode requires a long-running host. A later adapter adds Next HTTP routes for Vercel using shared PostgreSQL and polling; see VERCEL.md. Neither mode is a static site export.
- https://supabase.com/docs/guides/auth — password login adapter; server-side role comes from app_metadata, not user-editable user_metadata. No Supabase tenant/credentials supplied, so actual hosted login is unverified.
- https://developers.cloudflare.com/durable-objects/ — optional hibernating WebSocket relay with SQLite Durable Objects. The room transport is tested in local workerd. It does not move the authoritative game engine into Durable Objects.
- https://developers.cloudflare.com/workers/platform/pricing/ and https://supabase.com/pricing — verify current plans before purchase; live pricing was not independently verified.
- https://playwright.dev/docs/browsers — system Chromium used because Playwright CDN was forbidden by the proxy.
- https://adilet.zan.kz/eng/docs/Z1300000094 — candidate reference for Kazakhstan personal data law; legal review and current text verification are outstanding.

Main package license families are MIT (Next, React, Tailwind, Zod, ws, qrcode, pg, tsx, Vitest) and Apache-2.0 (Supabase JS, Playwright, Cloudflare tooling). The lockfile records resolved packages and license metadata; transitive dependencies require an organization-specific license review before redistribution. The elephant SVG is an original repository illustration; no student photos are collected.

## Hosting and security decisions

The original custom-server baseline runs one authoritative Node process with PostgreSQL snapshots in runtime_records. The later Vercel HTTP adapter serializes requests using a PostgreSQL advisory transaction lock and reloads shared state per request. Normalized educational import tables coexist with it. Games, questions, sessions, participants, answers and audit events are also projected into normalized tables in the same PostgreSQL transaction; restart recovery reads session snapshots. Single-process serialization protects the custom Node mode; the Vercel HTTP mode adds a shared PostgreSQL transaction lock. Do not mix those modes as simultaneous writers.

Local Auth uses random salted scrypt hashes and HttpOnly session cookies; it is a development fallback. Supabase password login is wired but requires a configured tenant. Disable public self-signup and provision teachers. Admins require trusted `app_metadata.role=admin`. Production DB credentials are server-only. Every schema table has RLS enabled with no anonymous grants. Database-owner connections bypass RLS, so server authorization remains essential; use a dedicated least-privilege role and verify its deployment grants. Do not expose runtime_records to clients.

No legal compliance claim is made. Select Kazakhstan-approved hosting and data location after school/legal review; assess foreign providers, guardian consent, student nickname policy, deletion, backups and cross-border processing before collecting real pupil data.
