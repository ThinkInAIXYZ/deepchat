# Skill Reinstall Windows EPERM Plan

## Scope

- `src/main/presenter/skillPresenter/index.ts`
- `src/main/presenter/skillPresenter/skillExecutionService.ts`
- Shared skill result typing in `src/shared/types/skill.ts`
- Focused Vitest coverage under `test/main/presenter/skillPresenter`

## Approach

1. Add a structured install error code for locked target folders.
2. Split replacement handling in `installFromDirectory`:
   - valid existing skill folder: keep the current timestamped backup rename behavior.
   - stale residue folder without `SKILL.md`: remove the residue and copy the new skill normally.
3. Wrap replacement filesystem failures so Windows `EPERM`, `EBUSY`, and related access errors are
   reported as a locked-folder result with the target path.
4. Move uninstall cache/event updates after successful filesystem removal.
5. Change skill execution working-directory fallback away from the skill root by creating a
   per-conversation session directory when no valid conversation workdir exists. Keep `SKILL_ROOT`
   and absolute script paths unchanged so scripts can still locate bundled resources.

## Compatibility

- Existing route names and payload shapes remain unchanged except for an additional optional
  `errorCode` literal.
- Existing overwrite backups are preserved for valid installed skills.
- Stale-folder reinstall is a behavioral tightening for the delete/reinstall case, not a migration.

## Test Strategy

- Unit-test `installFromFolder` with an overwrite target that lacks `SKILL.md`; assert residue
  removal and no backup rename.
- Unit-test `installFromFolder` when replacement rename throws `EPERM`; assert
  `errorCode: 'target_locked'`.
- Unit-test `uninstallSkill` when removal throws; assert caches/events are not updated as success.
- Unit-test `SkillExecutionService` fallback cwd resolves to a session directory rather than the
  skill root.
