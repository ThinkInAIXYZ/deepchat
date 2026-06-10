# SkillPresenter Sync IO — Tasks

- [x] T1: Add `pathExists` helper and convert read-path call sites to `fs.promises`
- [x] T2: Update test fs mock so `promises.*` delegate to sync mocks
- [x] T3: Verify tests at baseline + typecheck + lint + format

## Outcome

Converted to `fs.promises` (no public signature changes): `discoverPluginSkillsOnMainThread`,
`parseSkillMetadata`, `loadSkillContent`, `viewSkill`, `viewDraftSkill`, `getSkillExtension`,
`listSkillScripts`, `collectScriptDescriptors`, `getSkillFolderTree`/`buildFolderTree`,
`listSkillLinkedFiles`/`collectLinkedFiles`. Mutation paths intentionally left synchronous
(see spec.md). One test assertion updated ("rejects oversized raw skill file reads") because
discovery now reads frontmatter through `fs.promises.readFile`. `test:main` at pre-existing
baseline (15 failures on dev unrelated to this change); the 3 `manageDraftSkill` failures in
`skillPresenter.test.ts` fail identically on unmodified dev.
