# Phase 2: WindowSideBar 重构任务清单

## 数据结构验证

- [ ] **TASK-001**: 验证 CONVERSATION 类型的 settings 字段
  - 确认 settings.providerId 字段存在
  - 确认 settings.modelId 字段存在
  - 确认 settings.chatMode 字段存在（'agent' | 'acp agent'）
  - 预估工时: 0.5h

- [ ] **TASK-002**: 验证 chatStore 的数据访问方式
  - 确认 chatStore.threads 的结构为 { dt: string, dtThreads: CONVERSATION[] }[]
  - 确认 chatStore.getThreadWorkingStatus(threadId) 方法可用
  - 确认 chatStore.setActiveConversation(threadId, tabId) 方法可用
  - 确认 chatStore.createConversation(title, settings, tabId) 方法可用
  - 预估工时: 0.5h

- [ ] **TASK-003**: 验证 agentModelStore 的数据结构
  - 确认 agentModelStore.agentModels 按 providerId 分组
  - 确认 agentModels['acp'] 包含 ACP Agents
  - 确认其他 providerId 包含 Local Models
  - 确认 refreshAgentModels(providerId) 方法可用
  - 预估工时: 0.5h

## Tab 生成实现

- [ ] **TASK-004**: 定义 SidebarTab 类型接口
  ```typescript
  interface SidebarTab {
    id: string
    type: 'all' | 'acp' | 'local'
    name: string
    icon: string
    providerId?: string
    modelId?: string
  }
  ```
  - 预估工时: 0.5h

- [ ] **TASK-005**: 实现 Tab 列表生成逻辑
  - 实现 All Agents Tab（固定第一个）
  - 实现 ACP Agent Tabs 动态生成
  - 实现 Local Model Tabs 动态生成
  - 实现图标选择逻辑（getAgentIcon）
  - 预估工时: 2h

- [ ] **TASK-006**: 更新模板中的图标列表渲染
  - 使用 v-for 渲染动态 tabs
  - 保持原有样式（48px 宽度、圆角边框、hover 效果）
  - 实现选中状态高亮
  - 预估工时: 1.5h

## 会话过滤实现

- [ ] **TASK-007**: 实现 filteredSessions 计算属性
  - All Agents Tab：返回所有会话
  - ACP Agent Tab：过滤 providerId === 'acp' && modelId === tab.modelId
  - Local Model Tab：过滤 providerId === tab.providerId && modelId === tab.modelId
  - 保持按日期分组结构
  - 预估工时: 2h

- [ ] **TASK-008**: 更新模板中的会话列表渲染
  - 使用 filteredSessions 替代 mockSessions
  - 保持原有样式（240px 宽度、分组标题、会话项样式）
  - 预估工时: 1h

## 会话状态显示

- [ ] **TASK-009**: 实现工作状态显示
  - 使用 chatStore.getThreadWorkingStatus(threadId) 获取状态
  - working 状态显示旋转 loader
  - completed 状态显示绿色对勾
  - error 状态显示红色警告图标
  - none 状态不显示图标
  - 预估工时: 1h

## 会话切换功能

- [ ] **TASK-010**: 实现会话点击处理
  - 实现 handleSessionClick(threadId) 函数
  - 调用 chatStore.setActiveConversation(threadId, windowId)
  - 更新 selectedSessionId 状态
  - 预估工时: 1h

## 新建会话功能

- [ ] **TASK-011**: 实现新建会话逻辑
  - 实现 handleNewChat() 函数
  - 根据 selectedTab 生成对应的 settings
  - 调用 chatStore.createConversation()
  - 自动切换到新会话
  - 预估工时: 1.5h

## 空状态和边界处理

- [ ] **TASK-012**: 实现加载状态
  - 添加初始加载指示器
  - 预估工时: 0.5h

- [ ] **TASK-013**: 实现空状态显示
  - All Agents 无会话提示
  - 特定 Agent/Model 无会话提示
  - 提供快捷新建按钮
  - 预估工时: 1h

## 实时更新监听

- [ ] **TASK-014**: 实现事件监听
  - 监听 CONVERSATION_EVENTS.LIST_UPDATED
  - 监听 CONVERSATION_EVENTS.TITLE_UPDATED
  - 监听 CONVERSATION_EVENTS.DELETED
  - 在 onUnmounted 中清理监听
  - 预估工时: 1h

## 性能优化

- [ ] **TASK-015**: 实现 computed 缓存
  - 确保 tabs 使用 computed
  - 确保 filteredSessions 使用 computed
  - 预估工时: 0.5h

- [ ] **TASK-016**: 实现虚拟滚动（可选）
  - 如果会话数量 > 100，实现虚拟滚动
  - 预估工时: 2h（可选）

## 测试和验证

- [ ] **TASK-017**: 编写单元测试
  - 测试 Tab 生成逻辑
  - 测试会话过滤逻辑
  - 预估工时: 2h

- [ ] **TASK-018**: 集成测试
  - 测试完整用户流程
  - 测试各种边界情况
  - 预估工时: 1.5h

- [ ] **TASK-019**: 运行代码检查
  - 运行 pnpm run typecheck
  - 运行 pnpm run lint
  - 运行 pnpm run format
  - 预估工时: 0.5h

## 文档更新

- [ ] **TASK-020**: 更新开发者文档
  - 更新 WindowSideBar 组件说明
  - 预估工时: 0.5h

---

## 总预估工时

- 数据结构验证: 1.5h
- Tab 生成实现: 4h
- 会话过滤实现: 3h
- 会话状态显示: 1h
- 会话切换功能: 1h
- 新建会话功能: 1.5h
- 空状态和边界处理: 1.5h
- 实时更新监听: 1h
- 性能优化: 0.5h（2h 可选）
- 测试和验证: 4h
- 文档更新: 0.5h

**总计: 19.5h（21.5h 含可选）**

## 依赖关系

```
TASK-001 ~ TASK-003 (数据结构验证)
         │
         ▼
TASK-004 ~ TASK-006 (Tab 生成实现)
         │
         ▼
TASK-007 ~ TASK-008 (会话过滤实现)
         │
         ▼
TASK-009 (状态显示) ──┬── TASK-010 (会话切换) ──┬── TASK-014 (事件监听)
                      │                          │
                      └── TASK-011 (新建会话) ────┘
                                                │
                                                ▼
                                         TASK-012 ~ TASK-013 (空状态)
                                                │
                                                ▼
                                         TASK-015 ~ TASK-016 (性能优化)
                                                │
                                                ▼
                                         TASK-017 ~ TASK-019 (测试)
                                                │
                                                ▼
                                              TASK-020 (文档)
```
