#!/usr/bin/env bash
set -euo pipefail

# Debian 10 provides the glibc in the UOS report. Its kernel is shared with the CI runner.
docker run --rm -i -v "$PWD:/source:ro" -w /source \
  -v /etc/ssl/certs/ca-certificates.crt:/tmp/archive-ca.pem:ro \
  debian:buster-slim@sha256:bb3dc79fddbca7e8903248ab916bb775c96ec61014b3d02b4f06043b604726dc bash -seu <<'SMOKE'
test "$(getconf GNU_LIBC_VERSION)" = 'glibc 2.28'
packages=(/source/dist/*-linux-"$(dpkg --print-architecture)".deb)
test "${#packages[@]}" -eq 1
test "$(dpkg-deb -f "${packages[0]}" Architecture)" = "$(dpkg --print-architecture)"
test "$(dpkg-deb -f "${packages[0]}" Package)" = deepchat
echo 'deb https://archive.debian.org/debian buster main' > /etc/apt/sources.list
apt_options=(-o Acquire::https::CaInfo=/tmp/archive-ca.pem -o Acquire::Check-Valid-Until=false)
apt-get "${apt_options[@]}" update -qq
DEBIAN_FRONTEND=noninteractive apt-get "${apt_options[@]}" install -y --no-install-recommends "${packages[0]}" xvfb xauth
resources=/opt/DeepChat/resources
unpacked="$resources/app.asar.unpacked"
node="$unpacked/runtime/node/bin/node"
test "$(cat "$resources/package-type")" = deb
"$node" - "$unpacked" <<'SQLITE'
const assert = require('node:assert/strict')
const Database = require(process.argv[2] + '/node_modules/better-sqlite3-multiple-ciphers')
const filename = '/tmp/cipher-smoke.db'
const db = new Database(filename)
db.pragma("cipher='sqlcipher'")
db.pragma("key='smoke-test'")
db.exec('CREATE TABLE example(value); INSERT INTO example VALUES (42)')
db.close()
assert.throws(() => new Database(filename).prepare('SELECT value FROM example').get())
const reopened = new Database(filename)
reopened.pragma("cipher='sqlcipher'")
reopened.pragma("key='smoke-test'")
assert.equal(reopened.prepare('SELECT value FROM example').get().value, 42)
reopened.close()
const pty = require(process.argv[2] + '/node_modules/node-pty')
const child = pty.spawn('/bin/sh', ['-c', 'printf pty-ready'])
let output = ''
child.onData(data => { output += data })
const timeout = setTimeout(() => process.exit(1), 5000)
child.onExit(({ exitCode }) => {
  clearTimeout(timeout)
  assert.equal(exitCode, 0)
  assert.match(output, /pty-ready/)
})
SQLITE
"$node" scripts/smoke-dim-runtime.mjs --resources-path "$resources"
if [[ "$(dpkg --print-architecture)" == arm64 ]]; then
  "$node" scripts/smoke-opendal-native.js --project-dir "$unpacked"
fi
install -d -m 0700 -o nobody -g nogroup /tmp/deepchat-user /tmp/deepchat-user/runtime
runuser -u nobody -- env HOME=/tmp/deepchat-user XDG_RUNTIME_DIR=/tmp/deepchat-user/runtime \
  xvfb-run -a /opt/DeepChat/deepchat --disable-gpu \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 >/tmp/deepchat.log 2>&1 &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true' EXIT
if ! "$node" --input-type=module <<'APP'
import { setTimeout as delay } from 'node:timers/promises'
for (let attempt = 0; attempt < 90; attempt++) {
  const pages = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json()).catch(() => [])
  if (pages.some(page => page.type === 'page' && page.url.includes('/out/renderer/index.html'))) process.exit(0)
  await delay(1000)
}
process.exit(1)
APP
then
  cat /tmp/deepchat.log >&2
  exit 1
fi
SMOKE
