# DeepChat Monorepo Migration Plan

Execution tracker for [spec.md](./spec.md). Implementation was authorized on 2026-09-18. M0 is
verified locally; M1 passed independent acceptance and delivery integration checks. Checkboxes require
verification, not merely an edited file. This document does not authorize commits, pushing, or release
publication. Design rationale, ownership rules, dependency contracts, and the checked baseline live in
the spec and are not repeated here.

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

- [x] Refresh `origin/dev`, PR state, and CI, then integrate upstream into the delivery worktree before
      any mass rename. The reason is conflict volume, not impossibility. The merge remains uncommitted.
- [x] Record source SHA, toolchain, lockfile state, and current failures. Re-run the shared-copy and
      shim inventories; capture baseline test discovery and the artifact/resource manifests.
- [x] Fix the kernel path mapping in `tsconfig.node.json` so it resolves inside the repository, and
      confirm a clean checkout typechecks with no prebuilt kernel `dist`. Align Vite, Vitest, and
      `tsc` on one source-consumption contract; keep artifact consumption proven by the package gate.
- [x] Spike electron-vite and electron-builder from a child package in a disposable worktree. Record
      app root, output roots, native dependency resolution, and root-versus-filtered command
      equivalence. Do not move anything in this milestone.

**Exit:** a reproducible baseline or an explicit blocker, plus a recorded path contract from the
spike. A previously reported green commit is not a baseline.

### M0 execution evidence (2026-09-18, locally verified)

- Input: `07c5d7ae7`; refreshed upstream: `8cdf58016`; actual merge base:
  `51942353d6432b2a3edc0b69aa827c4d8b7aac6a`. Upstream integration is uncommitted; all
  eight content conflicts are resolved. No push, tag, or publication has occurred.
- The seven runtime conflicts retain host re-exports. The upstream stream-revision changes are
  explicitly ported into the seven kernel runtime owners and the copied chat event schema; the
  merged ACP projection adapter already calls `markStreamChanged`.
- The zero-inbound report was independently regenerated into a temporary directory: 84 main
  candidates (not either side's 85/13). Only the conflicted report was reconciled against that
  output; other architecture baselines were not normalized.
- Toolchain: Node `v24.18.0`, pnpm `10.34.5`. Root `pnpm install --frozen-lockfile` passed,
  including Electron `43.6.0` native preparation for macOS arm64. This was an existing install;
  fresh-install verification runs separately in an isolated worktree.
- Lockfile SHA-256: `80f1b75c78818482f1d659cfb9a99180a63c06c581f2adcc4d5f901b3234f541`.
  Builder manifest: `b732c231906815d6223f1f457958e817af65f144a620c3263713ec5c128a329a`.
  Runtime manifest: `8d15259dfc13c9e723770ff455e0e4feab2b9118e256dfef19d62ce1f24605e3`.
- Discovery before relocation: 656 main and 278 renderer Vitest files; Playwright discovers
  39 tests in 38 files. Kernel source: 246 TypeScript files; pure host re-export shims: 175.
- Passed: format check, i18n, lint, renderer architecture baseline check, all four typechecks,
  fidelity (66 faithful / 3 exempt / 141 host-only), full main suite (655 passed / 1 skipped
  files; 9234 passed / 5 skipped tests, including the artifact gate), and full renderer suite
  (278 files / 2516 tests). `pnpm run build` passed and its normal provider/ACP registry refreshes
  are retained. Playwright completed: 34 passed / 5 skipped out of 39 discovered tests. Skipped
  credential-dependent cases are not claimed as live-provider coverage.
- Upstream Vitest 4 exposed the contract gate's implicit Node type dependency. Its scoped
  compiler now explicitly includes `node`, and the test explicitly imports `Buffer`; no
  assertion or diagnostic filter was removed.
- Independent cold-install/revision acceptance used corrected tree
  `87bf764341caa066373fdf68f4fdf4b5c2958e00` in `deepchat-monorepo-m0-verify`: fresh frozen
  install, no kernel `dist`, full typecheck, 46 client-contract and 14 kernel-port tests passed.
  This supersedes the initial snapshot `82c5eb3757194bc1a0ed0ff1a53aefa87bae0eec`.
- PR refresh finds #2315 (this branch, remote head `e002d4261`), #2319, and #2324 targeting dev.
  The upstream SHA has no Actions runs or check runs returned by GitHub. Local acceptance above
  is not remote CI acceptance; no remote execution or publication was initiated.
- Disposable child-package spike produced an unsigned macOS arm64 `DeepChat.app`; root forwarding
  and direct filtered builds had identical main/preload/renderer entry hashes. App outputs belong
  to `packages/desktop/out/{main,preload,renderer,cli}`, Builder staging to Desktop `dist`.
  Move TS configs, Builder config, resources/runtime/build, and app hooks together; use config-file
  relative aliases, explicit Desktop cwd for Builder, and root-owned pnpm policy. CLI/runtime/CDN/
  skills/native unpacked paths were present, with no symlink into the checkout. Other five targets
  and plugin/helper distribution preparation remain M3 gates, not spike passes.
- The spike used direct Desktop optional dependencies to expose FFF and Parcel native companions.
  M3 must resolve them from their owning importer (or prove explicit declarations necessary), not
  scan an unrelated root store. Its reported baseline `xlsx` missing-integrity issue is not present
  in HEAD, upstream, or the corrected M0 tree: all contain the same SHA-512 integrity. Treat that
  observation as a spike lockfile-regeneration issue; do not introduce an unneeded baseline fix.
- M1 removed exactly 175 pure shims, rewrote callers, and retired the old kernel-path aliases.
  Independent acceptance passed full main (655 files / 9233 tests passed; 1 file / 5 tests skipped),
  renderer (278 files / 2516 tests), typechecks, formatting, i18n, and lint. Its Tape scanner now reads
  the actual kernel owner; the architecture scanner still includes the complete host DeepChat root.
  One obsolete relative-import test was removed because its host shim owner no longer exists; the
  five real kernel owner layers retain the harness-import guard. The reviewed patch is integrated in
  the delivery worktree without a commit. Integration typechecks, 56 structural tests, format, i18n,
  and lint pass. Full integration main passed 655 files / 9233 tests (1 file / 5 tests skipped).
  Renderer passed 278 files / 2516 tests on a separate rerun after the combined command's outer
  timeout interrupted its first attempt; no test timeout or assertion was relaxed.
- M2 source (127 exact shared exports), artifact-gate, and early packaging-policy slices passed their
  separate independent reviews. Four reproduced gate defects were fixed: unexported subpaths,
  relative/symlink artifact escapes, dependency-cycle overflow, and Windows path separators. The
  conservative all-platform `packages/**` rule passes 21. Joint integration resolved all 94 conflicts
  on corrected M0 plus reviewed M1 tree `b32684d5d4d1612bf6cde51b94d6f77834db1470`. Frozen result tree
  `6c35f9fbb3a6a2988db8d0b2265c843337cb6155` passed the author's frozen install, common checks, artifact
  gate (7 tests), build, full main (655 files / 9238 tests; 1 file / 5 skipped), and renderer
  (278 files / 2516 tests). Independent review reran artifact (7/7), all type/contract gates, format,
  i18n, lint, packaging policy (21/21), and an alias-free browser bundle successfully. It blocked only
  the singleton evidence: the old logger probe imported the same shared entry twice, and schema
  validation proved compatible shapes rather than identity through a kernel consumer. Corrected tree
  `0820d5af52877e46ef2cc249a6542456ec660ecf` removes the test-only logger getter and observes actual
  kernel calls through shared logger/schema instances. Independent exact-tree re-review passed:
  artifact (7/7), actual kernel singleton probes, and a browser-facing bundle of shared schema plus
  the real kernel consumer (110 modules, no forbidden runtime imports). Browser proof is graph-only,
  not an Electron runtime claim. The reviewed patch is now applied to the delivery worktree; existing
  generated registry/icon bytes already match the reviewed tree and are preserved. Frozen lifecycle
  installation, format, i18n, and lint passed. Delivery byte inventory matches all 4,705 snapshot
  files except this execution tracker. Cold source typecheck found a new integration blocker: some
  promoted public subpaths still map under old `@shared/*` names, which warm shared `dist` had masked.
  Corrected snapshot `703d13bad46c2e4107e2d2c2e6a5819eca09c99b` fixes all 20 misnamed keys in both
  configs and adds a manifest-completeness regression guard. Independent review passed all five type
  gates with shared/kernel outputs hidden and TS caches absent, plus a negative mutation probe.
  Delivery format, i18n, lint, and the same cold typecheck also pass. Its initial full main run passed
  9,236 tests but timed out in native pagination and architecture-baseline tests; both pass unchanged
  in a focused rerun (4 tests). Renderer passes 278 files / 2,516 tests. The final full main run passes
  656 files / 9,240 tests (1 file / 5 tests skipped). M2 is accepted on the root-layout delivery tree;
  relocation must preserve these gates. The same singleton and exact source-map corrections are in
  the preparatory combined tree. A subsequent controller audit found the host `MessageFile` type
  re-export still pointed at its own `@shared/chat` barrel: TypeScript resolved it to `unknown`/`any`
  while `skipLibCheck` hid the circular declaration. The two specifiers now target the package owner;
  an actual compiler-symbol regression asserts identity and rejects `any` (3 tests pass, old-source
  mutation fails). Format, i18n, lint, and fresh-cache full typecheck pass; an initial stale-cache
  notification-export failure does not reproduce without incremental state. Independent review
  passed the checker mutation, targeted tests, and nonincremental Node check. Scoped correction tree
  `aef36f9a38eb9d1b7213831977cf12aba3ade651` differs from M2 by just the host barrel and its regression;
  transposition into the relocated integration tree remains required before final acceptance.
- M3 layout restored the verified `xlsx` integrity and passed frozen installation including Desktop
  lifecycle/native rebuild, typecheck, i18n, build, and renderer (278 files / 2516 tests). Main remains
  red (26 files / 61 tests) on repo-vs-app path readers; formatting discovers 301 formerly excluded
  UI files because ignore paths were not relocated. These are migration defects, not waived gates.
  An independent inventory found no missing baseline tests: 1019 Desktop files plus 8 kernel files;
  all 425 source assets remain, with only two normal generated registry refreshes changing blobs.
  CI's two original P1 helper/resource paths are fixed, but re-review cannot execute the CI-only
  worktree without its relocated files/dependencies. The combined worktree
  `deepchat-monorepo-m3-integrate` now contains layout tree
  `31cd4529f1fbbf06232e424443839b64ada47e6b`, CI/native fixes, and current docs. Its final correction
  snapshot `465ecb71adc23c47837c291759b580bde6b85c47` passes main (9,237 tests), i18n, lint, typecheck,
  and build. It still reports 103 formatting failures; these are not waived as pre-existing because
  the accepted M2 delivery passed formatting. The controller's combined snapshot
  `63eccee619776ac90f190c801ffed9b2d8204592` is frozen before semantic integration of this 52-file
  correction delta. Zhang Ning owns integration, root test discovery, portable shared-test ownership,
  obsolete bridge retirement, formatting reconciliation, and full combined regression. Preparatory M1/M2/M3
  merge runs separately in `deepchat-monorepo-combined` from synthetic merge tree
  `8eebc3b5d8e3e821d45b71f52c2b0cb3dd973925`; 232 conflict messages include both source-content and
  rename/delete ownership conflicts. Controller inspection found hybrid build configuration errors
  (missing URL import and stale shared-helper/kernel paths); the integration writer fixed these,
  both Desktop TS maps, and a duplicate kernel lock importer. Frozen installation, full typecheck,
  CLI build, direct config loading, and 14 focused tests pass. Marker absence alone was insufficient;
  full combined suites still require the pending M3 path correction. CI/native and final active
  documentation changes are applied; local documentation independent review passes after correcting
  the product manifest path and disproving a plugin-classifier false positive. The final M3 correction
  delta and full combined checks remain required. Native importer resolution passed independent
  review after resolving Light OCR through its
  supported main entry rather than non-exported `package.json` (25 tests and installed probes).
  No custom root/store fallback exists; native Node resolution may still find hoisted ancestors.
  A pre-M2/M4 M3 smoke fixture passed fresh lifecycle installation, unsigned macOS arm64 unpacking,
  correct app identity/version, source and packaged launch/settings e2e (2 tests each), and packaged
  OpenDAL loading. An initial Light OCR run exceeded the unchanged RSS budget (1,096,024,064 bytes
  versus 805,306,368). After prepared rebuild, two M3 runs passed at 526,106,624 and 546,832,384 bytes;
  two M0 runs passed at 544,718,848 and 502,136,832 bytes with identical OCR manifest/model/runtime
  identity. The outlier remains unexplained, not an established migration regression; no threshold
  changed. Existing macOS VSS preparation plus unpacking also passed two packaged load/HNSW probes.
  This proves the previous missing VSS artifact was an omitted preparation step, not a loading bug.
  Controller also removed an integration-only leading classifier catch-all that shadowed existing
  platform-specific rules; ten positive/fallback probes pass without reducing unknown-path coverage.
  Independent follow-up in the complete relocated fixture passed the exact forced-native memory
  command (15 files, 332 passed / 2 skipped; real SQLite and VSS). Its prcheck workflow bytes match
  combined. Six-target workflow paths and helper imports pass static inspection, while 10 stale
  path/command assertions in existing CI tests still need the M3 writer's correction. Final combined
  packaging/e2e and the real six-target matrix remain open. GitHub reports no self-hosted runners;
  no Windows/Linux runtime exists on this macOS host. Local static evidence does not substitute for
  the remaining platform jobs, and no remote mutation was made. Corrected frozen-tree inventory
  accounts for all 4,706 M2 paths: 4,643 mode/blob-identical, 63 changed, none missing. Shared's entire
  129-file subtree is byte-identical; the first inventory report's missing-shared claim was false.
  Independent fresh `--ignore-scripts` installation and 12 release-assembly tests pass, but the real
  Node assembly CLI fails: root `updater-metadata-consumer.mjs` resolves Desktop's `electron-updater`
  from root. The two-file correction now anchors resolution to Desktop and adds a real subprocess
  regression. Independent fresh frozen `--ignore-scripts` installation passes 13 tests and plain
  Node assembly/verification of 19 fake assets, without dependency-path or loader overrides. Replacing
  only the helper with the old implementation fails the new test; restoration passes again. Input
  and output tampering, source-identity mismatch, and missing artifacts all refuse. Desktop's version
  wins over a deliberately different root version. This resolves assembly module ownership only,
  not real six-target packaging, signing, or release provenance; combined integration remains required.
- M4 corrected missing exported launcher artifacts and global `--help`/`--version`. Independent
  macOS acceptance passed a fresh CLI build, isolated Node/TypeScript launcher consumers, CLI and
  Node typechecks, 32 test files (482 passed / 1 Windows skipped), and real Electron execution from
  packaged paths containing spaces. Version comes from explicit Desktop build input without IPC or
  discovery. Electron-only fail-closed behavior remains. M3 rebase now removes both old CLI source
  trees and passes CLI plus Desktop typecheck, cold CLI build, and 25 launcher/build tests. Controller
  caught and corrected its inherited nonexistent root TS config. Combined integration now reads the
  version from Desktop's own manifest via config-relative paths rather than POSIX-only
  `$npm_package_version` expansion. Author checks pass cold CLI/full typecheck, explicit-version and
  Desktop-adapter builds, offline help/version, and 27 builder/launcher/alias tests. Independent
  combined review passed substantive runtime/declaration/build checks and missing-Electron refusal
  (exit 127), blocked only on two CLI formatting failures. Controller formatted exactly those files
  and the scoped Oxfmt gate passes. Full combined regression and actual Windows `.cmd` execution
  (including spaces and `%`) remain open; this does not close M4. Untracked M2 inputs in the isolated
  M4 worktree are validation inputs only, not CLI deliverables.
- M5 reviewed dependency boundaries are now in preparatory implementation in three isolated
  worktrees: `deepchat-monorepo-m5-provider` (Zhou Jie), `deepchat-monorepo-m5-mcp` (Chen Wei), and
  `deepchat-monorepo-m5-persistence` (Sun Hao). All start from exact accepted M2 source snapshot
  `703d13bad46c2e4107e2d2c2e6a5819eca09c99b`; this root-layout input is intentional so unfinished
  integration/config edits are not inherited. Controller rebases their deltas onto the accepted
  relocated baseline before delivery. Provider owns any newly required neutral shared closure;
  MCP does not concurrently edit shared. Provider and MCP extract concrete runtimes plus functional
  Desktop adapters; persistence only injects complete same-connection synchronous transactions,
  without a new generic package or schema ownership change. Provider/MCP initially returned no
  accepted implementation, citing missing dependencies or an unaccepted layout. Controller verified
  all 4,706 baseline files against M2 (only MCP's prototype lockfile differs), installed provider's
  frozen dependencies, and clarified authority for coherent host adapters and lock importer updates.
  Both implementations resumed; the intended root-layout input is not an external blocker.
  Persistence independent review confirms complete same-connection sync transactions, native nested
  rollback, and pending-input/linked-message atomicity (166 focused tests). It rejects the slice
  because two direct transcript constructor consumers were not migrated: compaction-usage and ACP
  compatibility suites fail 11 tests. Sun Hao repaired all four omitted constructor calls in those
  two files, audited 21 Transcript and five PendingInputStore calls, and reran 1,651 focused tests
  plus full main (9,240 passed, five skipped). No native service fallback was added. The original
  15 implementation-file hashes remain unchanged; independent re-review passes all 1,651 focused
  tests and confirms every constructor. Accepted 17-path correction tree
  `cb7850d1f09c794e07d2cc908896c70260a9f275` is frozen for transposition. Existing usage helpers still
  catch some errors internally; no claim that every usage failure rolls back is made. Integration
  acceptance still depends on M2–M4; no preparatory implementation closes M5 or standalone Stage 3.
- A worktree-isolation issue was found during integration: relative file-tool paths from three
  workers targeted the inherited delivery directory. Their writes were paused, complete patches
  preserved, and only the identified M3/M4 edits reversed out of delivery. Work resumed with absolute
  file paths and explicit command cwd. Reviewed inputs remain frozen; no commit, push, or tag was
  created.
- After a transport interruption and user-requested restart, actual worktrees were frozen before
  resuming: combined `962f06f494aca25b21320b60e963947c9778ddd9` (149-file delta from the previous
  combined snapshot), provider `bebb1c0479dabdb757b0f88e47955b3c009309df`, and MCP
  `7753267d19c5f4b96b07bf20939aa078320da69b` (both relative to accepted root-layout M2). The initial
  provider/MCP blocked reports are stale: real in-progress packages and Desktop adapters exist now.
  Zhou Jie and Chen Wei resume those contents, not the initial scaffolds. Zhang Ning resumes combined
  integration and includes the accepted MessageFile, updater-resolution, and M5c deltas. Completed
  pre-interruption logs show main 9,244/5 skipped, renderer 2,516, native-memory 332/2 skipped, cold
  typecheck, formatting, lint, and build; these logs do not approve later edits or replace a final
  frozen-tree review. Independent object audit reproduced 101 changed TypeScript files byte-for-byte
  by formatting their baseline, including all changed kernel/runtime implementations and corresponding
  tests. Twelve shared suites are unchanged relocations; root aggregate discovery still needs current
  execution evidence. Ignore relocation was incomplete: a generated 25.6 MB macOS-arm64 VSS binary
  entered the recovery snapshot. Controller added explicit Desktop output ignores in delivery and
  combined (13 positive and six source-retention probes pass), then froze combined as
  `bc56faa72620a1266d59b9df88e2a39de3b885c2`, excluding the binary but retaining the local runtime.
  Zhang Ning's three overlays pass main 9,248/3 skipped, renderer 2,516, typecheck, i18n, lint,
  formatting and build. Independent final review passed kernel artifacts (7 tests, 354 emitted files),
  MessageFile/release assembly (16 tests, 19 fixture assets), independent frozen offline installation
  with no build outputs or TS caches followed by full typecheck, and forced native vector execution
  (14 passed, two existing skips). This is scoped local acceptance, not cross-platform packaging.
  The accepted snapshot is applied to delivery as tree `4fa04c7476321ab2c92b98d27b359f742a2d0448`,
  preserving the current spec and execution tracker; all 4,844 snapshot file hashes match. Root frozen
  installation passed with Desktop lifecycle/native preparation. Delivery-wide final regression will
  run after M5 integration. The CLI package has no standalone test script, so a successful filtered
  `test` command is not extra test evidence. Catalog audit confirms
  an actual normal-build refresh (223 to 224 providers, 38 model identities added and removed, 133
  retained-model records changed); ACP registry bytes are unchanged. Initial catalog SHA and CI
  relative-path audit errors were reproduced and retracted; no correct import was changed.
- Final M5a input is frozen as `a494b01d0847a371a7948dfb8627e63821c4672b` (131-path delta versus M2).
  Author reports 807 provider tests and full main 9,241/5 skipped; independent runtime, ownership,
  artifact and cold-source review is running. M5b's 41-path tree remains
  `7753267d19c5f4b96b07bf20939aa078320da69b`: reviewer passed real transport fixtures, isolated
  artifacts, 131 Desktop regressions, cold-source Node typecheck, and the architecture-baseline test
  at its default timeout. Acceptance is blocked because root/CI commands omit the new package fixture
  and artifact gate; Chen Wei is correcting aggregation and declaration verification. These packages
  remain unaccepted until independent re-review and relocated integration; no host-complete claim.
- Provider remediation tree `7ba4ec151ec11eb5d6b0987cf090da1e06348ad8` removes four one-shot migration
  scripts and makes isolated dependency pinning importer-relative. Its consumer imports every public
  subpath without `skipLibCheck`, but independent review rejects the handwritten upstream
  `json-schema` shim: unmodified `@ai-sdk/provider@4.0.11` fails strict TS7016 without genuine JSON
  Schema types. Zhou Jie is replacing the shim with a compatible declared production type dependency
  and adding the omitted provider package typecheck to the root aggregate. MCP remediation tree
  `ee265543f37696f722e4237642ae69e6a5a99fa1` adds package fixtures/artifact validation to root
  `test:main`, MCP to root `typecheck`, and explicit Node types instead of `skipLibCheck` in the
  isolated consumer. Author reports full main 9,240/5 skipped, fixture 3/3, strict artifact consumer,
  format, i18n, lint, and typecheck passing. Independent re-review passes the complete MCP fixture and
  strict artifact gates plus root entrypoint tests; Zhang Ning is transposing this accepted delta into
  the combined Desktop layout. Git tree objects are intentional immutable uncommitted inputs, not a
  reason to demand staging or commits.
- Delivery M3 checks pass full typecheck and 19 focused MessageFile, release assembly, and entrypoint
  tests. A subsequent producer/consumer audit finds one real missed CI path: the memory retrieval
  quality report is generated under Desktop, while `prcheck` still uploads its old root path. The
  workflow and contract now select `packages/desktop/test-results/memory/retrieval-v1.json`; forced
  SQLite eval passes all seven tests and creates that exact JSON, and six workflow tests pass.
  Independent path audit confirms this finding and no further diagnostic/artifact CWD mismatch. The
  unreferenced old root `vitest.config.memory-shared.ts` is deleted; all four consumers use Desktop's
  config. Scoped correction tree `33352c9f9fd148bad6b1b754133a3a0025d0df26` must be retained when M5
  is integrated. The scoped formatter excluded these paths under existing ignore patterns; subsequent
  root `format:check` passes on 3,356 files, i18n passes, and lint has zero errors/four warnings. These
  are pre-M5 checks, not final integrated acceptance.
- Provider declaration remediation is frozen as `15a118b242fc8c30ee3a9d51330faa7983cbd290`: genuine
  `@types/json-schema@7.0.15` is a production dependency, the ambient shim is removed, the package uses
  `skipLibCheck: false`, and root typecheck includes provider. Author reports 807 provider tests and
  cold aggregate typecheck passing. Independent frozen-source re-review passes strict provider types,
  staged all-subpath runtime/declaration consumption, root aggregate invocation, and the missing-`ai`
  dependency negative control. No shim, undeclared fixture type dependency, or version drift remains.
- Delivery native runtime preparation succeeds through root forwarding commands. The first forced
  SQLite/VSS native run has one 15-second timeout in the 50k-row conflict-index fixture (331 passed,
  two existing skips); the isolated unchanged test passes in 8.75 seconds. An unchanged full rerun
  passes 15 files/332 tests with two existing skips, and native performance passes six files/10 tests.
  No timeout, threshold, source, or test is changed. The initial transient cause is not established;
  these pre-M5 logs are retained under `/tmp/deepchat-delivery-m3-{native-memory-rerun,memory-perf}.log`.
- Combined MCP transposition is frozen as `11710ed04cf0f84bf9a1c4fd16d23452e0521ee4` (49 physical
  changed paths versus `bc56faa72620a1266d59b9df88e2a39de3b885c2`, including six deleted original
  implementations). Frozen installation, MCP artifact/fixture gate, full typecheck, 201 focused tests,
  and main 9,248 passed/three skipped pass. Independent relocation/lock/ownership review passes but
  rejects root `test:watch`: shell `&` serializes on Windows and does not supervise both POSIX
  watchers. Remediation must retain root kernel/shared discovery and usable cold artifact watching,
  not merely start Desktop's narrower watch script. An isolated cold MCP typecheck reproduces TS2307
  without shared `dist`: `typecheck:shared` does not emit and MCP lacks source mappings. The controller
  also finds a hardcoded POSIX `tsc` path in the isolated MCP artifact gate. Chen Wei is correcting
  these in a separate temporary archive based on the immutable tree, including actual watch rerun and
  shutdown verification. Root `test:ui` already selects root config, so its gap is MCP only, not
  kernel/shared; the review's later broader UI omission claim is rejected by the actual script.
  Zhang Ning owns the sole combined writer for Provider transposition and the delivery CI correction;
  accepted entrypoint remediation will follow that writer rather than racing configuration edits.
  The earlier controller snapshot `7c1ee88627a7cabf4926879ab9bd095281dde3e8` omitted rename-source
  deletions and is rejected; snapshot inventories now use `git diff --no-renames` to include both ends.
- Local E2E inventory is machine-reconciled against all 38 actual spec filenames: 33 use local
  fixtures and five require configured external providers. Both independently numbered `34-*` files
  are included. Run with a fixture-owned temporary profile; never use the developer profile. This is
  execution preparation only, not E2E pass evidence. The complete commands and side-effect review are
  in `/tmp/deepchat-final-e2e-inventory.md`.
- Active contributor-guidance audit verifies root forwarding commands, Docker and hooks. Delivery
  repairs the three README icon references to the relocated original `packages/desktop/build/icon.png`
  and aligns AGENTS engine guidance with the existing workspace ranges; direct file/manifest checks
  pass. Retain these four delivery-only documentation changes during final integration.
- Combined Provider integration is frozen as `a45759ee9e34fd8fb791b7600f9d899de3fc4e6f`; all 4,876
  source-tree blobs match the combined filesystem. Independent Provider-only review passes frozen
  installation, strict typecheck and the isolated artifact consumer, confirms the shared value owners
  and absence of a Provider-to-kernel dependency, and accepts the shared DeepSeek adapter's removal
  of the DOM-only `BodyInit` type without changing its runtime validation. Author reports 807 provider
  tests, 2,516 renderer tests, full typecheck, format, i18n, lint and build passing. The author's raw
  index-relative deletion list is not authoritative: physical CLI/MCP/shared files remain present in
  the frozen tree. The memory report CI correction and obsolete-config deletion are included.
- The first MCP entrypoint correction is rejected: replacing root aggregate commands dropped the
  mandatory isolated artifact gate, and source-mode fixtures alone no longer prove real transport
  behavior from staged artifacts. Chen Wei is restoring the mandatory gate and isolated stdio/HTTP
  transport proof in a temporary archive. One root Vitest project remains the intended watch/UI
  solution; source and artifact consumers must both be tested.
- Cold domain typechecking must not use a shared build as a substitute for the specified source
  contract. Zhou Jie is implementing exact manifest-backed source resolution for Provider and MCP
  in a separate archive, preserving their independent emit configs and strict declaration consumers.
  Lin Tao is separately correcting Windows process invocation in build/artifact tooling; selecting a
  `.cmd` suffix alone is insufficient, and shell execution does not automatically quote paths with
  spaces. Prefer the manifest owner's real TypeScript JavaScript executable through `process.execPath`.
  This tooling rule does not permit a system-Node fallback in the product CLI launcher.
- Wu Tong completed all 33 local E2E spec files (34 tests, including both `34-*` files) against the
  reviewed combined runtime: 34 passed, zero failed or skipped, in 10.0 minutes. Fixture-owned profiles
  were used, external-provider opt-in and developer-profile overrides were unset, and main/renderer
  entry, Playwright config and fixture hashes were unchanged before/after execution. This is macOS
  source-build evidence, not final delivery/package acceptance; five external-provider scenarios and
  supported nonlocal targets remain unproven. See `/tmp/deepchat-combined-local-e2e-report.md`.
- The reviewed Provider/MCP combined runtime is applied to delivery: 197 paths changed and three
  already matched, with all 4,870 nondocumentation/guidance blobs checked against the immutable input.
  The current spec, tracker, engine guidance and three README icons are retained. Root frozen install
  passes on seven workspace projects and completes Desktop's arm64 Electron native preparation
  (`/tmp/deepchat-delivery-m5-install.log`). Su Shan owns delivery build/package/native verification;
  no competing typecheck, test or output writer runs there until that lane finishes. Remaining tooling
  patches are isolated and will be integrated and re-reviewed afterward.
- Delivery's first M5 build failed resolving the already-declared renderer `nanoid` import. Su Shan
  traced Desktop's `nanoid`, Vue, Vite and Electron dependency links into the temporary artifact-review
  archive. A delivery-local `CI=true pnpm install --frozen-lockfile` restored the proper physical
  dependency closure without source/manifest/lock changes. Root build and unsigned macOS arm64 unpack
  now pass. Normal provider/ACP refreshes remain; packaged native/CLI/plugin checks are running and
  are not inferred from build success. Fixture installation must never write through another
  worktree's dependency-directory links.
- Zhao Min independently accepts the six-file Windows artifact invocation correction on frozen tree
  `85cfbfa1f29ea2b011b6a5f882c6bdad518c169d`. Provider strict consumption passes (1/1) and kernel's
  isolated gate passes from a path containing spaces (7/7). The earlier provider failure came from
  another worktree's symlinked dependencies; a fixture-local frozen install fixes it without source
  changes. Windows execution itself remains unproven.
- The controller regenerated the corrupted MCP patch and combined all tooling corrections on
  immutable tree `1f7e4abbe3b74c151aa582530387a70f46f11b82` (16 paths versus `a45759ee9`). Mandatory
  root artifact preflight is separate from one supervised source Vitest project; its isolated Node
  consumer exercises real stdio/HTTP. Provider/MCP source checks use manifest-derived exact aliases,
  no build or emission, unique temporary configs, and direct Node/compiler execution. This candidate
  is under independent review and not yet applied to delivery. Candidate integration in the combined
  worktree passes format, i18n (23 locales), lint (zero errors/four warnings), full typecheck and
  renderer (278 files/2,516 tests). Main aggregate fails six script-test files (22 failed, 9,198 passed,
  three skipped tests; three suites fail collection) resolving correct relative imports as `/scripts`.
  Lin Tao also reproduced a real shared-output race: concurrent kernel/provider artifact closures
  delete the same `shared/dist`, breaking Provider compilation. Chen Wei fixed both defects on the
  frozen candidate in an isolated archive: the two inline Desktop projects now declare an explicit
  `root: appRoot` (restoring config-relative resolution; no test-import rewrites, no speculative
  aliases), and the two artifact-writer tests move into a dedicated serial `artifact` Vitest project
  (`fileParallelism: false`, `maxWorkers: 1`) excluded from their original projects, with
  `test:main` gaining `--project artifact` and `test:artifact` invoking that project (no external
  consumers of the old kernel-only semantic exist). Normal suites keep their parallelism. The
  controller amended the new include patterns from `new URL(...).pathname` to
  `fileURLToPath(new URL(...))`: `.pathname` percent-encodes spaces and prefixes Windows drives with
  `/`, which would silently drop the artifact tests (fail-open). Zhao Min's independent narrow
  review on a fresh archive of tree `1f7e4ab` returned PASS: the six script files pass (6 files/71
  tests), the artifact project runs both writers serially (2 files/8 tests; kernel builds complete
  before the provider closure starts), `testEntrypoints` passes 3/3, discovery shows both writers
  only in `artifact` with `main` still at 644 files, and a spaces-containing-path probe proves the
  `fileURLToPath` include patterns match. Static review confirms no `src/` change, no assertion
  weakening, and no global concurrency downgrade. The amended patch applies cleanly and the
  combined tree passes the same narrow verification in situ (7 files/74 tests plus 2 files/8 tests).
  The candidate-plus-fix delta is transposed to delivery as two patches whose result is verified
  byte-identical to the amended tree on all affected paths; delivery format, i18n (no missing or
  invalid keys) and lint (four known warnings, zero errors) pass immediately after. The single full
  passes then succeeded: combined `test:main` reports 658 files passed with one skipped (9,252
  tests passed, three skipped, exit 0) and delivery's gate chain passes typecheck, `test:main`
  (658 files / 9,252 tests, identical counts to combined), `test:renderer` (278 files / 2,516
  tests) and the root build, with `git diff --check` clean on both trees. The final delivery
  rebuild produces unsigned macOS arm64 `DeepChat.app` with the retained CUA/Feishu plugin
  artifacts; its `app.asar` hash differs from the earlier verified package, so the native/CLI/
  launch smoke set is being re-run against this exact package to bind package evidence to the
  final tree rather than inferring it from the hash. Su Shan's rebind against that exact package
  passes plugin verification (CUA/Feishu intact), DuckDB VSS with HNSW persistence, OpenDAL memory
  round-trip, real Light OCR via CoreML (peak RSS 543,293,440 bytes, effectively identical to the
  prior package; cold/warm/PDF latencies within machine-load variance), and the full packaged-CLI
  set (`--help`/`--version`, space-containing fixture profile, packaged Electron under
  `ELECTRON_RUN_AS_NODE`, fail-closed exit 127 with no system-Node fallback). Her custom
  launch/settings script could not capture `ready-to-show` this time; the repository's own
  packaged-e2e channel resolves that item — `DEEPCHAT_E2E_APP_MODE=packaged` with the new
  executable and fixture-owned profiles passes `01-launch` (7.2s) and `04-settings-navigation`
  (23.1s). No orphan processes or fixture residue remain. The `app.asar` hash difference from the
  earlier package is recorded as build-artifact variance: application source is byte-identical
  across the candidate delta, and runtime equivalence of the new bytes is proven by the native,
  CLI, and packaged-e2e evidence above rather than by hash reasoning.
- Chen Yuan's tooling review withdraws its earlier BLOCKED verdict: the reviewer archive directly
  under `/private/tmp` was contaminated by an unowned legacy `/private/tmp/vitest.config.ts`, which
  Vitest's upward module resolution for `--config ../../vitest.config.ts` matched first. The
  candidate's root command is correct for the repository layout; with the config made absolute the
  same `test:main` pipeline passes `testEntrypoints` (3/3), the MCP artifact preflight passes, and
  `--watch`/`--ui` start, execute, and exit without orphan processes. This is environmental
  contamination evidence, not an edit-triggered watch rerun. Review archives must not be placed under
  a parent directory that can inject config candidates.
- Su Shan completed delivery package verification on the unsigned macOS arm64 unpacked app
  (`packages/desktop/dist/mac-arm64/DeepChat.app`, identity `com.wefonk.deepchat`, version
  `1.1.2-beta.5`, `app.asar` SHA-256 `267712d3...e1a7cfb4f`). Official CUA and Feishu plugins are
  bundled and verified into `app.asar.unpacked/plugins`; the layout exposes `cli/{deepchat,
  deepchat.mjs}`, `runtime/{duckdb,ocr,rtk,uv}`, `resources/{cdn,skills}` with no symlink escape.
  Native smokes pass against the final package: DuckDB VSS with HNSW persistence, OpenDAL memory
  round-trip, and Light OCR via CoreML with forced peak-RSS measurement (543,588,352 bytes, within
  budget). The packaged CLI answers `--help`/`--version` (exit 0, `1.1.2-beta.5`) from a
  space-containing fixture profile, runs through the packaged Electron under `ELECTRON_RUN_AS_NODE`,
  and fails closed with exit 127 and the bundled-resources message when runtime is missing — no
  system-Node fallback. A narrow launch/settings smoke with an isolated profile creates a window and
  writes valid JSON settings, then shuts down cleanly. No tracked source, manifest, lockfile, or test
  files changed. Unsigned/notarized DMG/ZIP publication and non-macOS targets remain unproven, as do
  signing and update flows.
- Evidence-chain scoping for final acceptance: the tooling candidate delta `a45759ee -> 1f7e4ab`
  is exactly 16 paths (`package.json`, `vitest.config.ts`, six `scripts/` files, three package
  manifests/vitest configs, and four test files), none of which is application runtime source. The
  combined E2E runtime (34 local tests) and Su Shan's delivery package therefore verify the same
  application-source bytes as the final tree; their evidence transfers by path-scoped source
  identity rather than by rerun, provided the pending aggregate-fix patch stays within the same
  non-application scope. The fix patch's file list must be checked against this condition before
  final acceptance relies on it.
- The controller committed the migration as a milestone chain where every commit's tree is the
  exact independently accepted frozen state: a merge of `origin/dev` at `8cdf58016` carrying the M0
  conflict resolutions and baseline fixes, then M1 shim removal, M2 shared extraction plus its
  scoped correction, the M3 relocation and its CI/native corrections, the CLI package and package
  test integration, the M5c transaction seam, the provider/MCP core extraction, and the hardened
  tooling gates, closing with the serialized artifact-gate fix and the evidence/engine-policy docs
  commits. The latest `origin/dev` (`ebfe83ad0`, 17 commits: the sync host endpoint feature, memory
  atomicity fixes, and the Baizhi MCP example) is then merged on top. Rename detection carried most
  of the porting automatically; the sync host module and its tests land under
  `packages/desktop/src/main/sync/host` and `packages/desktop/test/main/sync/host`, the new
  syncHost contracts stay desktop-owned beside the host routes barrel, the Baizhi example test
  resolves the workspace root relative to the relocated file, and the merge touches neither the
  renderer surface nor any extracted package manifest. Post-merge gates: full typecheck including
  the kernel-port structure gate, the affected sync/memory/plugin suites, format, i18n, lint, and
  the full main aggregate all pass on the merge result.

## M1 — Remove kernel re-export shims

Suggested boundary: `refactor(agent): remove kernel re-export shims`.

- [x] Recompute the shim list, including relative imports and mixed barrels. Distinguish pure
      re-export shims from host harness and composition implementations, which stay.
- [x] Rewrite production callers to supported kernel subpath exports, then delete only confirmed
      shims. Add the export subpaths the callers actually need; do not add a production alias that
      papers over a missing export.
- [x] Keep test-only legacy aliases only where `vi.mock` module identity requires them, and confirm
      old and new specifiers resolve to the same source module. Record each surviving alias as
      transitional debt with the condition that retires it. No legacy alias remains in accepted M1.
- [x] Audit tests compiled outside Vitest, direct source reads, and guard fixtures. Aliases do not fix
      code that inspects files through `process.cwd()`, and "zero test edits" is not a goal.

**Exit:** common checks; no production import resolves through a deleted shim; type and structural
gates plus the full existing suites pass. Update baseline scanners rather than regenerating baselines
to normalize an ownership regression.

## M2 — Extract `@deepchat/shared`

Suggested boundary: `refactor(shared): extract shared package`.

- [x] Record a compact export inventory first: source, consumers, value-versus-type, browser or Node
      requirement, transitive dependencies, and target subpath. Start from the 69-file kernel closure
      plus the contracts CLI needs, and expand only for real consumers.
- [x] Resolve `types/tool` and `types/agent-interface` into checked `.ts` sources that preserve the
      public shapes and migrate their real transitive closure. Do not copy an unchecked host barrel.
- [x] For `chat`, extract only the shared `MessageFile` declaration into one checked neutral source
      consumed by both the host barrel and the kernel. Converting the whole legacy chat barrel is not
      required. Unify further declarations only after their missing names have real owners; never
      substitute `any` or `unknown` to compile.
- [x] Move promoted modules into `@deepchat/shared` with narrow exports and explicit dependencies, and
      rewire every consumer including preload and renderer configs. Delete the kernel copies and the
      host value duplicates, not merely the kernel-side imports.
- [x] Move `ollama` to shared `dependencies` while shared declarations expose `ShowResponse`; drop it
      from the kernel only once no kernel-owned declaration imports it directly. The kernel declares
      shared as a workspace dependency, with no manual exception in the declaration dependency gate.
- [x] Prove a single module instance within each consuming JS realm or bundle, especially for logger
      flags, errors, and schemas. Cross-process singleton identity is not promised. Check packaged
      embedding, not just matching TypeScript shapes.
- [x] Replace the gate's hardcoded single-artifact install with a manifest-derived workspace closure:
      build dependency-first, stage only declared files and exports, and map internal dependencies to
      local artifacts in an isolated temporary fixture. Tarball verification must supply every private
      workspace dependency explicitly; packing does not make one registry-resolvable.
- [x] Validate each staged package against its own manifest: runtime and declaration imports resolve
      from its declared dependencies, exports, and relative files. Match subpaths properly instead of
      exact names, and reject undeclared, Desktop-source, and forbidden native or Electron edges. Do
      not inject an undeclared dependency into the consumer to make it pass.
- [x] Retire the fidelity script and its Vitest bridge in the same slice that lands the replacement
      checks, and only after every duplicate value owner is gone. Preserve the two-round runtime
      scenario, forbidden-import interception including swallowed failures, external declaration
      compilation, and temp cleanup.
- [x] Wire shared checks and any moved tests into root and CI commands in this milestone. Ensure
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

### Reviewed extraction boundaries (2026-09-18)

Independent design review confirmed the following boundaries; implementation and acceptance remain
open until M2–M4 integration supplies the actual source and package baseline. A functional Desktop
adapter is a real first consumer. None of these structural slices closes standalone Stage 3.

- [ ] M5a: extract the concrete standard-provider registry, instance lifecycle, request/runtime/media
      mapping, timeout/cancellation, rate limiting, embeddings, and catalog refresh implementation.
      Supply narrow config/catalog, headers/locale, logging/events, media storage, special-auth fetch,
      and catalog storage/resource ports through working Desktop adapters. Keep settings persistence,
      ACP, GitHub/browser OAuth, ModelScope MCP mutation, and local Ollama administration in Desktop;
      preserve the current runtime surface through composition rather than importing the host.
- [ ] M5a shared ownership: inspect the accepted M2 inventory before moving neutral trace, failure,
      replay, and capability values. Keep one owner per value; provider and kernel must not depend on
      one another. Provider-specific behavior needed by the kernel must be injected rather than
      imported from a sibling runtime. Do not move a Node-only helper into browser entrypoints.
- [ ] M5b: extract `McpClient` and `ServerManager` transport/session/process lifecycle together with
      their validation and identity/binding closure. Inject app/path/toolchain, controlled stdio and
      process recording/termination, config/binding, OAuth, and runtime interaction/event operations.
      Preserve bounded stdio, start/stop epochs, URL and header rejection, token binding, explicit
      interactive refusal, and recovery records on unconfirmed tree termination. Desktop's application
      policy, ToolManager authority, plugins, MCP Apps, and higher-level shutdown stay host-owned.
      Identity helpers alone do not satisfy M5b.
- [ ] M5c: inject a complete synchronous transaction capability at the existing session composition
      boundary. Preserve Tape fact + transcript projection + cursor + usage and pending-input state +
      linked-message atomicity on the same connection. Do not add a generic persistence package or
      export native connection access as a portable contract.
- [ ] For each extracted runtime, prove alias-free runtime/declaration consumption, reject forbidden
      and undeclared edges, exercise a real request or fixture transport, and rerun the existing
      Desktop behavior/security/lifecycle suites. Use isolated profiles and fixture credentials only.

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
