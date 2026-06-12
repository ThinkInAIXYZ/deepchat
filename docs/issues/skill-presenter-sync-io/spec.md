# SkillPresenter Sync IO on Agent Hot Path — Spec

## Problem

`src/main/presenter/skillPresenter/index.ts` performs ~71 synchronous `fs` calls. The ones on
the agent conversation path block the main-process event loop (freezing IPC for all windows)
while an agent turn is streaming:

- `loadSkillContent` — reads SKILL.md when a skill activates (cached afterwards)
- `viewSkill` — `skill_view` tool; stat + read + recursive linked-file walk on EVERY call (uncached)
- `viewDraftSkill` — agent draft tool read path
- `getSkillExtension` / `listSkillScripts` / `collectScriptDescriptors` — run inside
  `buildRuntimeInstructions` on every `loadSkillContent`
- `getSkillFolderTree` / `buildFolderTree` — recursive directory walk
- `parseSkillMetadata` / `discoverPluginSkillsOnMainThread` — main-thread discovery fallback

Mitigating context: regular discovery already runs in a worker thread; the main-thread version
is only a fallback.

## Decision

Convert the **read path only** to `fs.promises`. All affected public methods are already
`async`, so no signature/IPC contract changes.

Mutation paths (install/uninstall/save/zip-extract/draft-install) deliberately stay synchronous:
they are low-frequency user actions, and their synchronous execution acts as a critical section
in the single-threaded main process (multi-step write + rollback sequences in
`saveSkillWithExtension`/`installFromDirectory` would otherwise be interleavable).

## Requirements

1. No public method signature changes (`ISkillPresenter` contract untouched).
2. Private helpers converted to async where needed (`buildFolderTree`,
   `collectScriptDescriptors`, `listSkillLinkedFiles`, `collectLinkedFiles`).
3. `fs.existsSync` on the read path replaced with an async `pathExists` helper
   (`fs.promises.access`).
4. Test suite stays at its pre-existing baseline (3 known failures in
   `skillPresenter.test.ts` unrelated to this change).

## Test strategy

`skillPresenter.test.ts` stubs sync fs mocks in 138 places. Instead of rewriting them, the
fs mock's `promises.*` functions delegate to the corresponding sync mocks
(`promises.readFile` → `readFileSync`, `promises.stat` → `statSync`,
`promises.readdir` → `readdirSync`, `promises.access` → throws when `existsSync` is false),
so every existing per-test stub drives both code paths.
