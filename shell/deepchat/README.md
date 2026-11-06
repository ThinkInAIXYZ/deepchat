# DeepChat mygo application

D2b production entry. Unlike `shell/spike`, this package has no generic `Eval`,
probe method, or automatic shutdown timer. It verifies its resource layout,
acquires the single-instance lock before starting Node, checks the native caller
for bound operations, and owns sidecar shutdown through `internal/sidecar`.

Current boundary: this is the initial supervised, single-main-window shell. It
is not the completed Electron replacement. D2c1 coordinates real main-process
shutdown, replaces an unexpectedly stopped sidecar with bounded backoff, and
reloads the renderer after the real dispatcher is ready. It never replays a
request on a replacement process. Owned stdout pipes and independent process
waiting prevent EOF/reaping deadlocks. A blocked partial write terminates its
generation rather than corrupting the next request. Root exit always cleans the
remaining owned process group; cleanup failure is terminal, not a restart
license. Windows uses a per-generation Job Object for this ownership, but has
only been compiled, not runtime-tested. Multiple windows, legacy secret migration,
full native surfaces, packaged Node runtime distribution, signing, and updates
remain covered by the acceptance checklist. Production mode intentionally fails
when bundled resources are absent rather than silently using the source checkout
or an arbitrary system Node.

## Development validation

Build the real renderer, typed preload, and sidecar first:

```sh
pnpm exec electron-vite build
pnpm run preload:build
pnpm run sidecar:app:build

cd shell
go test ./...
go build -o /tmp/deepchat-mygo ./deepchat
DEEPCHAT_APP_PATH=/absolute/path/to/deepchat \
DEEPCHAT_USER_DATA=/absolute/path/to/temporary-profile \
  /tmp/deepchat-mygo
```

`DEEPCHAT_APP_PATH` selects repository development resources and permits
`exec.LookPath("node")`. Use only a disposable user-data directory for smoke
runs. Without that variable, the app requires:

```text
<resources>/runtime/node/bin/node[.exe]
<resources>/sidecar/app.mjs (+ background host entries and shared assets)
<resources>/preload/bridge.js
```

The mygo config uses `out/renderer` as `frontendDist`. Runtime packaging and the
sidecar's complete external dependencies are still a later D6 acceptance gate;
no all-in-one installer is claimed here.

## Opt-in native UI verification

Only explicit e2e builds import mygo's official automation plugin. It provides
window eval and screenshot operations through a named local socket, without the
product Bridge gaining a generic Eval method:

```sh
go build -tags e2e -o /tmp/deepchat-mygo-e2e ./deepchat
DEEPCHAT_APP_PATH=/absolute/path/to/deepchat \
DEEPCHAT_USER_DATA=/absolute/path/to/disposable-profile \
MYGO_AUTOMATION=/tmp/deepchat-mygo-automation.sock \
  /tmp/deepchat-mygo-e2e
```

The socket is not opened without `MYGO_AUTOMATION`. Standard `go build` does not
include the plugin; `mygo build` also strips it with `mygo_noinspector`. See the
upstream `docs/plugins/automation.md` for the JSON-lines protocol. UI acceptance
must use a disposable profile and inspect DOM, native IPC results, and the
completed-window screenshot together.
