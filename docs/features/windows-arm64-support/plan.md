# Windows ARM64 Support Plan

## Architecture

- Validate a packaged/unpacked ARM64 build with a Windows ARM64 manual workflow running on GitHub's `windows-11-arm` runner and Playwright Electron smoke tests.
- Introduce a small runtime installer wrapper for Windows ARM64 that calls `tiny-runtime-injector` per runtime and treats failures as skipped optional artifacts.
- Provide a CI-specific E2E mode that starts a local OpenAI-compatible mock server, injects a provider/model through existing typed routes, completes onboarding, and runs the existing smoke specs against the runner profile.

## E2E Data Flow

1. The Playwright fixture starts a local mock provider when `DEEPCHAT_E2E_USE_MOCK_PROVIDER=1`.
2. The fixture launches DeepChat with the default Electron `userData` path for the current runner/user.
3. The renderer bridge invokes `providers.add/update`, `models.addCustom`, `models.setStatus`, `config.updateEntries`, and `onboarding.complete`.
4. Existing smoke specs select the configured provider/model from environment-driven test data.

## Runtime Behavior

- `installRuntime:win:arm64` uses best-effort mode and writes a JSON summary under `build/`.
- Existing runtime consumers continue to detect missing bundled binaries and fall back to system/runtime-unavailable behavior.
- CI uploads the runtime summary so missing artifacts are visible during review.

## Validation

- Unit tests cover best-effort runtime install summaries and missing bundled runtime fallback.
- Existing RTK fallback coverage remains in place.
- Skill runtime tests cover the no-UV/no-system-Python auto-runtime failure path.
- The new manual workflow validates Windows ARM64 build, plugin bundle, app launch, chat, persistence, and settings navigation.
