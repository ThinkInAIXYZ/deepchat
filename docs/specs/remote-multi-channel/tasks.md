# Remote Multi-Channel Tasks

1. Expand shared remote-control presenter types for channel-aware APIs and overview snapshots.
2. Extend `remoteControl` config normalization for Telegram + Feishu runtime state.
3. Update `RemoteBindingStore` to read/write both channels and persist endpoint metadata.
4. Add Feishu client/runtime/parser/auth/router files under `src/main/presenter/remoteControlPresenter/feishu/`.
5. Update `RemoteControlPresenter` to manage both runtimes and expose channel-aware IPC methods.
6. Update Telegram runtime draft gating so reasoning/tool-call/pending-action states never stream drafts.
7. Rebuild `RemoteSettings.vue` into overview + tabs and refresh the sidebar remote indicator.
8. Update main/renderer tests and add Feishu runtime coverage.
9. Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and targeted Vitest suites.
