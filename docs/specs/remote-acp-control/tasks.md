# Remote ACP Control Tasks

## Readiness

- No open clarification items remain.
- All tasks below map back to the acceptance criteria in [spec.md](./spec.md).

## T0 Spec Artifacts

- [x] Create `spec.md`, `plan.md`, and `tasks.md`
- Owner: Remote control maintainer
- Acceptance Criteria:
  - The ACP remote-control scope, compatibility, and non-goals are documented.
  - Reviewers can trace implementation decisions without reading every changed file.

## T1 Remote Config And Type Support

- [x] Add `defaultWorkdir` to Telegram and Feishu remote settings/runtime types
- [x] Normalize and persist `defaultWorkdir` through `RemoteControlPresenter`
- [x] Allow enabled ACP agents to survive remote default-agent sanitization
- Owner: Electron main
- Acceptance Criteria:
  - Settings load without migrations.
  - ACP is selectable as a valid default remote agent.

## T2 ACP Session Creation

- [x] Detect ACP default agents during remote session creation
- [x] Resolve ACP workdir from channel config or global default project path
- [x] Create detached ACP sessions with `providerId`, `modelId`, and `projectDir`
- [x] Reject ACP session creation when no workdir is configured
- Owner: Electron main
- Acceptance Criteria:
  - New ACP remote sessions are created with the expected runtime fields.
  - Missing workdir produces the documented error.

## T3 Remote Command Behavior

- [x] Keep `/sessions` agent scoping based on the bound session or default agent
- [x] Add ACP model-lock handling to `/model`
- [x] Add default/current workdir lines to `/status`
- Owner: Remote routers
- Acceptance Criteria:
  - ACP sessions do not open model-selection flows.
  - `/status` exposes enough context to debug remote workspace selection.

## T4 Settings UI And i18n

- [x] Show all enabled agents in the default-agent selector
- [x] Label ACP agents with ` (ACP)`
- [x] Add Telegram and Feishu default-directory inputs
- [x] Add i18n strings for the new settings fields
- Owner: Renderer settings
- Acceptance Criteria:
  - Users can configure ACP defaults from the existing Remote settings page.
  - The UI still behaves correctly for legacy settings payloads.

## T5 Tests And Validation

- [x] Add main-process tests for ACP sanitization, workdir fallback, and ACP session creation
- [x] Add router tests for ACP `/model` locking and `/status` output
- [x] Add renderer tests for ACP agent visibility and default-workdir persistence
- [x] Run targeted main and renderer Vitest suites
- Owner: QA + Remote control maintainer
- Acceptance Criteria:
  - Test coverage maps to the new ACP remote-control behavior.
  - DeepChat regression paths remain green in the targeted suites.
