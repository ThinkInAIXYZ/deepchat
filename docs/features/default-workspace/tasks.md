# Tasks

- [x] Inspect issue #1795 and current workspace/default-project code paths.
- [x] Create SDD artifacts for the default workspace feature.
- [x] Add `ProjectPresenter.ensureDefaultWorkspace()` with path resolution, fallback, mkdir, project
      upsert, active preference marking, and guarded default-path setting.
- [x] Wire startup bootstrap to call the ensure method before returning `defaultProjectPath` and the
      built-in chat workspace metadata.
- [x] Update presenter/runtime/shared bootstrap types for the built-in chat workspace marker.
- [x] Store the built-in chat workspace path in the renderer project store from bootstrap.
- [x] Update project-mode sidebar display so built-in default workspace sessions render under
      `Chats` / `聊天`, separate from normal project folders.
- [x] Label the built-in default workspace as `Chats` / `聊天` in the new-thread project picker.
- [x] Keep user project folder groups reorderable while excluding the `Chats` section from project
      folder reordering.
- [x] Add i18n keys for the `Chats` sidebar section.
- [x] Add focused main-process tests for first-run creation, idempotent recreation, existing-user
      guard, and fallback path behavior.
- [x] Add or adjust startup route tests for bootstrap default path initialization.
- [x] Add renderer store/component tests for `Chats` grouping and project-folder separation.
- [x] Map explicitly no-project sidebar groups to `Chats` / `聊天`.
- [x] Preserve explicit no-project session creation by sending and honoring `projectDir: null`.
- [x] Add regression tests for no-project grouping and nullable project-dir creation.
- [x] Use a chat icon for the NewThread project selector when its current label is `Chats` /
      `聊天`.
- [x] Use chat labeling and icons for the no-project dropdown item and sidebar chat group header.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
