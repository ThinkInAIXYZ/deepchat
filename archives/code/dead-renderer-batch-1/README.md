# Dead Renderer Batch 1

- Purpose: archive renderer dead code that is no longer on the active chat path.
- Archived at: 2026-03-15
- Rationale: static inspection confirmed there are no active references in `src/`, `test/`, or live docs. Files are kept in source form for precise rollback only.

## Archived Paths

- `src/renderer/src/components/message/MessageMinimap.vue`
- `src/renderer/src/composables/message/useMessageMinimap.ts`
- `src/renderer/src/components/MessageNavigationSidebar.vue`
- `src/renderer/src/lib/messageRuntimeCache.ts`

## Notes

- This directory is not part of the runtime, build, typecheck, or test target set.
- Restore by moving files back to their original paths if a later audit proves they are still needed.
