#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
# Existing .env.local is never overwritten. Local credentials stay outside Git.
node --input-type=module <<'JS'
import {existsSync,writeFileSync} from 'node:fs';import {randomBytes} from 'node:crypto';
if(!existsSync('.env.local'))writeFileSync('.env.local',`LOCAL_ADMIN_EMAIL=teacher@example.test\nLOCAL_ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}\n`,{mode:0o600});
JS
printf 'Dependencies installed. Configuration: .env.local (private).\n'
