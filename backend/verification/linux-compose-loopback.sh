#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d)"
project="mcrphaseone$(basename "$fixture" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')"
port=18443
compose=(docker compose -p "$project"
  -f "$repo_dir/backend/infrastructure/docker/docker-compose.yml"
  -f "$repo_dir/backend/infrastructure/docker/docker-compose.iptv.yml"
  -f "$fixture/ports.yml")

cleanup() {
  local status=$?
  if ((status != 0)); then
    "${compose[@]}" ps || true
    "${compose[@]}" logs --tail=40 || true
  fi
  "${compose[@]}" down --volumes --timeout 5
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
if [[ -n "$("${compose[@]}" port server 4000 2>/dev/null || true)" ]]; then
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
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  --user 1000:1000 -e MCR_PROGRAM_PYTHON=/usr/bin/python3 "$media_image" \
  sh -ec 'node --version
    timeout -k 5s 120s node backend/verification/hls-loopback.js
    timeout -k 5s 120s node backend/verification/program-audio-monitor-loopback.js
    timeout -k 5s 45s node backend/verification/credential-cutover-loopback.js'
