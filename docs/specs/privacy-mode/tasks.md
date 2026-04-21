# Privacy Mode Tasks

1. Add `privacyModeEnabled` to persisted settings defaults, presenter accessors, typed settings contracts, adapter, and renderer store.
2. Gate automatic update checks in `UpgradePresenter`.
3. Gate automatic provider DB refresh in `ProviderDbLoader`.
4. Gate automatic ACP Registry refresh and icon sync in `AcpRegistryService`.
5. Gate automatic MCP npm registry probing in `McpPresenter` and `ServerManager`.
6. Add the Data settings privacy section with outbound audit copy.
7. Add or update tests for settings flow, automatic skip paths, manual refresh paths, and Common settings rendering.
