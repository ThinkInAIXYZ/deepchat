# Windows ARM64 Support Plan

## Architecture

- Validate Windows ARM64 on GitHub's `windows-11-arm` runner with Playwright smoke tests against the built Electron app plus a separate process smoke for the packaged executable.
- Extend the manual build workflow's Windows matrix to produce `win-x64` and `win-arm64` artifacts while keeping the release workflow on Windows x64 only.
- Keep the Windows ARM64 runtime script explicit: install only verified native `uv`, `node`, and `ripgrep` artifacts.
- Use a `sharp` version that publishes `@img/sharp-win32-arm64`, otherwise main-process image helpers fail during E2E bootstrap on Windows ARM64.
- Provide a CI-specific E2E mode that runs only non-provider smoke specs against the runner profile.
- Keep `_electron.launch()` for interactive E2E coverage because the packaged Windows executable does not reliably expose a Playwright-controllable debug endpoint in CI.
- Start the packaged Windows ARM64 executable separately and verify it remains alive for a short smoke window, with process output, app logs, native module inventory, and Windows event logs uploaded as diagnostics.
- Run packaged executable smoke only after interactive E2E succeeds, so startup failures keep the main-process logs focused on the failing launch.

## E2E Data Flow

1. The Playwright fixture launches the built Electron app with the default Electron `userData` path for the current runner/user.
2. CI Playwright config matches only launch and settings-navigation smoke specs.
3. Chat, session persistence, and provider connectivity specs remain available for local/manual runs with configured providers.
4. The Playwright fixture attaches renderer diagnostics and `userData/logs` main-process logs to each test result.
5. The packaged executable smoke runs outside Playwright and writes stdout/stderr, Chromium logs, app logs, filesystem inventory, native module inventory, and Windows application events into the diagnostics artifact.

## Runtime Behavior

- `installRuntime:win:arm64` calls `tiny-runtime-injector` directly for `uv`, `node`, and `ripgrep`.
- `ripgrep` is pinned to `15.1.0` for Windows ARM64 because the injector default `14.1.1` has no ARM64 Windows release asset.
- `rtk` is intentionally omitted until upstream ships a Windows ARM64 release asset; existing runtime consumers continue to detect missing bundled binaries and fall back to system/runtime-unavailable behavior.

## Validation

- Runtime fallback tests cover missing bundled runtime behavior.
- Existing RTK fallback coverage remains in place.
- Skill runtime tests cover the no-UV/no-system-Python auto-runtime failure path.
- The manual build workflow validates Windows x64 and Windows ARM64 artifact generation.
- The new manual workflow validates Windows ARM64 build, plugin bundle, packaged executable startup, app launch, route switching, and settings navigation.
- The Windows ARM64 E2E workflow uploads Playwright reports, traces, screenshots, app logs, native module inventory, Windows event logs, and process-smoke logs only.
