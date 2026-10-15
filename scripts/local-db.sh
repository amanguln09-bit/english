#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
node --env-file=.env.local --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
const u=new URL(process.env.DATABASE_URL||'');
if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/ebg')throw Error('This helper only manages the local ebg test database');
writeFileSync('.local/postgres.env',`POSTGRES_USER=${decodeURIComponent(u.username)}\nPOSTGRES_PASSWORD=${decodeURIComponent(u.password)}\nPOSTGRES_DB=ebg\n`,{mode:0o600});
JS
created=0
if docker container inspect ebg-postgres >/dev/null 2>&1; then
  docker start ebg-postgres >/dev/null
else
  docker run -d --name ebg-postgres --label app=english-brain-games --env-file .local/postgres.env -p 127.0.0.1:5432:5432 postgres:17-alpine >/dev/null
  created=1
fi
for attempt in {1..30}; do
  if docker exec ebg-postgres pg_isready -U ebg >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec ebg-postgres pg_isready -U ebg
if [ "$created" = 1 ] && [ -f .local/ebg-db.dump ]; then
  docker exec -i ebg-postgres pg_restore -U ebg -d ebg --exit-on-error < .local/ebg-db.dump
fi
npm run db:migrate
