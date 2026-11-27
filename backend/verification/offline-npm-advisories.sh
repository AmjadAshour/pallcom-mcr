#!/usr/bin/env bash
set -euo pipefail

scanner_dir="$(mktemp -d)"
scanner="$scanner_dir/osv-scanner"
report="$scanner_dir/report.json"
mkdir -p "$scanner_dir/osv-scalibr/npm"
curl --fail --silent --show-error --location --retry 2 --max-time 240 \
  https://github.com/google/osv-scanner/releases/download/v2.7.1/osv-scanner_linux_amd64 -o "$scanner"
printf '%s  %s\n' 'fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8' "$scanner" |
  sha256sum --check
chmod 700 "$scanner"
dataset="$scanner_dir/osv-scalibr/npm/all.zip"
curl --fail --silent --show-error --location --retry 2 --max-time 360 \
  https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip -o "$dataset"
sha256sum "$dataset"

scan_status=0
sudo unshare --net --setuid "$(id -u)" --setgid "$(id -g)" -- \
  env OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY="$scanner_dir" \
  "$scanner" scan source --offline --all-packages --lockfile package-lock.json \
  --format=json --output-file "$report" || scan_status=$?
if ((scan_status > 1)); then
  exit "$scan_status"
fi

node --input-type=module - "$report" "$scan_status" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const runtime = new Set();
for (const [location, entry] of Object.entries(lock.packages)) {
  if (entry.dev || entry.link || !entry.version || !location.includes('node_modules/')) continue;
  const name = entry.name || location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
  runtime.add(name + '@' + entry.version);
}
const packages = report.results.flatMap(source => source.packages);
assert(packages.length > 0, 'Offline scanner returned no package inventory');
const findings = new Map();
for (const { package: pkg, vulnerabilities = [] } of packages) {
  const identity = pkg.name + '@' + pkg.version;
  for (const advisory of vulnerabilities) {
    const scope = runtime.has(identity) ? 'production lockfile' : 'other lockfile entry';
    findings.set(identity + '/' + advisory.id, { identity, scope, id: advisory.id });
  }
}
const production = [...findings.values()].filter(item => item.scope === 'production lockfile');
console.log('OSV package records:', packages.length);
console.log('OSV advisory-package matches:', findings.size, 'production lockfile matches:', production.length);
for (const item of [...findings.values()]) console.log(item.scope, item.identity, item.id);
assert.equal(Number(process.argv[3]), findings.size ? 1 : 0, 'Scanner exit status disagreed with advisory output');
if (findings.size) process.exitCode = 1;
JS
