# CUA Cross-Platform Computer Use Spec

## Status

Implemented for driver 0.14.1 with the supervised embedded lifecycle and model-facing argument and
result compatibility adapter. Native Windows/Linux behavior, release-signed macOS behavior, and
preinstalled custom cursor themes remain release-gated.

The maintained runtime and process-ownership contract now lives in
`docs/architecture/plugin-external-runtime-lifecycle/`. Where this historical feature document
conflicts with that architecture specification, the architecture specification is authoritative.

## Background

DeepChat currently ships the CUA computer-use capability as an official plugin under
`plugins/cua`. The integration is DeepChat-managed: the plugin declares a skill and a bundled
tool server that DeepChat starts internally. Users do not configure an external MCP server, install
the CUA driver manually, or rely on PATH for the bundled experience.

The original implementation was macOS-only:

- `plugins/cua/plugin.json` limited `engines.platforms` to `darwin`.
- The runtime build script built the older Swift driver from the vendored CUA fork.
- The package script special-cased only `runtime/darwin/<arch>`.
- Build and release workflows only included the CUA plugin in macOS artifacts.
- Skill docs, runtime permission wording, tests, and packaging docs assumed macOS.

The completed 0.7.1 rollout expanded that distribution to the five supported targets. The current
work changes the lifecycle and runtime version without collapsing the application and optional
plugin build matrices.

Upstream `trycua/cua` now publishes the Rust CUA driver as cross-platform release artifacts. The
previously shipped driver was `cua-driver-rs-v0.7.1`. Issue #2039 demonstrated that retaining its
eager Linux/X11 startup is unsafe. The current integration pins `cua-driver-rs-v0.14.1` and adds a
DeepChat-owned embedded lifecycle adapter, static tool discovery, crash quarantine, controlled
environment inheritance, and pre-spawn integrity checks.

- macOS arm64 and x86_64, plus universal variants.
- Windows x86_64 and arm64.
- Linux x86_64.

Linux arm64 remains unsupported for this DeepChat integration until it passes the same native
packaging and desktop-session gates as the existing targets. Upstream asset availability alone
does not expand DeepChat support.

## Goal

Keep the official DeepChat CUA plugin cross-platform while upgrading its runtime safely and making
DeepChat the single owner of the bundled external process lifecycle.

## Non-Goals

- Do not switch DeepChat to user-managed MCP configuration for CUA.
- Do not require PATH-installed `cua-driver` for the bundled plugin.
- Do not run upstream install or uninstall scripts at app runtime.
- Do not introduce auto-start services, scheduled tasks, or package-manager installation from
  inside DeepChat.
- Do not claim Linux arm64 CUA support until that target is explicitly validated for DeepChat
  packaging.
- Do not change the global tool permission model.

## Platform Scope

The implementation must support these packaged plugin targets:

| DeepChat platform | DeepChat arch | Upstream asset status | Required behavior |
| --- | --- | --- | --- |
| `darwin` | `arm64` | Available | Bundle and verify CUA runtime |
| `darwin` | `x64` | Available | Bundle and verify CUA runtime |
| `win32` | `x64` | Available | Bundle and verify CUA runtime |
| `win32` | `arm64` | Available | Bundle and verify CUA runtime |
| `linux` | `x64` | Available | Bundle and verify CUA runtime |
| `linux` | `arm64` | Unsupported for DeepChat | Do not bundle or show CUA; fail clearly if requested directly |

## Visibility Scope

CUA support is target-based, not only platform-based. The plugin must be visible only for these
runtime targets:

- `darwin/arm64`
- `darwin/x64`
- `win32/x64`
- `win32/arm64`
- `linux/x64`

The plugin must not be visible as an official usable plugin on:

- `linux/arm64`

If the current plugin manifest can only express platform support, implementation must add an
arch-aware gate through manifest metadata, official-plugin discovery, or runtime support checks.
`engines.platforms` alone is not sufficient for CUA because Linux arm64 must stay hidden even though
the operating system is otherwise in scope.

## Integration Contract

DeepChat must continue to own the integration boundary:

- The official plugin manifest or discovery layer declares the supported platform/arch targets and
  bundled runtime candidates.
- The driver binary is started by DeepChat's plugin host through the existing plugin tool server
  path.
- The user-facing capability remains "skill + built-in tool surface" inside DeepChat.
- The implementation may keep the internal stdio server transport, but it must not require users
  to configure or install an external MCP server.
- Runtime detection must prefer plugin-local binaries and only use external fallback candidates for
  diagnostics or development.

## Upstream Runtime Contract

The replacement runtime is pinned to:

- Tag: `cua-driver-rs-v0.14.1`.
- Commit: `41ae29b44b49b68c6e01c934fffbbe74d22e26fb`.
- Version: `0.14.1`.

The build step must stage release artifacts instead of relying on local Swift-only source builds.
Every staged asset must be validated before packaging:

- Download the expected release archive for the target platform and arch.
- Verify it against the upstream `checksums.txt` asset.
- Validate required files exist after extraction.
- Normalize executable permissions on POSIX targets.
- Validate the driver can be executed for a low-risk command such as `--version` when the host
  platform and runtime loader can run the target binary.
- Keep macOS signing and helper-app validation in place where a `.app` bundle is staged.

## Runtime Layout

The packaged plugin should stage only the target runtime needed by the artifact being built:

```text
plugins/cua/runtime/
  darwin/
    arm64/
      DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver
    x64/
      DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver
  win32/
    x64/
      cua-driver.exe
    arm64/
      cua-driver.exe
  linux/
    x64/
      cua-driver
```

The macOS app directory is `DeepChat Computer Use.app` and the executable is
`deepchat-cua-driver`, so packaged DeepChat does not collide with upstream `CuaDriver.app` while
still consuming verified upstream release artifacts.

## Tool Surface

The plugin policy, skill docs, and packaged static catalog must exactly match the pinned upstream
0.14.1 tool surface. The catalog keeps CUA tools discoverable without eagerly starting the native
runtime.

Removed or renamed assumptions:

- Do not expose `screenshot` as the primary capture tool. Upstream uses `get_window_state` with a
  vision capture mode.
- Do not rely on `set_recording`. Recording is split into `start_recording`,
  `stop_recording`, `get_recording_state`, `replay_trajectory`, and `install_ffmpeg`.

Core tools expected across supported platforms include:

- App and window discovery: `list_apps`, `list_windows`, `get_window_state`,
  `get_accessibility_tree`.
- App and window actions: `launch_app`, `kill_app`, `bring_to_front`.
- Input actions: `click`, `double_click`, `right_click`, `drag`, `scroll`, `type_text`,
  `press_key`, `hotkey`, `set_value`.
- Cursor tools: `get_screen_size`, `get_cursor_position`, `move_cursor`,
  `set_agent_cursor_enabled`, `set_agent_cursor_motion`, `set_agent_cursor_theme`,
  `get_agent_cursor_state`.
- Configuration and permissions: `check_permissions`, `get_config`, `set_config`,
  `check_for_update`.
- Session and recording lifecycle: `start_session`, `end_session`, `start_recording`,
  `stop_recording`, `get_recording_state`, `replay_trajectory`, `install_ffmpeg`.

Platform-specific tools may exist, such as Linux mouse-button primitives and Windows diagnostic
tools. Policies must classify these explicitly instead of leaving them to default approval rules.

The maintained model-facing adapter contract is:

- remove only empty optional `element_token` values from the seven CUA tools that accept them;
- preserve non-empty opaque tokens, including the current eight-hex-digit representation, valid
  zero coordinates, and every unrelated falsy value;
- preserve raw MCP `structuredContent` while projecting the latest snapshot/token mapping compactly
  beside the existing accessibility tree;
- project a bounded `structuredContent.refusal.code` into model-visible content without duplicating
  the human-readable refusal message;
- project the exact reviewed browser-chrome capture-coverage recovery contract using fixed,
  bounded identifiers, without treating the coverage limit as proof that a prompt is present;
- re-snapshot and retry once with a new token when the projected code is `stale_element_token`,
  `generation_mismatch`, or `invalid_element_token`;
- never retry a failed token against an older snapshot's `element_index`;
- send screenshots for bounded visual grounding only when the caller explicitly passes
  `include_screenshot: true`; routine AX re-indexing uses `include_screenshot: false`;
- treat screen text and derived visual grounding as untrusted observations rather than
  instructions.

The 0.14.1 model-facing contract also requires:

- `browser_type({ replace: true, text: "" })` clears an editable field; append-only examples must
  not hide the `replace` behavior;
- agent-cursor state and mutations use a stable `session`; `set_agent_cursor_motion` controls only
  motion, while appearance is selected through `set_agent_cursor_theme`;
- normal `start_session` calls omit `cursor_theme`; the reviewed `set_agent_cursor_theme` tool is
  used only for an explicit user request;
- `get_agent_cursor_state` is consumed as a single-session state object with `enabled`, `motion`,
  `position`, `session`, `theme`, and `visual_state`, not the removed `cursors` array.
- cursor themes use the v2 action-only profile; delivery and target context belong to session
  badges, and retired v1 theme artifacts are not accepted as compatible.

## Permission and Safety Requirements

Tool policies must be exact and conservative:

- Read-only discovery and status tools may be allowed automatically.
- User-visible input, app launch, usable app-termination paths, window focus, recording, replay,
  config mutation, and dependency installation must require user approval.
- `kill_app` is explicitly denied for 0.14.1. Its public schema omits `session`, so standard mode
  cannot prove ownership even though the shared ownership implementation works when a session is
  supplied. DeepChat must use cooperative close paths and must not inject an undocumented field.
- Any newly detected upstream tool without a policy must be treated as a review failure in tests.

Platform permission behavior must be explicit:

- macOS keeps accessibility and screen-capture permission checks and helper-app permission UX.
- Windows must not show macOS TCC-specific instructions.
- Linux must communicate pre-release constraints and compositor/session limitations without
  blocking supported tool startup when the driver reports usable status.

## Packaging Requirements

The packaged app must keep CUA usable after Electron packaging:

- The `.dcplugin` artifact must contain the correct runtime subtree for its platform and arch.
- The packaged `.dcplugin` manifest must narrow `engines.targets` to the artifact's own
  platform/arch target, even though the source manifest keeps the full supported target matrix.
- Runtime files must stay outside `app.asar`.
- Windows artifacts must contain only `cua-driver.exe`; DeepChat does not ship the optional unsigned
  UIAccess worker.
- Linux runtime files must retain executable permissions after package extraction.
- macOS helper bundles must exclude the upstream authoring-only `cua-cursor-theme` sidecar and pass
  bundle path, executable, and signing validation.
- DeepChat does not package or upgrade the optional GNOME Wayland helper; fresh and pre-existing
  manually installed helper states are separate native release gates.
- `plugin:verify` must be able to verify CUA artifacts per supported platform and arch.
- CI and release workflows must bundle and verify CUA for supported Windows, macOS, and Linux
  build targets.

## Acceptance Criteria

- Official CUA plugin metadata or discovery logic allows only the supported target matrix:
  `darwin/arm64`, `darwin/x64`, `win32/x64`, `win32/arm64`, and `linux/x64`.
- Each target-specific CUA `.dcplugin` advertises only its own `engines.targets` entry, so
  side-by-side artifacts cannot be selected on the wrong CPU architecture.
- Packaged macOS, Windows, and Linux x64 builds include a CUA `.dcplugin` artifact.
- Packaged Windows arm64 builds include a CUA `.dcplugin` artifact.
- Packaged Linux arm64 builds do not include a visible or usable CUA plugin.
- Direct CUA runtime packaging for Linux arm64 fails with a clear unsupported-target message.
- Official plugin visibility is gated by platform and arch, so the unsupported Linux arm target does
  not show CUA as available.
- Unsupported sibling artifacts for the same plugin id are ignored during discovery without
  disabling or uninstalling an installed artifact that supports the current target.
- The settings sidebar and settings routes expose the Plugins entry on supported CUA targets, not
  only on macOS, while keeping unsupported CUA targets hidden.
- Runtime detection resolves the plugin-local binary on every supported target.
- The plugin starts on the first tool call through DeepChat's supervised embedded adapter without
  user-managed MCP setup.
- A valid `element_index` remains usable when a provider also emits an empty `element_token`, while
  a non-empty token from the latest snapshot is preserved and preferred.
- `get_window_state` makes its structured token mapping available to the model without duplicating
  the complete structured tree, and stale tokens lead to a fresh snapshot before retry.
- Explicit screenshot requests produce bounded vision grounding or a clear unavailable result;
  routine tree-only refreshes do not send image data to a model.
- Optional MCP capabilities not implemented by the CUA driver, such as prompts and resources, are
  treated as absent capabilities and must not produce error-level log spam.
- Skill docs describe DeepChat usage and platform caveats, not upstream manual installer workflows.
- Tool policies and the static catalog exactly cover the pinned upstream 0.14.1 tools.
- Packaging docs and tests no longer describe CUA as macOS-only.
- Build, lint, i18n, and focused test suites pass after implementation.

## Risks

- Upstream release archive layouts may change. The staging script must validate layout and fail
  closed.
- Cross-compiling the Rust driver locally is higher risk than consuming verified release assets.
  The first implementation should prefer release assets.
- macOS helper-app rename or re-signing can break permissions. The implementation must verify the
  staged bundle after any mutation.
- Linux support is upstream pre-release. DeepChat should support the available asset while keeping
  limitations visible and testable.
- Tool names changed from the Swift-era integration. Missing policy updates could silently approve
  or block the wrong tools.
