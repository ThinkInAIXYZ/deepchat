# Privacy Mode

## Summary

Add a global `privacyModeEnabled` toggle in Data settings. Privacy mode disables DeepChat-owned automatic outbound requests while keeping model APIs, manual refresh/check actions, and configured third-party integrations available.

## User Stories

### US-1: Enable privacy mode per device
- As a privacy-sensitive user, I can enable Privacy Mode from Data settings.
- Acceptance:
  - The setting persists per device.
  - The default value is `false`.
  - Future automatic tasks respect the setting immediately without restart.

### US-2: Keep manual actions available
- As a user, I can still run manual update checks and manual refresh actions while Privacy Mode is on.
- Acceptance:
  - Manual app update checks and manual download/install flows keep current behavior.
  - Manual provider DB refresh, ACP Registry refresh, and npm registry refresh keep current behavior.

### US-3: Stop DeepChat-owned automatic outbound requests
- As a security-conscious operator, I can keep the app on cached or built-in data sources while Privacy Mode is on.
- Acceptance:
  - Automatic app update checks stop.
  - Automatic provider/model metadata refresh stops.
  - Automatic ACP Registry refresh and icon sync stop.
  - Automatic MCP npm registry probing stops.

### US-4: Preserve configured integrations
- As an administrator, I can keep approved external integrations active while Privacy Mode is on.
- Acceptance:
  - Model API traffic keeps current behavior.
  - Remote control channels, enabled remote MCP HTTP/SSE servers, and other user-enabled integrations keep current behavior.

## Automatic Outbound Audit

- App update checks through `electron-updater`, currently using GitHub Releases feed in this repo build.
- Provider/model metadata refresh from `https://raw.githubusercontent.com/ThinkInAIXYZ/PublicProviderConf/refs/heads/dev/dist/all.json`.
- ACP Registry manifest refresh from `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`.
- ACP Registry icon sync from `https://cdn.agentclientprotocol.com/registry/`.
- MCP npm registry auto-detect against:
  - `https://registry.npmmirror.com/`
  - `https://registry.npmjs.org/`
  - `https://r.cnpmjs.org/`

## Non-Goals

- Blocking model API traffic.
- Blocking manual OAuth, manual sync, or manual download flows.
- Blocking configured third-party integrations.
