# DeepChat Monorepo Migration Plan

Execution tracker for [spec.md](./spec.md). Nothing below is implemented; this document does not
authorize commits, merging, or release publication. Design rationale, ownership rules, dependency
contracts, and the checked baseline live in the spec and are not repeated here.

Each milestone may land as several small reviewable commits, but it closes only when its exit
conditions pass. Keep relocation and import rewrites separate from behavior changes; a broken
intermediate commit is not an accepted milestone. Suggested commit subjects are suggestions, not
authorization.

## Order

```text
M0 baseline + child-package build spike
 -> M1 remove kernel re-export shims        (tree still at repository root)
 -> M2 extract @deepchat/shared             (tree still at repository root)
 -> M3 relocate Desktop into packages/desktop + CI/install/release
 -> M4 packages/cli
 -> M5a provider core --+
    M5b MCP core ------+--> Stage 3 host slices in packages/cli
    M5c persistence ---+
    M5d further domains as needed
 -> standalone Stages 4-7, under their own tracker
```

Debt cleanup runs before relocation on purpose. Deleting 175 shims and extracting shared first means
the relocation moves a smaller tree, and a boundary failure in M1/M2 is unambiguous because the build
and CI setup is still the known-good one. The M0 spike keeps the child-package build risk early.

## M0 — Baseline and child-package build spike

- [ ] Refresh `origin/dev`, PR state, and CI, then integrate upstream into this branch before any mass
      rename. The reason is conflict volume, not impossibility.
- [ ] Record source SHA, toolchain, lockfile state, and current failures. Re-run the shared-copy and
      shim inventories; capture baseline test discovery and the artifact/resource manifests.
- [ ] Fix the kernel path mapping in `tsconfig.node.json` so it resolves inside the repository, and
      confirm a clean checkout typechecks with no prebuilt kernel `dist`. Align Vite, Vitest, and
      `tsc` on one source-consumption contract; keep artifact consumption proven by the package gate.
- [ ] Spike electron-vite and electron-builder from a child package in a disposable worktree. Record
      app root, output roots, native dependency resolution, and root-versus-filtered command
      equivalence. Do not move anything in this milestone.

**Exit:** a reproducible baseline or an explicit blocker, plus a recorded path contract from the
spike. A previously reported green commit is not a baseline.

## M1 — Remove kernel re-export shims

Suggested boundary: `refactor(agent): remove kernel re-export shims`.

- [ ] Recompute the shim list, including relative imports and mixed barrels. Distinguish pure
      re-export shims from host harness and composition implementations, which stay.
- [ ] Rewrite production callers to supported kernel subpath exports, then delete only confirmed
      shims. Add the export subpaths the callers actually need; do not add a production alias that
      papers over a missing export.
- [ ] Keep test-only legacy aliases only where `vi.mock` module identity requires them, and confirm
      old and new specifiers resolve to the same source module. Record each surviving alias as
      transitional debt with the condition that retires it.
- [ ] Audit tests compiled outside Vitest, direct source reads, and guard fixtures. Aliases do not fix
      code that inspects files through `process.cwd()`, and "zero test edits" is not a goal.

**Exit:** common checks; no production import resolves through a deleted shim; type and structural
gates plus the full existing suites pass. Update baseline scanners rather than regenerating baselines
to normalize an ownership regression.

## M2 — Extract `@deepchat/shared`

Suggested boundary: `refactor(shared): extract shared package`.

- [ ] Record a compact export inventory first: source, consumers, value-versus-type, browser or Node
      requirement, transitive dependencies, and target subpath. Start from the 69-file kernel closure
      plus the contracts CLI needs, and expand only for real consumers.
- [ ] Resolve `types/tool` and `types/agent-interface` into checked `.ts` sources that preserve the
      public shapes and migrate their real transitive closure. Do not copy an unchecked host barrel.
- [ ] For `chat`, extract only the shared `MessageFile` declaration into one checked neutral source
      consumed by both the host barrel and the kernel. Converting the whole legacy chat barrel is not
      required. Unify further declarations only after their missing names have real owners; never
      substitute `any` or `unknown` to compile.
- [ ] Move promoted modules into `@deepchat/shared` with narrow exports and explicit dependencies, and
      rewire every consumer including preload and renderer configs. Delete the kernel copies and the
      host value duplicates, not merely the kernel-side imports.
- [ ] Move `ollama` to shared `dependencies` while shared declarations expose `ShowResponse`; drop it
      from the kernel only once no kernel-owned declaration imports it directly. The kernel declares
      shared as a workspace dependency, with no manual exception in the declaration dependency gate.
- [ ] Prove a single module instance within each consuming JS realm or bundle, especially for logger
      flags, errors, and schemas. Cross-process singleton identity is not promised. Check packaged
      embedding, not just matching TypeScript shapes.
- [ ] Replace the gate's hardcoded single-artifact install with a manifest-derived workspace closure:
      build dependency-first, stage only declared files and exports, and map internal dependencies to
      local artifacts in an isolated temporary fixture. Tarball verification must supply every private
      workspace dependency explicitly; packing does not make one registry-resolvable.
- [ ] Validate each staged package against its own manifest: runtime and declaration imports resolve
      from its declared dependencies, exports, and relative files. Match subpaths properly instead of
      exact names, and reject undeclared, Desktop-source, and forbidden native or Electron edges. Do
      not inject an undeclared dependency into the consumer to make it pass.
- [ ] Retire the fidelity script and its Vitest bridge in the same slice that lands the replacement
      checks, and only after every duplicate value owner is gone. Preserve the two-round runtime
      scenario, forbidden-import interception including swallowed failures, external declaration
      compilation, and temp cleanup.
- [ ] Wire shared checks and any moved tests into root and CI commands in this milestone. Ensure
      shared changes conservatively trigger Desktop packaging; do not defer new-package coverage to
      the M3 relocation and classifier rewrite.

**Exit:** common checks; the shared browser entry and Node exports both resolve; the isolated
shared-plus-kernel artifact closure works with no repository aliases and no root `node_modules`; the
existing host port and contract type gates still compile their real sources. A duplicate value owner
or an undeclared public type dependency blocks this milestone. Do not weaken a check to preserve a
cosmetic test count.

## M3 — Relocate Desktop into `packages/desktop`

Suggested boundary: `chore(repo): move desktop into workspace`.

- [ ] Move app-owned files with rename-preserving edits, applying the path contract recorded in M0.
      Keep root tooling and configuration per the spec's ownership table.
- [ ] Split manifests without changing dependency versions or effective pnpm policy. Move the app
      `postinstall` to Desktop with an explicit app cwd; root keeps toolchain enforcement.
- [ ] Preserve root command names through explicit forwarding, such as
      `pnpm --filter DeepChat run dev`. Repository checks stay repository-wide, and `test:main` must
      still include the kernel gate.
- [ ] Move the kernel gate and its fixtures to `packages/agent-kernel/test/` with a package-local
      Vitest entrypoint; rebase its repo-root, build-script, and temp-consumer paths, and do not
      inherit the Desktop fs and path mocks. Update root aggregate discovery and coverage exclusions.
- [ ] Rebase every TS, Vite, and Vitest alias, the memory and eval test configs, fixture paths,
      generators, source guards, architecture-baseline scanners, ignore globs, contributor commands,
      and runtime locators.
- [ ] Adapt workflows and helpers per the CI section below.

| Path surface | Required outcome |
| --- | --- |
| Workspace root | Lockfile, repo-wide scripts, docs, CI, format and lint config; independent of app cwd. |
| App root | `packages/desktop`. Root forwarding and direct filtered commands select the same config and resources; siblings resolve relative to config location. |
| Desktop output | App-local `out/{main,preload,renderer,cli}` with Builder staging under Desktop. Freeze the layout after the spike; do not duplicate outputs to keep obsolete globs alive. |
| Packaged resources | `app.asar.unpacked/{cli,runtime,resources,plugins}` and macOS helper placement unchanged. |
| CI artifacts | Root-owned upload and assembly may remain, copying from an explicit app output root. Asset names, checksums, source SHA, update metadata, and size inputs unchanged. |
| Git, version, release | Git at repo root; app version and product metadata in the Desktop manifest. Remove any assumption that one directory owns both. |
| Native dependencies | Importer-aware resolution, rebuild cwd, platform and arch selection, and ASAR unpack paths all verified. No symlink escaping into a developer checkout in the installed app. |

### CI, install, and release migration

All existing PR static, main, and renderer gates keep running. Root forwarding covers `pnpm run`, not
direct Builder invocations, script paths, snapshots, caches, upload globs, or release assembly, so
audit each one.

| Workflow surface | Required adaptation |
| --- | --- |
| `prcheck.yml` | Root static checks cover every package; main aggregation includes the kernel and shared suites; renderer, build, and native-memory paths follow ownership. `pr-required` needs and results semantics unchanged. |
| `package-check.yml` | Base and head manifest snapshots, changed-path handling, and trusted classifier invocation understand the new layout. New or deleted manifests and pre-migration base refs get an explicit conservative fallback. |
| `_package-{windows,linux,macos}.yml` | Explicit Desktop cwd for Builder; app scripts, native installation, output globs, signing hooks, runtime downloads, manifests, size checks, and upload paths agree. Validate x64 and arm64. |
| `build.yml` | Delegates to the same package entrypoints and preserves artifact contracts instead of maintaining a second layout. |
| `release.yml` | Reads the product version from Desktop, keeps source SHA and tag checks, assembles at root, still supports `--ignore-scripts`, and verifies manifests, checksums, and asset names without publishing. |
| `package-regression.yml`, `windows-arm64-e2e.yml` | Rebase executable, installer, runtime, and fixture paths; preserve scenario coverage and platform prerequisites. |
| `.github/actions`, `scripts/ci`, release scripts | Audit composite actions, caches, and source scanners, not just workflow YAML. |

Packaging classification: unknown `packages/**` changes conservatively enable all platforms until
specific rules have fixtures. Shared, kernel, CLI, and any shipped domain change affects Desktop
packaging. Root lockfile, install policy, and build tooling changes propagate to every consumer.
Extend the classifier tests for source, config, and manifest changes, manifest deletion, renames
across layouts, transitive impact, platform assets, and unknown paths; a classifier exception or a
missing base snapshot must never silently mean "no package jobs". No new CI job is needed merely
because a package exists.

Install matrix: fresh root `pnpm install --frozen-lockfile` with Desktop lifecycle and correct native
ABI; `--ignore-scripts` plus explicit preparation for build jobs, with release assembly never
requiring an Electron or native rebuild; platform and architecture native preparation on supported
runners under the current supported-architecture policy; and an isolated consumer outside the
workspace using only staged artifacts and declared dependencies.

**Exit:** common checks; root and filtered command equivalence; fresh install and `--ignore-scripts`
assembly; local unpacked app and e2e smoke; the applicable six-target packaging and native smoke
matrix. Stop if resource discovery, app identity, version, launcher execution, or required test
discovery changes unintentionally. PR acceptance means the applicable `prcheck` and `package-check`
jobs pass; release readiness is separate, and unavailable runners or signing credentials are recorded
blockers, not passes. Never create tags or publish to turn a workflow green.

## M4 — `packages/cli`

Suggested boundary: `refactor(cli): move client into workspace`.

- [ ] Move the current CLI client and its build recipe into `packages/cli`. The Desktop local-control
      server stays Desktop-owned until its Stage 3/4 replacement is accepted.
- [ ] Keep the CLI import closure free of Desktop source; promote any wire contracts it needs into
      shared. No backwards `../../desktop/src` import.
- [ ] Keep CLI build output package-owned. Desktop packaging copies an explicit artifact into the
      unchanged installed destination, so the CLI never learns Desktop's source layout.
- [ ] Use one pure launcher-template source for both build-time artifacts and Desktop launcher
      generation, behind a narrow entrypoint so Desktop cannot eagerly import a future service host.
      Keep host and client entrypoints separate inside the CLI without adding another package.
- [ ] Preserve argument quoting, exit status, permissions, version output, runtime discovery, and
      fail-closed missing-runtime behavior. Never fall back to an arbitrary system `node`.

**Exit:** existing CLI contract and launcher tests plus POSIX and Windows execution smokes pass;
`--help` and `--version` work from packaged paths containing spaces; Desktop still ships working
launchers; live V1 operations and authentication are unchanged. The CLI still requires Desktop at
runtime and must not advertise headless support.

## M5 — Portable domain cores

Suggested first boundary: `refactor(provider): extract portable core`.

M5 is not a fixed package list. Before each slice, inventory value and type imports, initialization,
resources, persistence, native modules, and real consumers; record the allowed dependency edges and
verify the graph is acyclic. No package is added because a directory exists.

| Slice | Portable-core work | Stage 3 obligation and stop condition |
| --- | --- | --- |
| M5a provider | Node-capable model runtime with injected config, path, logging, credential, and OAuth ports; Electron implementations stay in Desktop. Cut MCP settings and persistence coupling rather than importing the host. | Real model requests and credential ownership. An interface placeholder is not a host adapter. |
| M5b MCP | Extract transport, session, and process logic onto explicit ports while preserving URL validation, token binding, interactive refusal, and child lifecycle. | Real allowlisted tool continuation, authority, cancellation, and cleanup without Desktop. Absent OAuth UI must refuse explicitly, never bypass. |
| M5c session and persistence | Keep session repositories separate from DB lifecycle and catalog assembly; inject narrow complete transaction operations instead of a generic service locator. | One profile, DB, and config owner; same schema, migrations, repair order, and transcript atomicity. SQLite and encrypted-profile access must work under the chosen Node host. |
| M5d further domains | Memory, skills, hooks, file, process, toolchains, events, approval, only when an accepted capability needs them. | Real capability tests, recovery, and shutdown. |
| Host composition in CLI | Assemble accepted cores and host adapters, keeping client and host imports separate. | Profile lock, identity, discovery, startup races, capability leases, trusted approvals, compatibility admission, shutdown. Closes only in the standalone tracker. |

Persistence boundary, required before any storage move:

- The composition owner assembles the full schema and migration catalog. Session must not import
  provider, MCP, or memory to own all tables, and domain packages must not depend on CLI or Desktop.
- Start with injected persistence ports while the implementations stay in the current host. Add a
  lower-level data package only if real shared table or connection primitives demand one; do not
  pre-build a schema-plugin subsystem.
- If table definitions move, use typed catalog assembly with deterministic ordering, duplicate
  rejection, and completeness checks, preserving fresh, upgrade, and repair behavior, indexes,
  triggers, and migration transaction boundaries. No DB split or schema redesign here.
- The kernel gate keeps forbidding SQLite and PTY. Host gates get a separately reviewed native
  allowlist and must actually open an isolated database or tool runtime. Never weaken the kernel gate
  to make a host pass, and never assume Electron-built binaries work under plain Node.

Credential and OAuth gate, required before any adapter is called host-complete:

- Inventory provider credentials, MCP OAuth credentials, config secrets, and the database encryption
  key. Per supported OS and profile class, record the existing format, pure-Node read and unlock
  proof, secure storage owner, reauthorization policy, interaction capability, and typed refusal.
- Test existing encrypted profiles and unavailable-keychain cases in isolated fixtures, never against
  a developer's live profile.
- Keep unsupported profiles and capabilities explicitly blocked. Do not invent new wire error codes;
  use existing typed errors or land a reviewed contract extension first.

Desktop UI and native implementations stay Desktop-owned, but "never extract file, workspace, or
config" is too broad: portable paths, file and process operations, workspace policy, and
execution-affecting config that the service needs must gain host-safe ownership. CUA and native UI
plugin capabilities stay gated, and external ACP remains a peer that never enters the built-in loop.

**Exit:** package artifact and dependency checks plus the relevant real host behavior tests. A slice
may be portable-core complete while host-complete stays blocked.

## Verification

Root command names stay the contributor interface. Run sequentially where build outputs are shared;
in particular do not run typecheck and Vitest concurrently.

```sh
pnpm run format:check
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main
pnpm run test:renderer
pnpm run build
```

- M0 proves the clean-checkout typecheck path with no warm `dist`.
- M2 and every later package add alias-free runtime and declaration closure checks from an isolated
  consumer. A deliberately broken forbidden import or undeclared dependency must still fail the gate;
  remove the probe afterwards.
- M3 adds `build:unpack`, `e2e:smoke`, a relocated-test discovery comparison, the install and native
  matrix, and packaging and release path verification. M4 adds real launcher and CLI execution.
- M5 adds persistence, concurrency, shutdown, and supported-capability regressions per slice.
- Run `git diff --check`; inspect rename detection, generated registries, and the lockfile diff.
- Record SHA, commands, results, platform coverage, and unresolved blockers per milestone here. Keep
  durable tests only for package contracts, real behavior, lifecycle, security, or proven
  regressions.

## Rollback and stop rules

- Keep reviewable, independently verifiable milestone boundaries on this branch. If the diff becomes
  unreviewable, ask before switching to stacked PRs; do not change the delivery strategy silently.
- M1–M4 must not alter user data formats or service ownership. Failed changes revert in reverse
  dependency order through normal Git operations, followed by reinstall from the matching lockfile
  and a rebuild of generated outputs. Never reset unrelated work.
- Stop on missing tests, changed identity or artifact paths, unresolved exports, duplicate value
  owners, new cycles, unsupported native ABI, credential downgrade, or profile-owner duplication. Do
  not weaken guards, aliases, classifier policy, or required checks to proceed.
- M5 and Stage 3 rollback is not "start Desktop too": profile ownership stays mutually exclusive and
  the schema stays unchanged. Any approved data migration needs its own backup and recovery decision
  before cutover, and a fallback may never become a second authoritative owner.
