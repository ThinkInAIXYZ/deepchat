# DeepChat mygo application

D2b production entry. Unlike `shell/spike`, this package has no generic `Eval`,
probe method, or automatic shutdown timer. It verifies its resource layout,
acquires the single-instance lock before starting Node, checks the native caller
for bound operations, and owns sidecar shutdown through `internal/sidecar`.

Current boundary: this is the initial supervised, single-main-window shell. It
is not the completed Electron replacement. Multiple windows, automatic sidecar
reattachment, legacy secret migration, full native surfaces, packaged Node
runtime distribution, signing, and updates remain covered by the acceptance
checklist. Production mode intentionally fails when bundled resources are absent
rather than silently using the source checkout or an arbitrary system Node.

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
