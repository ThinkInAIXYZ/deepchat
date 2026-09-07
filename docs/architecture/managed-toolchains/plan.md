# Managed Toolchains Plan

Normative design: `spec.md`. This file tracks ordered, independently reviewable
slices. After each slice the app remains usable.

## 1. Resolver and explicit sources

Introduce `ToolchainService` as the only Node/uv resolver. Persist
`{userData}/toolchains/state.json`. Run the one-time first-run migration.
Rewrite MCP / ACP / Skill / OCR through the service. Keep RTK on
`RuntimeHelper`.

Delete `bunRuntimePath` and dead `useBuiltinRuntime` i18n.

OCR handshake expected version becomes the resolved official Node version, not
a permanently baked `runtime-versions.json` comparison.

Completion: consumers no longer invent a second PATH chain; existing complete
bundled trees keep working via migrated `bundled`.

## 2. Downloader, catalog, and pack-time completeness

Add the one-pin Node catalog, official-distro downloader (sha256, resume,
single-flight, proxy-aware probe), managed activate, Repair, and Revert.
Verify npm/npx/corepack at pack time for any Node seed that still ships.
uv managed override can land here; bundled uv remains the default.

Completion: a user can install the official pin into `userData` without a
Settings page, via routes/tests.

## 3. Settings UI and missing-runtime banner

Settings → Toolchains. Source picker, system-binary highlight, install
progress, Repair / Revert. Auto-connect missing runtime uses one aggregated
banner. Three-way picker only on user-initiated paths.

Completion: source changes are user-visible and persist; Bun stays hidden.

## 4. CLI Electron host

`deepchat.mjs` is hosted by packaged Electron with `ELECTRON_RUN_AS_NODE=1`.
Launcher and `build-cli.mjs` stop requiring `runtime/node`. Next GUI launch
still refreshes the launcher.

Completion: CLI runs with no official Node on disk.

## 5. Stop shipping Node

Remove Node from `install-runtime.mjs` / pack extraResources. Keep uv + RTK.
Upgrade users whose source is `bundled` see `missing` and the banner; no
auto-switch. Point Windows OCR smoke firewall at the resolved official Node.
Update README / size baseline. Product call: OCR is not offline-guaranteed
on a clean install until the user installs the pin or picks a compatible
system Node.

Completion: installer contains no Node/npm/npx/corepack.

## 6. Review, validation, cleanup

Whole-change review against the spec. Keep durable tests for migration,
resolve-never-switches, completeness, atomic activate, OCR purpose
constraint, and download recovery. Remove temporary probes.

Quality gates: `pnpm run format`, `pnpm run i18n`, `pnpm run lint`,
`pnpm run typecheck`, plus the smallest relevant Vitest suites.

## Validation selection

Implementation-first. After slice 1, add contract tests for migration,
resolve, completeness, and rewrite. After slice 2, add activate / interrupted
download tests. UI and packaging slices rely on existing i18n/lint/typecheck
plus a small status-route test.

Do not add implementation-coupled mocks that restate private control flow.

## GitHub issue sync

Not requested. Mention #2153 and the uv-seed deviation when a PR is opened.
