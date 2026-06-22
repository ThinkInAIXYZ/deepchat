# Tasks

- [x] Inspect issue #1795 and current workspace/default-project code paths.
- [x] Create SDD artifacts for the default workspace feature.
- [ ] Add `ProjectPresenter.ensureDefaultWorkspace()` with path resolution, fallback, mkdir, project
      upsert, active preference marking, and guarded default-path setting.
- [ ] Wire startup bootstrap to call the ensure method before returning `defaultProjectPath` and the
      built-in chat workspace metadata.
- [ ] Update presenter/runtime/shared bootstrap types for the built-in chat workspace marker.
- [ ] Store the built-in chat workspace path in the renderer project store from bootstrap.
- [ ] Update project-mode session grouping so built-in default workspace sessions render under
      `Chats` / `聊天`, separate from normal project folders.
- [ ] Keep user project folder groups reorderable while excluding the `Chats` section from project
      folder reordering.
- [ ] Add i18n keys for the `Chats` sidebar section.
- [ ] Add focused main-process tests for first-run creation, idempotent recreation, existing-user
      guard, and fallback path behavior.
- [ ] Add or adjust startup route tests for bootstrap default path initialization.
- [ ] Add renderer store/component tests for `Chats` grouping and project-folder separation.
- [ ] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
