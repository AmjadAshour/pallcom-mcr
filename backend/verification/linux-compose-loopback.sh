#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d)"
project="mcrphaseone$(basename "$fixture" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')"
legacy_volume="${project}_legacy_sqlite"
restored_volume="${project}_restored_sqlite"
created_volumes=()
port=18443
compose=(docker compose -p "$project"
  -f "$repo_dir/backend/infrastructure/docker/docker-compose.yml"
  -f "$repo_dir/backend/infrastructure/docker/docker-compose.iptv.yml"
  -f "$repo_dir/backend/infrastructure/docker/docker-compose.restricted.yml"
  -f "$fixture/ports.yml")

cleanup() {
  local status=$?
  if ((status != 0)); then
    "${compose[@]}" ps || true
    "${compose[@]}" logs --tail=40 || true
  fi
  "${compose[@]}" down --volumes --timeout 5
  for volume in "${created_volumes[@]}"; do
    docker volume rm "$volume" >/dev/null
  done
}
trap cleanup EXIT

cat > "$fixture/ports.yml" <<EOF
services:
  web:
    ports: !override
      - '127.0.0.1:$port:443'
EOF

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=127.0.0.1' \
  -addext 'subjectAltName=IP:127.0.0.1' -keyout "$fixture/privkey.pem" -out "$fixture/fullchain.pem" \
  >/dev/null 2>&1
export MCR_TLS_DIRECTORY="$fixture"
export MCR_PUBLIC_ORIGIN="https://127.0.0.1:$port"
export JWT_SECRET="$(openssl rand -hex 32)"
export REFRESH_TOKEN_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_MASTER_KEY="$(openssl rand -hex 32)"
export MCR_ADMIN_PASSWORD='' MCR_PROGRAM_STATION_ID='' MCR_PROGRAM_INPUT_URL=''
export MCR_PROGRAM_SRT_URL='' MCR_PROGRAM_SRT_PASSPHRASE=''

"${compose[@]}" config --quiet
"${compose[@]}" up --build -d
"${compose[@]}" exec -T web nginx -t
server_container="$("${compose[@]}" ps -q server)"
[[ -n "$server_container" ]]
if [[ "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$server_container")" != 0 ]]; then
  echo 'The API container must stay behind the gateway'
  exit 1
fi

request=(curl --silent --show-error --noproxy '*' --cacert "$fixture/fullchain.pem" --max-time 4)
ready=false
for _ in {1..30}; do
  if code="$("${request[@]}" --output /dev/null --write-out '%{http_code}' \
      "$MCR_PUBLIC_ORIGIN/api/v1/auth/me" 2>/dev/null)" && [[ "$code" == 401 ]]; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Linux Compose did not return the expected 401 from the application'
  exit 1
fi
"${compose[@]}" exec -T server sh -ec '
  test "$(id -u):$(id -g)" = 1000:1000
  grep -Eq "^CapEff:[[:space:]]+0+$" /proc/1/status
  grep -Eq "^NoNewPrivs:[[:space:]]+1$" /proc/1/status
  sqlite=/app/backend/database/sqlite
  for directory in "$sqlite" /tmp/mcr-hls; do
    test "$(stat -c "%u:%g %a" "$directory")" = "1000:1000 700"
    probe="$(mktemp "$directory/.permission-probe.XXXXXX")"
    rm -f "$probe"
  done
  test -s "$sqlite/mcr_local.db"
'
echo 'Linux Compose API identity, capability drop, private SQLite and HLS mounts passed'
"${request[@]}" --fail --dump-header "$fixture/headers" --output /dev/null "$MCR_PUBLIC_ORIGIN/"
grep -qi '^content-security-policy:' "$fixture/headers"
grep -qi '^strict-transport-security:' "$fixture/headers"
for path in /iptv /iptv/program.m3u8 /iptv/segment-1.ts; do
  code="$("${request[@]}" --output /dev/null --write-out '%{http_code}' "$MCR_PUBLIC_ORIGIN$path")"
  [[ "$code" == 404 ]] || { echo "Legacy IPTV path returned $code"; exit 1; }
done
echo 'Linux Compose TLS, security headers, application gateway and legacy IPTV denial passed'

media_image="$("${compose[@]}" images -q server)"
[[ -n "$media_image" ]]

for volume in "$legacy_volume" "$restored_volume"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo 'Refusing to reuse a fixture volume'
    exit 1
  fi
  docker volume create "$volume" >/dev/null
  created_volumes+=("$volume")
done
container=(docker run --rm --network none)
legacy_root=("${container[@]}" --user 0:0 --mount "type=volume,src=$legacy_volume,dst=/legacy")
legacy_read_only=(--mount "type=volume,src=$legacy_volume,dst=/legacy,readonly")
restored_mount=(--mount "type=volume,src=$restored_volume,dst=/restored")
restricted=("${container[@]}" --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges)
"${legacy_root[@]}" -i -e NODE_ENV=test -e STORAGE_MODE=sqlite -e SQLITE_DB_PATH=/legacy/mcr_local.db \
  "$media_image" sh -ec 'umask 077; chmod 0700 /legacy; node --input-type=module' <<'JS'
import { getSqliteDatabase } from './backend/src/infrastructure/database/sqlite.js';
const db = getSqliteDatabase();
db.prepare('INSERT INTO stations (id, name, organizationId) VALUES (?, ?, ?)').run('fixture', 'Before restore', 'fixture-org');
db.close();
JS
legacy_digest=$("${container[@]}" --user 0:0 "${legacy_read_only[@]}" "$media_image" sha256sum /legacy/mcr_local.db)
"${restricted[@]}" -i "${legacy_read_only[@]}" "$media_image" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { accessSync } from 'node:fs';
assert.throws(() => accessSync('/legacy/mcr_local.db'), { code: 'EACCES' });
JS
"${container[@]}" --user 0:0 "${legacy_read_only[@]}" "${restored_mount[@]}" "$media_image" sh -ec '
  node backend/scripts/sqlite-recovery.js restore /legacy/mcr_local.db /restored/mcr_local.db
  chown 1000:1000 /restored /restored/mcr_local.db
  chmod 0700 /restored
'
"${restricted[@]}" -i "${restored_mount[@]}" "$media_image" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const path = '/restored/mcr_local.db';
const { uid, gid, mode } = statSync(path);
assert.deepEqual([uid, gid, mode & 0o777], [1000, 1000, 0o600]);
const db = new DatabaseSync(path);
try {
  assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
  const station = db.prepare('SELECT name, organizationId FROM stations WHERE id=?');
  assert.deepEqual({ ...station.get('fixture') }, { name: 'Before restore', organizationId: 'fixture-org' });
  assert.equal(db.prepare('UPDATE stations SET name=? WHERE id=?').run('After restore', 'fixture').changes, 1);
  assert.equal(station.get('fixture').name, 'After restore');
  assert(existsSync(path + '-wal'));
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
} finally {
  db.close();
}
JS
[[ "$legacy_digest" == "$("${container[@]}" --user 0:0 "${legacy_read_only[@]}" "$media_image" sha256sum /legacy/mcr_local.db)" ]]
echo 'Linux Compose SQLite permission rehearsal passed with unchanged source'

docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  --user 1000:1000 -e MCR_PROGRAM_PYTHON=/usr/bin/python3 "$media_image" \
  sh -ec 'node --version
    timeout -k 5s 120s node backend/verification/hls-loopback.js
    timeout -k 5s 120s node backend/verification/program-audio-monitor-loopback.js
    timeout -k 5s 45s node backend/verification/credential-cutover-loopback.js'
