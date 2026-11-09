# DeepChat's dim plugins

The pinned Rust host runs these plugins through rutis. Desktop calls their protected-local
management methods; the plugin calls dim services directly. ACP is not part of this connection.
The existing application backend has not switched to dim yet.

Install the host, standalone Node and plugin runtime from the repository root:

```sh
pnpm run installRuntime:dim
```

The installer verifies the six-platform release lock in `resources/dim-runtime-lock.json`, rejects
unsafe archive entries, retains release notices, and installs the pinned rutis dependency tree
with `resources/dim-plugin-runtime/pnpm-lock.yaml`. Native hosts use versioned directories under
`runtime/dim/releases/`. Plugin runtime packages and modules live under `runtime/dim/plugins/`,
outside app.asar. Install/update while the host is stopped; the binary is immutable, while plugin
installation refreshes its Node dependencies and sources. Re-running installation verifies the
existing binary against the release before reuse.

`--js-runtime` takes the rutis-runtime **package directory**, not its runner script. The runtime
installer records that location; it also includes esbuild's six platform packages so packaging
for another supported architecture does not retain only the build machine's executable.

## Current modules

- `deepchat-host` exposes `deepchat.host.capabilities`, `launch`, `input`, `lookup`, `stop`, `idle`
  and `withdraw`. These delegate to dim's `sessions` service. Inputs keep their submission ID;
  a disconnected caller must query the outcome rather than blindly send again.
- `deepchat-storage` exposes `deepchat.storage.capabilities` and bounded `history` reads. Its
  explicit `limit` is 1–200, and the request includes dim's session/branch identity and cursors.
  It uses dim's storage-backed service, never private SQLite tables. This trusted content interface
  is not an Inspector DTO and must not be forwarded wholesale to a renderer.

This first slice does not yet register product tools, bind the queue UI, perform old-session
migration or expose raw timeline inspection. Those remain tracked in the migration plan.
