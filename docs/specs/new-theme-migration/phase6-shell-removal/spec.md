# Phase 6: Shell & Tab Removal (Window-Only Architecture)

## Overview

本阶段不再采用“单窗口多 Tab”模型，目标改为：

1. 移除 `src/renderer/shell/`（含 shell 入口与 shell UI）
2. 移除 Tab 作为运行时核心概念（`TabPresenter` / `tabId` 绑定）
3. 统一为 **Window-Only** 架构：每个窗口只承载一个独立 WebContents 视图
4. YoBrowser 改为 **单窗口、单视图**（不再维护浏览器内部 tab 列表）

最终形态：
- 聊天是聊天窗口
- 设置是设置窗口
- YoBrowser 是单独浏览器窗口
- 不再有“窗口内 Tab 切换”

## Scope

### In Scope
- 移除 shell 目录与构建入口
- 主进程从 `tabId` 迁移到 `windowId/webContentsId` 语义
- `SessionPresenter/ThreadPresenter` 会话激活逻辑去 Tab 化
- YoBrowser tab 模型简化为单页面模型
- 事件系统中 Tab 相关事件与快捷键清理

### Out of Scope
- 重新设计聊天 UI（Phase 1-5 已完成）
- 重写核心 agent 生成链路
- 修改数据库 conversation/message schema（本阶段尽量不改表结构）

## Current Problems

当前实现中 Tab 是中枢概念，导致耦合面很大：

- `src/main/presenter/tabPresenter.ts`
- `src/main/presenter/sessionPresenter/tab/tabManager.ts`
- `src/main/presenter/sessionPresenter/index.ts`（大量 `tabId` 参数）
- `src/shared/types/presenters/thread.presenter.d.ts` 与 `session.presenter.d.ts`（接口层强依赖 `tabId`）
- `src/main/presenter/browser/YoBrowserPresenter.ts`（依赖 tab 创建/切换）
- `src/renderer/shell/**` 与 `electron.vite.config.ts` 的 shell entry

这使得窗口、会话、浏览器三套系统通过 Tab 相互牵连，维护和演进成本高。

## Target Architecture

## 1) Window as the only container

- 一个窗口只对应一个渲染上下文
- 不在窗口内管理多个 WebContentsView
- 需要并行会话时，直接创建新窗口，而不是新 Tab

## 2) Session binding uses windowId

- 活动会话绑定 `windowId`（或 `webContentsId` -> `windowId`）
- 删除 `tabId -> session` 双向映射
- `openConversationInNewTab` 语义替换为 `openConversationInNewWindow`

## 3) YoBrowser single-window model

- YoBrowser 保留一个浏览器窗口
- 窗口内只有一个页面上下文（当前 URL）
- `createTab/activateTab/closeTab` API 改为 `navigate/show/hide/reload/goBack/goForward`

## 4) Renderer entry simplification

- 只保留 `src/renderer/index.html`（主窗口）
- `settings/index.html`、`floating/index.html`、`splash/index.html` 继续按需保留
- 删除 `shell/index.html` 与 `shell/tooltip-overlay/index.html` 入口

## Migration Strategy

采用分阶段迁移，避免一次性大爆炸。

### Stage A: Contract migration (Tab -> Window)

- 在 shared presenter 类型层引入 window-only 接口（兼容期可保留旧接口别名）
- `SessionPresenter` 内部先支持 `windowId` 路径
- 新增窗口语义方法，旧 tab 方法标注 deprecated

### Stage B: Main process decoupling

- `WindowPresenter` 去除 create/switch/close tab 分支
- 关闭 `SHORTCUT_EVENTS.CREATE_NEW_TAB` / tab switch 快捷键
- `TAB_EVENTS` 停止对外广播

### Stage C: YoBrowser simplification

- `YoBrowserPresenter` 不再调用 `tabPresenter.createTab/switchTab`
- 改为直接在 browser window 的单视图导航
- `yoBrowser` store 从 `tabs[]` 改为 `currentPage`（可保留最近历史，但非 tab）

### Stage D: Shell deletion

- 删除 `src/renderer/shell/` 目录
- 删除 `electron.vite.config.ts` 中 shell 输入项与 `@shell` alias
- 清理残留 shell IPC：`shell:chrome-height`、`shell-tooltip:*`

### Stage E: Hard cleanup

- 删除 `TabPresenter` 与 `sessionPresenter/tab/*`
- 清理 `thread.presenter.d.ts` / `session.presenter.d.ts` 中 tab API
- 清理 MCP tools 中 `create_new_tab` 语义（提供兼容 alias 或迁移为 `create_new_window`）

## Impacted Modules

| Area | Files | Change |
|------|-------|--------|
| Build entry | `electron.vite.config.ts` | remove shell entry and alias |
| Shell UI | `src/renderer/shell/**` | delete |
| Window | `src/main/presenter/windowPresenter/index.ts` | window-only flow |
| Tab infra | `src/main/presenter/tabPresenter.ts`, `src/main/presenter/sessionPresenter/tab/*` | remove |
| Session binding | `src/main/presenter/sessionPresenter/index.ts` | replace tabId with windowId |
| Shared contracts | `src/shared/types/presenters/thread.presenter.d.ts`, `src/shared/types/presenters/session.presenter.d.ts`, `src/shared/types/presenters/legacy.presenters.d.ts` | API migration |
| Events | `src/main/events.ts`, `src/renderer/src/events.ts` | remove tab events/shortcuts |
| YoBrowser main | `src/main/presenter/browser/YoBrowserPresenter.ts` | single-window single-view |
| YoBrowser renderer | `src/renderer/src/stores/yoBrowser.ts` | remove tabs state |
| MCP tools (tab related) | `src/main/presenter/mcpPresenter/inMemoryServers/conversationSearchServer.ts` and related tools | migrate API semantics |

## API Migration (Target)

### Thread/Session API

- Remove `tabId` required parameters
- Prefer:
  - `createConversation(title, settings, windowId?)`
  - `setActiveConversation(conversationId, windowId)`
  - `getActiveConversation(windowId)`
  - `openConversationInNewWindow(payload)`

### YoBrowser API

- Remove:
  - `listTabs/createTab/activateTab/closeTab/reuseTab`
- Keep/Add:
  - `show/hide/toggleVisibility`
  - `navigate(url)`
  - `getCurrentPage()`
  - `goBack/goForward/reload`

## Acceptance Criteria

1. `src/renderer/shell/` 被完全删除，构建无 shell 入口
2. 运行时不再创建或切换任何应用内 tab
3. 会话激活/切换只依赖 window 语义
4. YoBrowser 在单窗口模型下可正常导航、后退前进、截图
5. `pnpm run typecheck && pnpm run lint && pnpm run build` 全通过

## Risk & Mitigation

### Risk 1: API breaking changes across main/renderer/shared
- Mitigation: 先引入兼容层，再删除旧 API

### Risk 2: MCP tool 行为回归（create_new_tab 等）
- Mitigation: 提供一版兼容命令映射，并记录弃用日志

### Risk 3: 快捷键行为变化引发用户困惑
- Mitigation: 在 release note 和设置页提示“Tab 快捷键已移除/替换”

## Rollback Plan

1. 恢复 `src/renderer/shell/` 与 build entries
2. 恢复 `TabPresenter` 与 `sessionPresenter/tab/*`
3. 恢复 thread/session shared contracts 中 tab API
4. 恢复 YoBrowser tab 模型
