# Windows ARM64 Support Plan

## Architecture

- Validate a packaged/unpacked ARM64 build with a Windows ARM64 manual workflow running on GitHub's `windows-11-arm` runner and Playwright Electron smoke tests.
- Keep the Windows ARM64 runtime script explicit: install only verified native `uv`, `node`, and `ripgrep` artifacts.
- Provide a CI-specific E2E mode that runs only non-provider smoke specs against the runner profile.

## E2E Data Flow

1. The Playwright fixture launches DeepChat with the default Electron `userData` path for the current runner/user.
2. CI Playwright config matches only launch and settings-navigation smoke specs.
3. Chat, session persistence, and provider connectivity specs remain available for local/manual runs with configured providers.

## Runtime Behavior

- `installRuntime:win:arm64` calls `tiny-runtime-injector` directly for `uv`, `node`, and `ripgrep`.
- `ripgrep` is pinned to `15.1.0` for Windows ARM64 because the injector default `14.1.1` has no ARM64 Windows release asset.
- `rtk` is intentionally omitted until upstream ships a Windows ARM64 release asset; existing runtime consumers continue to detect missing bundled binaries and fall back to system/runtime-unavailable behavior.

## Validation

- Runtime fallback tests cover missing bundled runtime behavior.
- Existing RTK fallback coverage remains in place.
- Skill runtime tests cover the no-UV/no-system-Python auto-runtime failure path.
- The new manual workflow validates Windows ARM64 build, plugin bundle, app launch, route switching, and settings navigation.
