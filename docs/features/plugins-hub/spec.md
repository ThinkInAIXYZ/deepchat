# Plugins Hub Specification

## User Need

DeepChat 的 Settings 里混入了高频工具能力、扩展能力和系统偏好。用户想管理 Skills、MCP
servers、official Plugins 和 Remote control channels 时，不应该打开 Settings，也不应该弹一个新的
插件设置窗口。

本目标是把插件型能力移动到主窗口的一级页面和子路由中，形态参考 Codex 的主窗口 Plugins 页面：
左侧仍是主窗口 sidebar，右侧主内容区显示 `Plugins` 页面、顶部 tabs、搜索、已添加项和推荐项。

## Product Position

`Plugins` 是主窗口里的扩展能力页面，不是独立 BrowserWindow，也不是 Settings 的子页面。

| Capability | 在主窗口 Plugins 页面中的定位 | 数据事实源 |
| --- | --- | --- |
| Official Plugins | 可启停的 DeepChat first-party plugin package，例如 CUA、Feishu/Lark Integration | `PluginPresenter` + `plugins.*` routes |
| MCP | 工具 server 管理、market、global MCP enablement | `McpPresenter` / `useMcpStore` |
| Skills | agent skill 管理、导入导出、sync、draft suggestion | `SkillPresenter` / `SkillSyncPresenter` / `useSkillsStore` |
| Remote | Telegram、Feishu/Lark、QQBot、Discord、WeChat iLink 作为 virtual plugin card | `RemoteControlPresenter` + `remoteControl.*` routes |

Remote channel 是 Plugins UI 里的 virtual plugin，不是 `.dcplugin` 安装包。这个建模只改变用户入口和
展示方式，不改变 remote control 的配置存储、runtime 生命周期或消息协议。

## Goals

- 新增主窗口 route：`/plugins`。
- 在主窗口主内容区集中管理 Official Plugins、MCP、Skills、Remote。
- 主窗口左侧 sidebar 展开态显示 `New Chat`、`Search`、`Plugins` command list，点击 `Plugins` 进入 `/plugins`。
- `Plugins` 页面保留左侧 sidebar，右侧内容区切换，不创建新窗口。
- Remote 每个 implemented channel 都作为 plugin-like card 出现，并能进入该 channel 的详情子路由。
- Remote 设置页不再在 Settings 中展示；从列表进入详情时使用主窗口 Plugins 子路由。
- Official plugin 的详情和设置入口不再弹出 per-plugin BrowserWindow；从列表进入详情时使用主窗口 Plugins 子路由。
- Settings 侧边栏、Settings Overview 搜索和 quick entry 不再展示 Skills、MCP、Plugins、Remote。
- 保留 Settings 内部旧 route 的兼容能力，避免 deeplink、onboarding 或历史入口直接 404。
- `所有 Agents` 标题保留。
- UI 需要在 macOS、Windows、Linux 以及窄窗口下保持可用和美观。

## Non-Goals

- 不做第三方 plugin marketplace。
- 不把 Remote channel 改造成真实 `.dcplugin` 包。
- 不迁移 provider、model、DeepChat Agents、ACP Agents、prompt、memory、knowledge、data、shortcut、about 等系统设置。
- 不新增 Automations 入口；参考截图中有 Automations，但本目标只做 `New Chat`、`Search`、`Plugins`。
- 不新增独立 Plugins BrowserWindow。
- 不新增 `src/renderer/plugins` 独立 renderer entry。
- 不重写 MCP、Skill、Remote、Plugin presenter。
- 不新增统一持久化表来存一个“大插件模型”。
- 不改变 existing Remote commands、pairing protocol、channel binding behavior。
- 不改变 existing MCP server config schema、Skill sidecar schema 或 plugin manifest schema，除非内嵌设置页确实需要最小 route 补充。

## Current State

Relevant current files:

| Area | Current files |
| --- | --- |
| Main app shell | `src/renderer/src/App.vue`, `src/renderer/src/router/index.ts` |
| Main sidebar | `src/renderer/src/components/WindowSideBar.vue`, `src/renderer/src/stores/ui/sidebar.ts` |
| Chat page internal route state | `src/renderer/src/stores/ui/pageRouter.ts`, `src/renderer/src/views/ChatTabView.vue` |
| Settings shell and navigation | `src/renderer/settings/App.vue`, `src/renderer/settings/main.ts`, `src/shared/settingsNavigation.ts` |
| Settings window lifecycle | `src/main/presenter/windowPresenter/index.ts`, `src/shared/contracts/routes/system.routes.ts` |
| Plugins settings page | `src/renderer/settings/components/PluginsSettings.vue`, `src/renderer/api/PluginClient.ts`, `src/shared/contracts/routes/plugins.routes.ts` |
| MCP settings page | `src/renderer/settings/components/McpSettings.vue`, `src/renderer/src/components/mcp-config/**`, `src/renderer/src/stores/mcp.ts` |
| Skills settings page | `src/renderer/settings/components/skills/SkillsSettings.vue`, `src/renderer/src/stores/skillsStore.ts` |
| Remote settings page | `src/renderer/settings/components/RemoteSettings.vue`, `src/renderer/api/RemoteControlClient.ts` |

Important current constraints:

- Main window Vue router currently exposes `/chat` and `/welcome`.
- Main shell already keeps `WindowSideBar` outside `RouterView`, so adding `/plugins` naturally preserves the sidebar.
- Settings navigation is centralized in `src/shared/settingsNavigation.ts`.
- Settings routes are generated from navigation items in `src/renderer/settings/main.ts`.
- `system.openSettings` only accepts `SettingsRouteNameSchema`.
- MCP install deeplinks currently open Settings and send `DEEPLINK_EVENTS.MCP_INSTALL`.
- Plugin settings currently call `plugins.invokeAction({ actionId: 'settings.open' })`, which opens a per-plugin BrowserWindow.
- Remote channels already expose `RemoteChannelDescriptor`, status, settings, bindings and pairing through typed routes.

## Proposed Main Route Structure

```text
src/renderer/src/router/index.ts
├── /chat
├── /welcome
└── /plugins
    ├── tab=plugins or child /plugins
    ├── /plugins/skills
    ├── /plugins/mcp
    ├── /plugins/remote
    ├── /plugins/official/:pluginId
    └── /plugins/remote/:channel
```

Implementation can use nested Vue routes or one `/plugins` route with internal tab state. The URL must be shareable enough for internal navigation and redirects:

| Target | Required addressable route |
| --- | --- |
| Plugins catalog | `/plugins` |
| Skills | `/plugins/skills` |
| MCP | `/plugins/mcp` |
| Remote list | `/plugins/remote` |
| Official plugin detail | `/plugins/official/:pluginId` |
| Remote channel detail | `/plugins/remote/:channel` |

## Proposed Information Architecture

Top-level sections:

| Section | User label | Contents |
| --- | --- | --- |
| Plugins | Plugins | official plugin packages, added/recommended plugin cards, Remote virtual plugin cards when filtered into plugin catalog |
| Skills | Skills | installed skills, install, edit, sync import/export, draft suggestion toggle |
| MCP | MCP Servers | user MCP servers, plugin-owned MCP status, MCP market/add flow |
| Remote | Remote | virtual plugin cards for Telegram, Feishu/Lark Remote, QQBot, Discord, WeChat iLink |

The visual top tab row can start with `Plugins` and `Skills` as in the Codex screenshot, then add `MCP` and `Remote` if all four areas ship in the same increment. If product wants the screenshot to stay visually lighter, `MCP` and `Remote` can appear as catalog filters/cards inside `Plugins`, but they still need addressable routes.

Remote naming must avoid collision with official plugins:

| Existing item | Display name in Plugins |
| --- | --- |
| `com.deepchat.plugins.feishu` official plugin | `Feishu/Lark Integration` |
| `remote:feishu` virtual plugin | `Feishu/Lark Remote` |
| `remote:telegram` virtual plugin | `Telegram Remote` |

## Main Window Plugins UX

### Desktop Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ AppBar                                                                       │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ New Chat      │  [Plugins] [Skills] [MCP] [Remote]                  +  ↻    │
│ Search        │                                                              │
│ Plugins       │                         Plugins                             │
│               │          Work with DeepChat across your favorite tools       │
│ Pinned        │          ┌────────────────────────────────────────────┐      │
│ ...           │          │ Search plugins, skills, MCP servers...     │      │
│ Projects      │          └────────────────────────────────────────────┘      │
│ ...           │                                                              │
│ Settings      │          Added                                      Manage   │
│               │          [CUA] [Feishu] [Telegram] [Skill pack]              │
│               │                                                              │
│               │          Featured                                           │
│               │          Computer Use        Add       Chrome        Add     │
│               │          Spreadsheets        ...       Presentations ...     │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

### Detail Route Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ AppBar                                                                       │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ New Chat      │  [Plugins] [Skills] [MCP] [Remote]                          │
│ Search        │  ← Back to Plugins                                           │
│ Plugins       │  Telegram Remote                                      on/off │
│               │  Status: running · bindings: 2 · last error: none            │
│ Pinned        │                                                              │
│ ...           │  ┌ Credentials ────────────────────────────────────────────┐ │
│ Settings      │  │ Bot token / app credentials                            │ │
│               │  └─────────────────────────────────────────────────────────┘ │
│               │  ┌ Remote Control ────────────────────────────────────────┐ │
│               │  │ Default agent · Default workdir · Pairing              │ │
│               │  └─────────────────────────────────────────────────────────┘ │
│               │  ┌ Bindings ──────────────────────────────────────────────┐ │
│               │  │ Existing chats/channels and remove actions             │ │
│               │  └─────────────────────────────────────────────────────────┘ │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

### Narrow Main Window Layout

At constrained widths, keep the same app shell and avoid modal navigation:

```text
┌────────────────────────────────────┐
│ AppBar                             │
├────┬───────────────────────────────┤
│ AI │ [Plugins][Skills][MCP]        │
│ .. │ [Remote]                      │
│    ├───────────────────────────────┤
│    │ Search                        │
│    │                               │
│    │ Card list / Detail page       │
│    │                               │
└────┴───────────────────────────────┘
```

Narrow behavior:

- If sidebar is collapsed, it stays collapsed.
- Section navigation becomes a wrapped horizontal tab row.
- Detail pages keep a top back button.
- Long tokens, paths and errors must truncate with tooltip or wrap in a controlled block.
- Forms use one column.

## Sidebar UX

### Target Expanded Shape

```text
┌────┬──────────────────────────────┐
│ AI │ 所有 Agents                  │
│    │                              │
│    │ ┌──────────────────────────┐ │
│    │ │ ✎ New Chat          ⌘N   │ │
│    │ │ 🔍 Search           ⌘P   │ │
│    │ │ ⌘ Plugins                │ │
│    │ └──────────────────────────┘ │
│    │                              │
│    │ 置顶会话                    │
│    │ ...                          │
└────┴──────────────────────────────┘
```

Notes:

- `New Chat` starts a new conversation through the existing session store path and navigates to `/chat` if needed.
- `Search` opens existing Spotlight/search behavior; it is not a second search implementation.
- `Plugins` routes the current main window to `/plugins`.
- Shortcut badges display only for existing registered shortcuts. Do not add a new shortcut just to fill the badge.
- The existing collapsed rail stays visually and behaviorally unchanged.
- The existing Agent icon rail remains the collapsed-state affordance; no new collapsed Plugins icon is added.
- The group-mode toggle and new-chat plus button in the old header should not remain as competing primary actions in expanded mode. Group mode can move near the session list header or stay as a compact secondary control.

### Collapsed Shape

Collapsed state remains current:

```text
┌────┐
│ ◎  │ all agents / agent icons
│ .. │
│ 🔍 │ existing search affordance
│ .. │ existing status/theme/sidebar/settings affordances
└────┘
```

## Settings UX

Settings remains for system/model/account/data preferences:

```text
Settings
├── Overview
├── Common
├── Display
├── Environments
├── Providers
├── DeepChat Agents
├── ACP
├── Notifications / Hooks
├── Scheduled Tasks
├── Prompt
├── Memory
├── Knowledge Base
├── Database
├── Shortcuts
└── About
```

Removed from visible Settings navigation:

- MCP
- Remote
- Plugins
- Skills

Compatibility behavior:

- Existing internal settings routes can remain hidden during migration.
- Direct navigation to removed route names should focus the main window and route to the matching `/plugins...` page when possible.
- Settings Overview search should not list hidden Plugins-owned entries.
- Settings activity records can keep historical `routeName` values; opening them should redirect to Plugins when the route is now Plugins-owned.

## Acceptance Criteria

### Main Window Route

- `/plugins` renders inside the existing main app shell and keeps `WindowSideBar` visible.
- Opening Plugins from the main sidebar navigates the current main window to `/plugins`.
- No new Plugins BrowserWindow is created.
- No new `src/renderer/plugins` renderer entry is added.
- `AppBar`, sidebar, theme, language direction and global overlays continue to work.
- The page has stable responsive behavior and remains usable at narrow widths.
- User-facing strings use i18n keys.

### Official Plugins

- Official plugin list keeps enable/disable/status behavior.
- Plugin-owned MCP errors remain visible.
- Opening an official plugin settings/detail uses `/plugins/official/:pluginId`, not Settings and not a per-plugin BrowserWindow.
- CUA detail includes runtime/MCP status, permission checks and permission guide actions.
- Feishu/Lark Integration detail distinguishes MCP/Skill integration from Feishu/Lark Remote control.
- Legacy `settings.open` plugin action is not used as the primary UI path after migration.

### MCP

- MCP global enablement, server list, add/edit, market view and NPM registry controls remain available from Plugins.
- Plugin-owned MCP servers remain read-only where their owning plugin controls lifecycle.
- MCP install deeplinks focus the main window and route to `/plugins/mcp` instead of opening Settings.

### Skills

- Installed Skills list, search, install, edit, delete, sync import/export and draft suggestion toggle remain available from Plugins.
- First-launch sync prompt remains available if it is still part of the current product flow.
- Skill drag/drop and URL/zip/folder install behavior remains unchanged.

### Remote

- Every implemented `RemoteChannelDescriptor` appears as a Remote virtual plugin card.
- Each card shows enabled state, runtime state, binding/pairing summary and last error when present.
- Each card opens `/plugins/remote/:channel`.
- Channel settings preserve current behavior:
  - credentials
  - enable/disable
  - default agent
  - default workdir
  - pairing
  - bindings/principals
  - channel-specific login/account controls for WeChat iLink
- Saving a channel setting still uses `remoteControl.saveChannelSettings`.
- Remote status indicator in the main sidebar continues to work.

### Main Sidebar

- Expanded sidebar shows `New Chat`, `Search`, `Plugins` before pinned sessions.
- `所有 Agents` remains visible.
- Collapsed sidebar keeps current visual shape and behavior.
- No new collapsed icon button is added.
- Session list pagination, pinned section, project grouping, drag reorder and keyboard shortcut badges continue working.

### Settings Removal

- Settings sidebar no longer shows MCP, Remote, Plugins or Skills.
- Settings Overview search no longer returns MCP, Remote, Plugins or Skills as settings pages.
- Settings Overview no longer uses MCP as one of the primary system metrics or quick-start tasks.
- Existing app code that opens `settings-mcp`, `settings-remote`, `settings-plugins` or `settings-skills` is migrated or redirected to `/plugins...`.

## Platform and Accessibility Requirements

- Keyboard navigation works across top tabs, search, card list, detail forms and back navigation.
- `Esc` closes transient dialogs only; it does not leave `/plugins`.
- `Tab` order follows visual order.
- Buttons and icon-only controls have accessible labels.
- Status colors are not the only status signal; labels must remain visible.
- Long file paths, tokens, error strings and command lines do not overflow their container.
- Remote credentials remain password inputs by default, preserving current reveal behavior.
- Linux and Windows backgrounds must not rely on macOS-only materials.
- RTL languages should inherit existing app i18n direction handling.

## Open Questions

None.
