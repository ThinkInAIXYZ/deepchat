# SkillPresenter Sync IO — Plan

1. Add `private async pathExists()` helper (`fs.promises.access`).
2. Convert read-path call sites in `src/main/presenter/skillPresenter/index.ts`:
   - `discoverPluginSkillsOnMainThread`, `parseSkillMetadata` (discovery fallback)
   - `loadSkillContent`, `viewSkill`, `viewDraftSkill`
   - `getSkillExtension`, `listSkillScripts` + `collectScriptDescriptors` (→ async)
   - `getSkillFolderTree` + `buildFolderTree` (→ async)
   - `listSkillLinkedFiles` + `collectLinkedFiles` (→ async, awaited from `viewSkill`)
3. Update `test/main/presenter/skillPresenter/skillPresenter.test.ts`:
   - fs mock factory: `promises.*` delegate to sync mocks
   - shared `beforeEach`: replace `fs.promises.stat/readFile` `mockResolvedValue` defaults with
     the same delegation (they would otherwise clobber the factory delegation per test)
   - keep `readFileSync` default returning `'test'` to preserve `readSkillFile` expectations
4. Verify: targeted test file at baseline (3 pre-existing failures), then full `test:main`,
   `typecheck:node`, `lint`, `format`.

# Tasks

- [ ] T1: pathExists helper + read-path conversion
- [ ] T2: test fs mock delegation
- [ ] T3: verification (tests at baseline, typecheck, lint, format)
