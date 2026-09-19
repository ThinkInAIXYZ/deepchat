# DeepChat Monorepo Migration

## Status

Normative RFC for repository structure. Revised 2026-09-18 on branch
`architecture/standalone-agent-harness`, design baseline `e002d4261`. Implementation is in progress;
current execution evidence and remaining gates are recorded in [plan.md](./plan.md).

The [standalone spec](../standalone-agent-harness/spec.md) stays normative for runtime ownership,
security, capabilities, and compatibility, and its [plan](../standalone-agent-harness/plan.md) stays
the only tracker for Stage 0–7 behavior acceptance. This document owns repository structure and
package boundaries only; closing a structural milestone never closes a standalone stage.

## 1. Context

`@deepchat/agent-kernel` already exists as a private workspace package, but the repository is still
shaped as a single Electron app with a package bolted on:

- The app owns the repository root: root `package.json` is `name: DeepChat`, and root build, test,
  lint, and CI configuration mix repository-wide concerns with app-owned concerns.
- Desktop reaches the kernel through 175 re-export shim files under `src/main`, so the real import
  surface is invisible and the package boundary is unenforced.
- 69 of the kernel's source files are physically copied from `src/shared` and kept honest by a
  fidelity script rather than by a shared owner.
- Kernel resolution is inconsistent per toolchain: Vite and Vitest alias `@deepchat/agent-kernel` to
  the package source, while `tsc` falls back to the package `exports` and consumes `dist`.

The standalone agent service needs a service host that does not depend on Desktop. That host cannot
be assembled while portable code has no package it can belong to.

## 2. Goals and non-goals

Goals:

- One owner per module, enforced by package manifests and `exports` rather than by aliases.
- A Desktop package that is a normal workspace member, not the repository root.
- A shared contract package that Node hosts, Desktop main, preload, and renderer can all consume.
- A CLI package that can grow a service host without importing Desktop source.
- Portable domain cores extractable one at a time, each with a verified dependency closure.

Non-goals:

- No Turbo, Nx, generic plugin registry, build-system replacement, declaration bundler, or
  speculative packages. pnpm workspaces plus the current per-package build recipe are sufficient.
- No `apps/*` hierarchy. Everything lives under `packages/*`.
- No product, schema, credential format, CLI protocol, approval policy, or UI change.
- No npm publication promise. Every package stays private.

## 3. Target layout

```text
BEFORE                                  AFTER
root package = DeepChat                 root package = private workspace
|-- src/{main,preload,renderer,         |-- packages/
|         cli,shared}                   |   |-- desktop/       (name: DeepChat)
|-- test/                               |   |   |-- src/ test/ resources/ build/
|-- resources/ runtime/ build/          |   |   `-- electron.vite.config.ts, builder yml
|-- scripts/                            |   |-- cli/           (@deepchat/cli)
`-- packages/agent-kernel/              |   |-- agent-kernel/  (unchanged name)
                                        |   `-- shared/        (@deepchat/shared)
                                        |-- scripts/           (repo-wide tools)
                                        `-- docs/ .github/     (repo-wide)
```

Domain packages from the portable-extraction phase join `packages/*` only when an accepted host
capability needs them.

## 4. Package ownership

| Concern | Owner and rule |
| --- | --- |
| Root manifest | Private workspace: toolchain, repo-wide dev tools, orchestration scripts. No application runtime dependencies; keep dependencies that root scripts genuinely use. |
| pnpm settings | Root only: lockfile, overrides, supported architectures, hoisting, lifecycle policy. pnpm resolves overrides from the workspace root, so they cannot move into Desktop regardless of which app uses the dependency. See [pnpm 10.x overrides](https://pnpm.io/10.x/settings#overrides). |
| Desktop manifest | Keeps `name: DeepChat`, app version, `main`, product metadata, runtime and optional dependencies, and Electron build tooling. Renaming it would change `${name}`-derived installer output; internal scoped renaming is not needed for a monorepo layout. |
| Library manifests | Private `@deepchat/*` with explicit runtime and declaration dependencies, `workspace:*` for local edges, and narrow `exports` into `dist`. No library imports Desktop or CLI implementation. |
| CLI manifest | Private `@deepchat/cli`. Bundled `--version` reads the Desktop release version through an explicit build input, not an incidental root manifest read. Independent CLI versioning is deferred to its release stage. |
| Root tooling | Repository-wide formatting, lint, commit hooks, CI and release orchestration, architecture baselines, and package guards stay at root. Rebase their source globs; never narrow a repo-wide check to Desktop and silently drop new packages. |
| Desktop assets | App resources, runtime assets, plugin sources and bundles, native packaging and signing hooks, icon/provider/ACP generators, i18n, and app-local build scripts. Registry refreshes produced by normal builds keep working. |
| Tests | Desktop runtime, renderer, e2e, and host–kernel integration stay Desktop-owned. The kernel artifact gate moves to the kernel package. Shared contract tests move with shared when portable; host structural-port tests stay with the host. Root commands aggregate every suite. |
| Documentation | Normative specs and architecture baselines stay root-owned. Update active path and command guidance at the milestone that invalidates it; keep historical evidence labeled historical. |

## 5. Dependency and build contracts

```text
desktop ------------------> kernel ------> shared
desktop -------------------------------> shared
desktop packaging --------> cli artifact -> shared
cli service host ---------> kernel + accepted domain cores
host adapters ------------> domain ports + permitted native dependencies

Forbidden: shared -> kernel/domain/app;  kernel -> host/transport;
           library -> desktop/cli;       any cross-package ../../src import.
```

- `shared` is a reviewed neutral contract and value-module closure, not all of `src/shared`. Browser
  and renderer entrypoints must not transitively pull Node-only modules or Electron. Prefer narrow
  subpath exports over an eagerly evaluated aggregate barrel.
- Desktop-local `@shared/*` may remain for UI-only code. Every promoted symbol has exactly one source
  owner. Temporary type re-exports are allowed; copied value implementations are not.
- Source aliases may stay for fast development, but every real cross-package import must also resolve
  through `exports`. An alias must never make package internals publicly importable.
- Every alias and config path must resolve relative to its config file, not the caller's cwd. This is
  the single largest relocation hazard: `electron.vite.config.ts`, `vitest.config.ts`, and
  `electron-builder.yml` all currently depend on being invoked from the repository root.
- Artifact builds have an explicit topological order: shared, then kernel and other consumers, then
  CLI and host artifacts. A root aggregate must not recurse into itself or race two writers on one
  package's `dist`.
- Both consumption paths must be proven: source development from a clean output state, and normal
  Node plus declaration consumption with no aliases and no repository `node_modules`.
- Forbidden-import rules are package-specific. SQLite and PTY stay forbidden in kernel and shared
  cores, but may be explicitly allowed in a reviewed host storage or tool adapter.

## 6. Invariants for the structural phase

Relocation milestones may change import resolution, build configuration, emitted declarations, and
shared module identity. Those changes need acceptance; they are not automatically semantics-free.
They must not change:

- observable Desktop and CLI behavior, app identity, installer output names, or product version;
- user data: schema, migrations, profile layout, credential storage format, or encryption keys;
- the CLI wire protocol, approval policy, or which process owns the agent service;
- installed artifact paths, including `app.asar.unpacked/{cli,runtime,resources,plugins}` and macOS
  helper placement. Source paths may move; installed paths must stay compatible.

Credential handling has one further rule. The existing Codex `file` fallback in
`src/main/provider/auth/openaiCodex/credentialStore.ts` writes plaintext tokens when encryption is
unavailable. It is pre-existing behavior under separate review, not a template: no new host may add a
plaintext fallback, a silent empty profile, or a Desktop keepalive to make a headless path succeed.

## 7. Checked baseline (2026-09-18, `e002d4261`)

Recorded as review snapshots, not acceptance criteria. Recompute after upstream integration.

- `packages/*` is already declared in `pnpm-workspace.yaml` and currently contains exactly one
  package: `@deepchat/agent-kernel`, private, with 11 export subpaths pointing into `dist`.
- The kernel has 246 TypeScript source files. `src/main` has 175 files that re-export from
  `@deepchat/agent-kernel`.
- The fidelity script reports 66 faithful copies, 3 exemptions, and 141 `src/shared` files that were
  never copied. The kernel closure is therefore 69 files out of roughly 210 in `src/shared`; it is
  not a mandate to promote all of `src/shared`. The exemptions are `chat.ts`, `types/tool.ts`, and
  `types/agent-interface.ts`.
- Kernel resolution differs per toolchain. `electron.vite.config.ts` and `vitest.config.ts` alias the
  kernel to `packages/agent-kernel/src`. In `tsconfig.node.json`, both the root entry and wildcard
  mapping target `../packages/agent-kernel/src`, outside the repository. With no source there, `tsc`
  falls back to the package `exports` and requires a built `dist`.
  Verified in an isolated tracked-source fixture with existing third-party dependencies, its own
  kernel link, no kernel `dist`, and incremental caching disabled: the original mapping produces
  `TS2307` errors; correcting both targets to `./packages/agent-kernel/src` passes with zero errors
  and no kernel build. This verifies source resolution, not a fresh dependency install. The renderer
  does not import the kernel, so its typecheck does not exercise this mapping.
- Stage 2B is closed in the standalone tracker, but no independent service host exists. The current
  CLI is a local-control client launched with `ELECTRON_RUN_AS_NODE` and requires Desktop.
- Counting direct Electron imports does not prove portability. Type references, transitive
  dependencies, module initialization, persistence, resources, and credential ownership all count.
- Toolchain: Node `v24.18.0`, pnpm `10.34.5`, TypeScript native bridge. Keep the current engine range
  and per-file JS and declaration emit.

## 8. Decisions

| Decision | Resolution |
| --- | --- |
| Kernel source-vs-artifact contract | Development and typecheck consume package source through config-relative mappings; artifact consumption is proven separately by the package gate. Fix the broken `tsconfig.node.json` mapping rather than adding a build-before-typecheck bootstrap. |
| Milestone order | Debt cleanup precedes relocation: remove shims and extract shared while the tree is still at the root, then relocate a smaller Desktop once. A disposable child-package build spike runs first so the relocation risk is still discovered early. |
| `ollama` dependency | Stays an install-time dependency of whichever package's emitted declarations reference `ShowResponse`. Accepted M2 assigns those declarations to `packages/shared/src/types/provider.ts`; `ollama` is a shared runtime dependency, not a dev dependency. |
| Desktop package name | Stays `DeepChat`. |
| Schema ownership | The composition owner assembles the full schema and migration catalog. `src/main/data/schemaCatalog.ts` imports session, agent, project, tape, memory, app, settings, provider, MCP, scheduler, and orchestration tables, so no single domain package can own the database lifecycle. |
| Packaging classification | `scripts/ci/classify-package-impact.mjs` keeps returning platform packaging decisions only. Relocation does not introduce an affected-test scheduler. |

Resolved during implementation: Desktop owns `out/{main,preload,renderer,cli}` and Builder `dist`;
native resolution starts from the owning importer rather than scanning an unrelated root store.
Accepted M2 promotes 127 exact shared subpaths: the 69-file kernel closure plus 58 CLI/event contract
transitives. The manifest is the export inventory and source-alias authority. All promoted modules
are browser-safe; direct third-party edges are `zod` schemas, `tokenx` token estimation, and type-only
`ollama.ShowResponse`. Shared `chat` contains only `MessageFile`; the legacy host barrel type-reexports
it. Host-only UI contracts remain Desktop-owned. M5c needs only an injected complete synchronous
transaction capability; no generic persistence package is justified by the present consumers.

Still open at the stage that needs them: supported-platform native runtime proof after final
integration; headless credential and OAuth support per OS/profile class; and independent CLI
distribution. These structural decisions do not waive the standalone host gates.

## 9. Acceptance criteria

- Root and filtered commands select the same configuration, resources, and outputs, and every
  repository-wide check still covers every package.
- No production import resolves through a deleted shim, and every production subpath is backed by a
  declared export.
- No duplicate value implementation, no undeclared public type dependency, and no dependency cycle.
- Each library's runtime and declaration imports resolve from an isolated consumer using only its own
  staged artifacts and declared dependencies, without workspace hoisting or repository aliases.
- Packaging, install, and release paths preserve artifact naming, checksum generation and validation,
  and installed layout on every supported platform and architecture. Checksums must match the new
  artifacts; byte-identical rebuilds of the baseline are not required.
- A package may be portable-core complete while host-complete is still blocked. Standalone success is
  claimed only by the standalone tracker's own gates.
