<!-- ade25e89-de32-4445-87ab-5c1902035305 6af3052c-b49a-4c31-87b3-4ef6d8a00436 -->
# 修复设置项实时生效问题

## 问题分析

经过全面检查，发现以下设置项存在问题：

### 缺少事件触发的设置项

1. **`setSearchPreviewEnabled`** - 没有触发事件，只调用了 `setSetting`
2. **`setNotificationsEnabled`** - 没有触发事件，只调用了 `setSetting`

### 缺少事件监听器的设置项

3. **`syncEnabled` / `syncFolderPath`** - 有事件 `SYNC_SETTINGS_CHANGED`，但 `sync.ts` store 中没有监听器
4. **`floatingButtonEnabled`** - 有事件但发送到 main（`FLOATING_BUTTON_EVENTS.ENABLED_CHANGED`），不是 renderer，`floatingButton.ts` store 中没有监听器

### 已确认正常的设置项

- ✅ `contentProtectionEnabled` - 有事件和监听器
- ✅ `copyWithCotEnabled` - 有事件和监听器
- ✅ `traceDebugEnabled` - 有事件和监听器
- ✅ `fontSizeLevel` - 有事件和监听器（在 setSetting 中特殊处理）
- ✅ `soundEnabled` - 有事件和监听器（在 sound.ts store 中）
- ✅ `language` - 有事件和监听器（在 language.ts store 中）
- ✅ `themeMode` - 有事件和监听器（在 theme.ts store 中）

### 不需要实时更新的设置项（可能）

- `updateChannel` - 没有触发事件（可能不需要实时更新）
- `shortcutKey` - 没有触发事件（可能不需要实时更新）
- `closeToQuit` - 没有触发事件（可能不需要实时更新）
- `loggingEnabled` - 没有触发事件，但会重启应用（可能不需要实时更新）

## 修复方案

### 1. 添加缺失的事件定义

在 `src/main/events.ts` 和 `src/renderer/src/events.ts` 的 `CONFIG_EVENTS` 中添加：

- `SEARCH_PREVIEW_CHANGED: 'config:search-preview-changed'`
- `NOTIFICATIONS_CHANGED: 'config:notifications-changed'`

### 2. 修复 configPresenter 中的设置方法

在 `src/main/presenter/configPresenter/index.ts` 中：

- **`setSearchPreviewEnabled`** - 添加事件触发：
  ```typescript
  setSearchPreviewEnabled(enabled: boolean): void {
    const boolValue = Boolean(enabled)
    this.setSetting('searchPreviewEnabled', boolValue)
    eventBus.sendToRenderer(CONFIG_EVENTS.SEARCH_PREVIEW_CHANGED, SendTarget.ALL_WINDOWS, boolValue)
  }
  ```

- **`setNotificationsEnabled`** - 添加事件触发：
  ```typescript
  setNotificationsEnabled(enabled: boolean): void {
    this.setSetting('notificationsEnabled', enabled)
    eventBus.sendToRenderer(CONFIG_EVENTS.NOTIFICATIONS_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }
  ```


### 3. 在 settings.ts 中添加事件监听器

在 `src/renderer/src/stores/settings.ts` 中：

- 添加 `setupSearchPreviewListener` 监听 `CONFIG_EVENTS.SEARCH_PREVIEW_CHANGED`
- 添加 `setupNotificationsListener` 监听 `CONFIG_EVENTS.NOTIFICATIONS_CHANGED`
- 在 `initSettings` 中调用这两个监听器设置方法
- 确保 `setupFontSizeListener` 在 `initSettings` 中被调用（目前可能缺失）

### 4. 在 sync.ts 中添加事件监听器

在 `src/renderer/src/stores/sync.ts` 中：

- 添加 `setupSyncSettingsListener` 监听 `CONFIG_EVENTS.SYNC_SETTINGS_CHANGED`
- 在事件处理中更新 `syncEnabled` 和 `syncFolderPath` 状态
- 在 `initialize` 中调用监听器设置方法

### 5. 在 floatingButton.ts 中添加事件监听器（可选）

在 `src/renderer/src/stores/floatingButton.ts` 中：

- 如果需要在 renderer 中实时更新，需要：

  1. 在 `src/main/events.ts` 中添加 `FLOATING_BUTTON_ENABLED_CHANGED` 事件（发送到 renderer）
  2. 修改 `configPresenter.setFloatingButtonEnabled` 同时发送到 renderer
  3. 在 `floatingButton.ts` 中添加事件监听器

- 或者保持现状（只在 main 中处理，不需要 renderer 实时更新）

### 6. 修复 searchEngines 数组为空的问题

在 `src/renderer/src/stores/searchEngineStore.ts` 中：

- **问题**：`setupSearchEnginesListener` 函数缺少左大括号 `{`（第 56 行），导致语法错误，可能影响整个 store 的初始化
- **修复**：添加缺失的大括号，确保函数语法正确
- **检查**：确保 `initialize()` 方法被正确调用，并且 `refreshSearchEngines()` 能正确加载搜索引擎列表
- **验证**：确保 `searchEngines` 数组在初始化后不为空，搜索引擎下拉选单能正常显示

### 7. 验证所有设置项的实时更新

逐个测试以下设置项：

- `searchPreviewEnabled` - 修复后测试
- `notificationsEnabled` - 修复后测试
- `syncEnabled` / `syncFolderPath` - 修复后测试
- `searchEngines` - 修复后测试，确保数组不为空，下拉选单正常显示
- `contentProtectionEnabled` - 确认正常工作
- `copyWithCotEnabled` - 确认正常工作
- `traceDebugEnabled` - 确认正常工作
- `fontSizeLevel` - 确认正常工作
- `themeMode` - 确认正常工作
- `soundEnabled` - 确认正常工作
- `language` - 确认正常工作

## 实施步骤

1. 在 `src/main/events.ts` 和 `src/renderer/src/events.ts` 中添加缺失的事件定义
2. 修复 `configPresenter` 中的 `setSearchPreviewEnabled` 和 `setNotificationsEnabled` 方法
3. 在 `settings.ts` 中添加缺失的事件监听器
4. 验证所有设置项的实时更新功能
5. 测试跨窗口设置同步（如果有多个窗口）

## 注意事项

- 确保事件名称在 main 和 renderer 中保持一致
- 确保事件监听器在 store 初始化时正确设置
- 如果使用 Colada，考虑是否需要同时支持事件监听和 query 刷新两种方式

### To-dos

- [ ] 在 src/main/events.ts 和 src/renderer/src/events.ts 中添加 SEARCH_PREVIEW_CHANGED 和 NOTIFICATIONS_CHANGED 事件定义
- [ ] 修复 configPresenter 中的 setSearchPreviewEnabled 方法，添加事件触发
- [ ] 修复 configPresenter 中的 setNotificationsEnabled 方法，添加事件触发
- [ ] 在 settings.ts 中添加 setupSearchPreviewListener 和 setupNotificationsListener，并在 initSettings 中调用，确保 setupFontSizeListener 也被调用
- [ ] 在 sync.ts 中添加 setupSyncSettingsListener 监听 SYNC_SETTINGS_CHANGED 事件，更新 syncEnabled 和 syncFolderPath 状态
- [ ] 验证所有设置项（searchPreview, notifications, sync, contentProtection, copyWithCot, traceDebug, fontSize, theme, sound, language）的实时更新功能