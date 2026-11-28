#!/usr/bin/env bash
set -euo pipefail

case "$(uname -m)" in
  x86_64) image=quay.io/pypa/manylinux_2_28_x86_64@sha256:55a36963bc0504cdf004011001c1072306402f0b8b83be5a5eba7068f93eec53 ;;
  aarch64) image=quay.io/pypa/manylinux_2_28_aarch64@sha256:126d9eea9d6b1717f3e17b2b3ac51da04ef159a5f935dac36fe92d621dc8f246 ;;
  *) exit 1 ;;
esac

rust_prefix="$(rustc +1.98.1 --print sysroot)"
node_prefix="$(node -p "require('node:path').dirname(require('node:path').dirname(process.execPath))")"
cargo_cache="${CARGO_HOME:-$HOME/.cargo}"
mkdir -p "$cargo_cache/registry" "$cargo_cache/git"
docker run --rm -i --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" -w "$PWD" \
  -v "$rust_prefix:/opt/build-rust:ro" -v "$node_prefix:/opt/build-node:ro" \
  -v "$cargo_cache/registry:/opt/cargo-cache/registry" -v "$cargo_cache/git:/opt/cargo-cache/git" \
  -e HOME=/tmp -e CARGO_HOME=/tmp/cargo -e CARGO_BUILD_TARGET="$DIM_RUST_TARGET" \
  -e CARGO_BUILD_JOBS=2 -e CARGO_INCREMENTAL=0 -e CARGO_PROFILE_RELEASE_DEBUG=0 \
  -e CARGO_PROFILE_RELEASE_STRIP=symbols "$image" bash -seu <<'BUILD'
export PATH="/opt/build-rust/bin:/opt/build-node/bin:/opt/python/cp312-cp312/bin:$PATH"
mkdir -p "$CARGO_HOME"
ln -s /opt/cargo-cache/{registry,git} "$CARGO_HOME/"
test "$(getconf GNU_LIBC_VERSION)" = 'glibc 2.28'
node scripts/build-dim-host.mjs

# N-API is shared by the bundled Node and Electron. Use the package's own cipher flags.
sqlite="$(realpath node_modules/better-sqlite3-multiple-ciphers)"
node /opt/build-node/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js \
  rebuild --directory="$sqlite" --nodedir=/opt/build-node -- -Dforce_build=1
sqlite_binding="$sqlite/prebuilds/linux-$(node -p process.arch).node"
install -m 0755 "$sqlite/build/Release/better_sqlite3.node" "$sqlite_binding.tmp"
mv "$sqlite_binding.tmp" "$sqlite_binding"
BUILD
