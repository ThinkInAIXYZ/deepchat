# Tasks

1. Extend shared remote-control types with Discord settings, status, pairing, and Feishu brand.
2. Extend main-process config normalization and binding helpers for Discord endpoint keys and pairing state.
3. Add Discord parser, auth guard, command router, gateway session, REST client, runtime, and adapter.
4. Wire Discord into `RemoteControlPresenter`, channel registry, status computation, and runtime rebuild flows.
5. Add Feishu/Lark brand handling in Feishu adapter/client setup.
6. Update `RemoteSettings.vue` with:
   - Discord tab
   - Feishu/Lark brand selector
   - default workdir controls
7. Update `WindowSideBar.vue` remote status aggregation to be channel-map based.
8. Add or update tests for Discord main-process behavior, Feishu/Lark domain handling, renderer settings, and sidebar status.
9. Run format, i18n sync/checks, lint, and test suites.
