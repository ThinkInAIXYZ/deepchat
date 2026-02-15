# Phase 1: Shell 架构移除 - 实现计划

## 架构决策

### 决策 1: 直接创建内容窗口

**背景**: 当前通过 `createShellWindow` 创建带 Shell 包装的窗口。

**决策**: 移除 `createShellWindow`，改为直接创建 Chat 窗口或 Browser 窗口。

**实现**:
```typescript
// 新的窗口创建方法
async createChatWindow(options?: WindowOptions): Promise<number>
async createBrowserWindow(options?: WindowOptions): Promise<number>
```

**理由**:
- Shell 层不再必要，直接简化架构
- Chat 和 Browser 窗口的职责更清晰

### 决策 2: BrowserToolbar 临时保留策略

**背景**: BrowserToolbar 当前在 Shell 中，但 Phase 4 才迁移到 Browser 页面内。

**决策**: Phase 1 暂时移除 BrowserToolbar 功能，Phase 4 重新实现。

**理由**:
- 避免中间状态的复杂性
- Browser 功能在此阶段暂时不可用是可接受的（或作为已知问题）

### 决策 3: 窗口类型标识保留

**背景**: 需要区分 Chat 窗口和 Browser 窗口。

**决策**: 在窗口创建选项中保留 `windowType` 字段，存储在窗口元数据中。

```typescript
interface WindowOptions {
  windowType?: 'chat' | 'browser'
  // ... 其他选项
}
```

## 涉及的 Presenters

### windowPresenter
- **改动**: 移除 `createShellWindow`，添加 `createChatWindow` 和 `createBrowserWindow`
- **文件**: `src/main/presenter/windowPresenter/index.ts`

### YoBrowserPresenter
- **改动**: `ensureWindow()` 改为调用 `createBrowserWindow`
- **文件**: `src/main/presenter/browser/YoBrowserPresenter.ts`

### lifecyclePresenter
- **改动**: `windowCreationHook` 改为调用 `createChatWindow`
- **文件**: `src/main/presenter/lifecyclePresenter/hooks/after-start/windowCreationHook.ts`

## 事件流变化

### 移除的事件
- `shell:chrome-height` IPC 事件（Shell 层移除后不再需要）

### 保留的事件
- 窗口生命周期事件（`window-created`, `window-closed` 等）
- Tab 相关事件（通过 TabPresenter 继续工作）

## IPC 接口变化

### Preload 层
无需改动，窗口创建对 renderer 透明。

### Main Process
内部方法签名变化：
```typescript
// 移除
- createShellWindow(options: ShellWindowOptions): Promise<number>

// 添加
+ createChatWindow(options?: WindowOptions): Promise<number>
+ createBrowserWindow(options?: WindowOptions): Promise<number>
```

## 数据模型

### 窗口状态存储
窗口状态（大小、位置）继续通过 Electron Store 存储，key 保持不变。

```typescript
// 窗口状态结构保持不变
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
  // 新增：窗口类型用于恢复时判断
  windowType?: 'chat' | 'browser'
}
```

## 测试策略

### 单元测试

#### windowPresenter 测试
- 测试 `createChatWindow` 正确创建窗口
- 测试 `createBrowserWindow` 正确创建窗口
- 测试窗口状态保存和恢复
- 测试窗口关闭清理

#### YoBrowserPresenter 测试
- 测试 `ensureWindow` 调用新的创建方法
- 测试浏览器窗口生命周期

### 集成测试

#### 窗口创建流程
1. 应用启动 → Chat 窗口创建
2. 调用 YoBrowser → Browser 窗口创建
3. 多窗口并发创建

#### 回归测试
1. 窗口关闭后重新打开
2. 窗口最大化/最小化/恢复
3. 多显示器环境下的窗口位置

### 手动测试
- [ ] macOS 窗口拖动区域正常工作
- [ ] Windows/Linux 窗口边框和标题栏正常
- [ ] 深色/浅色主题切换正常

## 迁移考虑

### 用户影响
- **可见变化**: 窗口外观无 Shell 包装，更简洁
- **功能影响**: Browser 功能暂时不可用（等待 Phase 4）
- **数据安全**: 用户配置和会话数据完全保留

### 回滚策略
如出现问题，回滚到上一版本即可恢复 Shell 架构。

## 文件变更清单

### 修改的文件
1. `src/main/presenter/windowPresenter/index.ts`
2. `src/main/presenter/browser/YoBrowserPresenter.ts`
3. `src/main/presenter/lifecyclePresenter/hooks/after-start/windowCreationHook.ts`
4. `src/main/presenter/tabPresenter.ts`（可能需要调整 WebContentsView 管理）

### 删除的文件/目录
1. `src/renderer/shell/` 整个目录
2. `src/renderer/shell/App.vue`
3. `src/renderer/shell/components/AppBar.vue`
4. `src/renderer/shell/components/AppBarTabItem.vue`
5. `src/renderer/shell/components/BrowserToolbar.vue`
6. `src/renderer/shell/components/BrowserPlaceholder.vue`

### 需要检查引用的文件
- 全局搜索 `"shell"`、`"Shell"`、`shell-window` 等引用
- 确保所有引用都已处理

## 性能考虑

- 移除 Shell 层减少了一个渲染进程层级，理论上略有性能提升
- WebContentsView 管理需要确保没有内存泄漏

## 安全考虑

- 无安全敏感改动
- 窗口创建逻辑保持原有安全边界
