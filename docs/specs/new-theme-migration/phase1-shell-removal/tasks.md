# Phase 1: Shell 架构移除 - 任务分解

## 任务清单

### 1. 分析 Shell 依赖关系

**任务**: 全面分析 Shell 层的代码依赖

**详情**:
- [ ] 全局搜索所有引用 `shell`、`Shell`、`shell-window` 的代码
- [ ] 列出所有依赖 Shell 的 Presenter 和组件
- [ ] 识别 `createShellWindow` 的所有调用点
- [ ] 记录 BrowserToolbar 的依赖关系

**输出**: 依赖关系清单文档

**验收**:
- [ ] 完整的引用列表
- [ ] 每个引用都有处理方案（迁移/删除/替代）

---

### 2. 修改 windowPresenter - 添加新窗口创建方法

**任务**: 在 windowPresenter 中实现 `createChatWindow` 和 `createBrowserWindow`

**详情**:
- [ ] 添加 `createChatWindow(options?)` 方法
  - 加载 `local://chat`
  - 设置合适的默认尺寸
  - 存储窗口类型为 'chat'
- [ ] 添加 `createBrowserWindow(options?)` 方法
  - 加载 `local://browser`
  - 设置合适的默认尺寸
  - 存储窗口类型为 'browser'
- [ ] 标记 `createShellWindow` 为废弃（或保留内部兼容）

**文件**: `src/main/presenter/windowPresenter/index.ts`

**验收**:
- [ ] 两个新方法能成功创建窗口
- [ ] 窗口加载正确的 URL
- [ ] 单元测试通过

---

### 3. 修改 windowCreationHook - 使用新的创建方法

**任务**: 更新生命周期钩子，使用 `createChatWindow`

**详情**:
- [ ] 修改 `windowCreationHook.ts`
- [ ] 将 `createShellWindow` 调用改为 `createChatWindow`
- [ ] 确保初始 tab 参数正确传递

**文件**: `src/main/presenter/lifecyclePresenter/hooks/after-start/windowCreationHook.ts`

**验收**:
- [ ] 应用启动时成功创建 Chat 窗口
- [ ] 窗口显示正确的内容

---

### 4. 修改 YoBrowserPresenter - 使用新的创建方法

**任务**: 更新 YoBrowserPresenter，使用 `createBrowserWindow`

**详情**:
- [ ] 修改 `ensureWindow()` 方法
- [ ] 将 `createShellWindow({ windowType: 'browser' })` 改为 `createBrowserWindow()`
- [ ] 确保窗口位置计算逻辑正常工作

**文件**: `src/main/presenter/browser/YoBrowserPresenter.ts`

**验收**:
- [ ] 调用 YoBrowser 时成功创建 Browser 窗口
- [ ] 窗口位置相对于参考窗口正确计算

---

### 5. 移除 Shell 渲染进程代码

**任务**: 删除 `src/renderer/shell/` 目录及其内容

**详情**:
- [ ] 删除 `src/renderer/shell/App.vue`
- [ ] 删除 `src/renderer/shell/components/AppBar.vue`
- [ ] 删除 `src/renderer/shell/components/AppBarTabItem.vue`
- [ ] 删除 `src/renderer/shell/components/BrowserToolbar.vue`
- [ ] 删除 `src/renderer/shell/components/BrowserPlaceholder.vue`
- [ ] 删除 `src/renderer/shell/main.ts`
- [ ] 删除 `src/renderer/shell/index.html`
- [ ] 删除 `src/renderer/shell/stores/tab.ts`

**验收**:
- [ ] 目录完全删除
- [ ] 应用仍能正常编译

---

### 6. 清理 Shell 相关 IPC 和事件

**任务**: 移除与 Shell 相关的 IPC 通信

**详情**:
- [ ] 移除 `shell:chrome-height` IPC 事件处理
- [ ] 清理 `SHELL_EVENTS` 事件常量
- [ ] 检查并清理 `window.api.getWindowId` 相关代码

**文件**:
- `src/main/presenter/windowPresenter/index.ts`
- `src/preload/index.ts`（如有必要）

**验收**:
- [ ] 无 Shell 相关 IPC 残留
- [ ] 窗口创建和关闭不受影响

---

### 7. 更新 TabPresenter（如需要）

**任务**: 检查 TabPresenter 是否需要调整

**详情**:
- [ ] 检查 TabPresenter 是否依赖 Shell 层
- [ ] 如有必要，调整 WebContentsView 管理逻辑
- [ ] 确保 Tab 生命周期管理正常工作

**文件**: `src/main/presenter/tabPresenter.ts`

**验收**:
- [ ] Tab 创建和关闭正常工作
- [ ] 多 Tab 场景正常（如适用）

---

### 8. 清理全局引用

**任务**: 清理代码中所有对 Shell 的引用

**详情**:
- [ ] 检查 `src/main/` 下的所有文件
- [ ] 检查 `src/preload/` 下的所有文件
- [ ] 检查 `src/shared/` 下的类型定义
- [ ] 更新或删除相关类型定义

**验收**:
- [ ] 全局搜索 "shell" 无业务代码引用（排除文档、注释）
- [ ] 类型检查通过

---

### 9. 运行代码质量检查

**任务**: 确保代码质量

**详情**:
```bash
pnpm run format
pnpm run lint
pnpm run typecheck
```

**验收**:
- [ ] 格式化无问题
- [ ] Lint 无错误
- [ ] 类型检查通过

---

### 10. 执行测试套件

**任务**: 运行自动化测试

**详情**:
```bash
pnpm test:main
```

**验收**:
- [ ] 所有现有测试通过
- [ ] 新增测试通过（如添加了单元测试）

---

### 11. 手动验收测试

**任务**: 手动验证功能

**详情**:
- [ ] 启动应用，验证 Chat 窗口显示正常
- [ ] 验证窗口可以正常关闭
- [ ] 验证多窗口创建正常
- [ ] 验证 YoBrowser 窗口创建正常（功能可能不完整）
- [ ] 验证窗口状态保存和恢复

**验收**:
- [ ] 所有手动测试项通过

---

## Phase 1 验收标准

Phase 1 完成的标准：

1. **代码层面**
   - [ ] `src/renderer/shell/` 目录已删除
   - [ ] `createShellWindow` 方法已移除或标记废弃
   - [ ] `createChatWindow` 和 `createBrowserWindow` 工作正常
   - [ ] 无 Shell 相关代码残留

2. **功能层面**
   - [ ] 应用启动创建 Chat 窗口
   - [ ] YoBrowser 创建 Browser 窗口
   - [ ] 窗口生命周期管理正常

3. **质量层面**
   - [ ] `pnpm run format` 通过
   - [ ] `pnpm run lint` 通过
   - [ ] `pnpm run typecheck` 通过
   - [ ] `pnpm test:main` 通过

4. **文档层面**
   - [ ] 如有重大架构变化，更新相关文档

---

## 进入 Phase 2 的前置条件

- [ ] Phase 1 所有任务完成
- [ ] Phase 1 所有验收标准满足
- [ ] 代码审查通过
