# Skill Watcher Initialize Failure

## User Story

When the skill file watcher utility process fails to start or exits during startup, the skills
system should still initialize and remain usable for discovery, reads, and background sync.

## Acceptance Criteria

- `SkillPresenter.initialize()` does not fail solely because skill file watching is unavailable.
- `watchSkillFiles()` logs a warning and leaves the presenter in a retryable state when watcher
  startup throws.
- Runtime watcher errors release the failed watcher so a later `watchSkillFiles()` call can retry.
- Existing skill discovery and cache behavior remains unchanged.

## Non-Goals

- Replacing the watcher backend.
- Adding a user-visible degraded-mode banner.
