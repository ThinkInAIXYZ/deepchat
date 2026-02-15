# Phase 3: NewThread 三模式适配 - 任务分解

## 任务清单

### 1. 提取 useChatInput Composable

**任务**: 将 ChatInput 的核心逻辑提取为可复用的 composable

**详情**:
- [ ] 新建 `src/renderer/src/composables/useChatInput.ts`
- [ ] 提取以下逻辑:
  - 文本输入管理 (`text`, `setText`)
  - 图片/文件管理 (`images`, `addImage`, `removeImage`)
  - 粘贴处理 (`handlePaste`)
  - @提及处理 (`mentionQuery`, `mentionResults`)
  - 发送逻辑 (`sendMessage`)
  - 快捷键处理 (`handleKeydown`)
- [ ] 返回完整的输入状态和方法

**接口设计**:
```typescript
export function useChatInput(options?: UseChatInputOptions) {
  const text = ref('')
  const images = ref<ImageFile[]>([])
  const mentionQuery = ref('')
  const mentionResults = ref<MentionItem[]>([])
  
  const sendMessage = async () => { /* ... */ }
  const handlePaste = (event: ClipboardEvent) => { /* ... */ }
  const handleMention = (query: string) => { /* ... */ }
  const addImage = (file: File) => { /* ... */ }
  const removeImage = (index: number) => { /* ... */ }
  
  return {
    text,
    images,
    mentionQuery,
    mentionResults,
    sendMessage,
    handlePaste,
    handleMention,
    addImage,
    removeImage
  }
}
```

**验收**:
- [ ] Composable 可以独立使用
- [ ] 原有 ChatInput 可以用此 composable 重构
- [ ] 所有输入功能正常工作

---

### 2. 在 sidebarStore 添加 Session 管理

**任务**: 扩展 sidebarStore 支持 ACP Session 管理

**详情**:
- [ ] 修改 `src/renderer/src/stores/sidebar.ts`
- [ ] 添加 State:
  ```typescript
  currentSessionId: string | null
  sessionStatus: 'active' | 'destroyed' | 'none'
  reasoningEffort: 'low' | 'medium' | 'high'
  ```
- [ ] 添加 Actions:
  - `createSession()`: 调用 presenter 创建 session
  - `destroySession()`: 调用 presenter 销毁 session
  - `loadSessionStatus()`: 加载当前 session 状态
- [ ] 添加 Getters:
  - `canCreateSession`: 是否可以创建新 session
  - `canDestroySession`: 是否可以销毁当前 session

**验收**:
- [ ] Store 可以管理 session 状态
- [ ] session 操作调用正确的 presenter 方法

---

### 3. 暴露 ACP Session IPC 接口

**任务**: 确保 ACP Session 管理可以通过 IPC 调用

**详情**:
- [ ] 检查 `src/main/presenter/agentPresenter/acp/acpSessionManager.ts`
- [ ] 确认以下方法可以通过 presenter 访问:
  - `createSession(agentId: string)`
  - `destroySession(sessionId: string)`
  - `getCurrentSession(agentId: string)`
- [ ] 如有必要，更新 preload 层的类型定义

**验收**:
- [ ] Renderer 可以调用 session 管理方法
- [ ] 方法返回正确的结果

---

### 4. 创建 NewThreadChatInput 组件

**任务**: 实现新的 ChatInput UI 组件

**详情**:
- [ ] 新建 `src/renderer/src/components/newthread/ChatInput.vue`
- [ ] 使用 useChatInput composable
- [ ] 实现设计要求的 UI:
  - 大型输入框（占满可用空间）
  - 支持多行文本
  - 显示已添加的图片缩略图
  - @提及下拉提示
- [ ] 支持 props:
  ```typescript
  interface Props {
    placeholder?: string
    minHeight?: string
    maxHeight?: string
  }
  ```
- [ ] 支持 emits:
  ```typescript
  interface Emits {
    send: (content: { text: string, images: ImageFile[] }) => void
  }
  ```

**验收**:
- [ ] 组件 UI 符合设计
- [ ] 输入功能完整
- [ ] 图片粘贴和显示正常

---

### 5. 创建 AllModeView 组件

**任务**: 实现 All 模式视图

**详情**:
- [ ] 新建 `src/renderer/src/components/newthread/AllModeView.vue`
- [ ] 实现顶部 Tabs（Agent / ACP Agent）
- [ ] 实现 Agent Tab 内容:
  - ChatInput
  - 模型选择下拉
  - MCP 工具选择
- [ ] 实现 ACP Agent Tab 内容:
  - ACP Agent 选择器
  - ChatInput
  - Reasoning effort 下拉
- [ ] 根据当前 Tab 显示对应的底部选项

**验收**:
- [ ] Tabs 可以切换
- [ ] 每个 Tab 显示正确的内容
- [ ] 底部选项随 Tab 变化

---

### 6. 创建 AcpAgentModeView 组件

**任务**: 实现 ACP Agent 模式视图

**详情**:
- [ ] 新建 `src/renderer/src/components/newthread/AcpAgentModeView.vue`
- [ ] 实现顶部 Header:
  - 返回按钮（返回 All 模式）
  - Agent 名称和图标
- [ ] 实现 Session 状态显示
- [ ] 实现大型 ChatInput
- [ ] 实现底部选项栏:
  - Reasoning effort 下拉
  - "销毁当前 session" 按钮
  - "创建新 session" 按钮

**Props**:
```typescript
interface Props {
  agentId: string
}
```

**验收**:
- [ ] 显示正确的 Agent 信息
- [ ] Session 状态正确显示
- [ ] 底部按钮可用

---

### 7. 创建 SessionStatus 组件

**任务**: 实现 Session 状态显示组件

**详情**:
- [ ] 新建 `src/renderer/src/components/newthread/SessionStatus.vue`
- [ ] 根据 status 显示不同状态:
  - 'active': 显示 "Session: active"（绿色）
  - 'destroyed': 显示 "Session: destroyed"（灰色）
  - 'none': 显示 "No active session"（灰色）
- [ ] 显示 session ID（可选，截断显示）

**Props**:
```typescript
interface Props {
  status: 'active' | 'destroyed' | 'none'
  sessionId?: string
}
```

**验收**:
- [ ] 正确显示各种状态
- [ ] UI 美观

---

### 8. 创建 AcpOptionsBar 组件

**任务**: 实现 ACP Agent 底部选项栏

**详情**:
- [ ] 新建 `src/renderer/src/components/newthread/AcpOptionsBar.vue`
- [ ] 实现 Reasoning effort 下拉选择（low/medium/high）
- [ ] 实现 "销毁当前 session" 按钮
  - 点击显示确认对话框
  - 确认后调用 destroySession
- [ ] 实现 "创建新 session" 按钮
  - 调用 createSession
- [ ] 根据 sessionStatus 禁用/启用按钮

**Props**:
```typescript
interface Props {
  reasoningEffort: 'low' | 'medium' | 'high'
  sessionStatus: 'active' | 'destroyed' | 'none'
}
```

**Emits**:
```typescript
interface Emits {
  'update:reasoningEffort': (value: 'low' | 'medium' | 'high') => void
  'create-session': () => void
  'destroy-session': () => void
}
```

**验收**:
- [ ] Reasoning effort 选择工作
- [ ] Session 操作按钮工作
- [ ] 确认对话框显示正确

---

### 9. 创建 LocalModelModeView 组件

**任务**: 实现 Local Model 模式视图

**详情**:
- [ ] 新建 `src/renderer/src/components/newthread/LocalModelModeView.vue`
- [ ] 实现顶部 Header:
  - 返回按钮
  - 模型名称
- [ ] 实现大型 ChatInput
- [ ] 实现底部选项栏:
  - MCP 工具选择（多选）

**Props**:
```typescript
interface Props {
  modelId: string
}
```

**验收**:
- [ ] 显示正确的模型信息
- [ ] MCP 选择工作

---

### 10. 创建 NewThread 主容器组件

**任务**: 组装 NewThread 主组件

**详情**:
- [ ] 新建 `src/renderer/src/components/NewThread.vue`
- [ ] 导入并使用三个模式视图
- [ ] 根据 sidebarStore.currentMode 显示对应视图
- [ ] 处理模式切换

**验收**:
- [ ] 根据模式显示正确视图
- [ ] 模式切换正常工作

---

### 11. 修改 MiddleContent 使用 NewThread

**任务**: 更新 MiddleContent 组件使用新的 NewThread

**详情**:
- [ ] 修改 `src/renderer/src/components/MiddleContent.vue`
- [ ] 导入并使用 NewThread 组件
- [ ] 根据 currentMode 传递正确的 props

**验收**:
- [ ] NewThread 正确显示
- [ ] 各模式功能正常

---

### 12. 添加 i18n 支持

**任务**: 所有用户可见文本使用 i18n

**详情**:
- [ ] 在 `src/renderer/src/i18n/` 添加新键值:
  - `newThread.placeholder`
  - `newThread.agentTab`
  - `newThread.acpAgentTab`
  - `newThread.reasoningEffort`
  - `newThread.session.active`
  - `newThread.session.destroyed`
  - `newThread.session.none`
  - `newThread.session.create`
  - `newThread.session.destroy`
  - `newThread.session.destroyConfirm`
  - 其他需要的文本
- [ ] 更新所有组件使用 i18n

**验收**:
- [ ] 所有文本通过 i18n 获取
- [ ] 中英文显示正确

---

### 13. 运行代码质量检查

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

### 14. 执行测试套件

**任务**: 运行自动化测试

**详情**:
```bash
pnpm test:renderer
```

**验收**:
- [ ] 所有现有测试通过
- [ ] 新增测试通过

---

### 15. 手动验收测试

**任务**: 手动验证功能

**详情**:
- [ ] All 模式 Agent Tab 输入功能正常
- [ ] All 模式 ACP Agent Tab 可以选择 Agent
- [ ] 选择 ACP Agent 后进入 ACP Agent 模式
- [ ] ACP Agent 模式显示 session 状态
- [ ] ACP Agent 模式可以切换 reasoning effort
- [ ] ACP Agent 模式可以创建新 session
- [ ] ACP Agent 模式可以销毁 session（带确认）
- [ ] Local Model 模式显示正确
- [ ] Local Model 模式可以选择 MCP
- [ ] 输入框支持多行文本
- [ ] 输入框支持图片粘贴
- [ ] 输入框支持 @提及
- [ ] 发送消息正常工作

**验收**:
- [ ] 所有手动测试项通过

---

## Phase 3 验收标准

Phase 3 完成的标准：

1. **组件层面**
   - [ ] NewThread 组件完整实现
   - [ ] 三模式视图正常工作
   - [ ] ChatInput 功能完整
   - [ ] Session 管理功能工作

2. **功能层面**
   - [ ] 三模式切换正常
   - [ ] 输入功能完整（文本、图片、@提及）
   - [ ] Session 创建/销毁工作
   - [ ] Reasoning effort 选择工作
   - [ ] MCP 选择工作

3. **质量层面**
   - [ ] `pnpm run format` 通过
   - [ ] `pnpm run lint` 通过
   - [ ] `pnpm run typecheck` 通过
   - [ ] `pnpm test:renderer` 通过

4. **UI 层面**
   - [ ] 符合设计稿
   - [ ] i18n 支持完整
   - [ ] 深色/浅色主题正常

---

## 进入 Phase 4 的前置条件

- [ ] Phase 3 所有任务完成
- [ ] Phase 3 所有验收标准满足
- [ ] 代码审查通过
