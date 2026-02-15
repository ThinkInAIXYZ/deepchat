# Phase 1: Shell 架构移除 - 需求规格说明书

## 用户故事

作为 DeepChat 用户，我希望应用使用更简洁的窗口架构，以便获得更流畅的使用体验和更清晰的界面层次。

## 业务价值

- **简化架构**: 移除 Shell 中间层，减少渲染层级，提升性能
- **明确职责**: 窗口直接承载内容，不再通过 Shell 包装管理
- **为后续功能铺路**: 新的 WindowSideBar 需要直接在内容窗口中渲染

## 现状分析

当前架构使用 ShellWindow 作为容器：
- ShellWindow 包含 AppBar（标签栏）、BrowserToolbar（浏览器工具栏）
- ShellWindow 内部通过 WebContentsView 加载 Chat 或 Browser 内容
- 窗口创建通过 `windowPresenter.createShellWindow()` 完成

目标架构：
- Chat 窗口直接加载 `local://chat`，不再经过 Shell 层
- Browser 窗口直接加载 `local://browser`，地址栏整合在页面内
- 移除所有 Shell 相关代码

## 验收标准

### 功能性标准

1. **窗口创建**
   - [ ] 应用启动时创建 Chat 窗口（`local://chat`），而非 ShellWindow
   - [ ] YoBrowser 调用时创建 Browser 窗口（`local://browser`），而非 ShellWindow
   - [ ] Chat 窗口和 Browser 窗口能正常显示和关闭

2. **Shell 层移除**
   - [ ] `src/renderer/shell/` 目录及其内容被完全删除
   - [ ] 所有引用 shell 组件的代码被清理或更新
   - [ ] 不再存在 `createShellWindow` 方法

3. **窗口尺寸与布局**
   - [ ] Chat 窗口内容区域占满整个窗口（无 shell chrome）
   - [ ] Browser 窗口内容区域占满整个窗口
   - [ ] 移除 chrome height 相关的 IPC 通信

4. **兼容性**
   - [ ] 现有用户配置和数据不受影响
   - [ ] 窗口状态（大小、位置）正常保存和恢复

### 非功能性标准

- [ ] 窗口启动时间不比原来慢（可接受 ±10% 偏差）
- [ ] 内存占用不显著增加

## 非目标（明确不做）

1. **不改动 Chat 页面内容**: Phase 1 只改动窗口创建和 Shell 移除，Chat 页面内部保持不变
2. **不改动 Browser 页面内容**: Phase 1 保留 Browser 页面现状，地址栏迁移到 Phase 4
3. **不引入新功能**: 不添加新的 WindowSideBar 或 NewThread 功能
4. **不改改动窗口管理逻辑**: 多窗口创建、窗口间通信等逻辑保持不变

## 开放问题

1. **Shell 的 BrowserToolbar 如何处理？**
   - 决定: BrowserToolbar 随 Shell 一起移除，Phase 4 会在 Browser 页面内重新实现

2. **是否需要保留窗口类型标识？**
   - 决定: 需要，用于区分 Chat 窗口和 Browser 窗口，但不通过 Shell 传递

3. **窗口最小/最大尺寸限制是否需要调整？**
   - 决定: 保持现有尺寸限制，后续根据新 UI 需求再调整

## 界面变化

### Before
```
┌─────────────────────────────────────┐
│  AppBar (Tab Bar)                   │  ← Shell Layer
├─────────────────────────────────────┤
│  BrowserToolbar (if browser)        │  ← Shell Layer
├─────────────────────────────────────┤
│                                     │
│  WebContentsView                    │  ← Chat/Browser Content
│  (local://chat or local://browser)  │
│                                     │
└─────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────┐
│                                     │
│  Chat View (WindowSideBar + Chat)   │  ← Direct content
│  or                                 │
│  Browser View (AddressBar + Web)    │  ← Direct content
│                                     │
└─────────────────────────────────────┘
```

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 窗口创建逻辑复杂，可能引入回归 | 高 | 全面测试窗口创建、关闭、多窗口场景 |
| Shell 代码耦合度高，清理容易遗漏 | 中 | 全局搜索 shell 引用，逐一确认 |
| BrowserToolbar 移除后浏览器无法使用 | 中 | Phase 4 优先实现，或在 Phase 1 保留临时方案 |

## 验收测试清单

- [ ] 启动应用，验证 Chat 窗口正常显示
- [ ] 通过快捷键/菜单打开 YoBrowser，验证 Browser 窗口正常显示
- [ ] 关闭并重新打开应用，验证窗口状态恢复
- [ ] 同时打开多个 Chat 窗口，验证各自独立工作
- [ ] 检查代码，`src/renderer/shell/` 目录不存在
- [ ] 全局搜索 "shell"，无相关残留引用（排除 node_modules 和文档）
- [ ] 运行 `pnpm run typecheck`，无类型错误
- [ ] 运行 `pnpm run lint`，无 lint 错误
