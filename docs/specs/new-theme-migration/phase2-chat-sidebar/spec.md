# Phase 2: Chat 页面整合 WindowSideBar - 需求规格说明书

## 用户故事

作为 DeepChat 用户，我希望在 Chat 窗口中有一个统一的侧边栏来管理 Agents 和历史会话，以便更方便地切换不同的 AI 助手和查看历史对话。

## 业务价值

- **统一入口**: 所有 Agent 类型（普通 Agent、ACP Agent）在一个侧边栏管理
- **历史可追踪**: 快速访问历史会话，提高工作效率
- **架构简化**: 将原本分散的导航功能整合到统一的侧边栏

## 现状分析

当前架构：
- WindowSideBar 组件已存在（`src/renderer/src/components/WindowSideBar.vue`）
- Chat 页面（`ChatView.vue`）目前主要显示对话内容
- NewThreadMock 是一个独立的演示组件，包含新的设计概念

目标架构：
- WindowSideBar 整合到 Chat 页面
- 左侧 48px 显示 Agent 类型切换按钮
- 中间区域根据模式显示 Agent 列表或 NewThread
- 右侧 240px 显示历史会话列表

## 三模式设计

### 模式 1: All Agents（全部）

**左侧按钮**: 显示 "全部" 图标

**中间区域**: 
- 参考 ChatInput.vue 的设计
- 顶部显示模式切换（Agent / ACP Agent）
- 底部根据选择显示对应选项

**右侧区域**: 显示所有历史会话（不分类型）

### 模式 2: ACP Agent

**左侧按钮**: 显示各个 ACP Agent（Claude、Codex 等）

**中间区域**:
- 底部显示 reasoning effort 下拉
- session 操作按钮（销毁当前 session、创建新 session）

**右侧区域**: 显示该 ACP Agent 的历史会话

### 模式 3: Local Model

**左侧按钮**: 显示各个本地模型

**中间区域**:
- 底部显示 MCP 工具选择等操作选单

**右侧区域**: 显示 Local Model 的历史会话

## 验收标准

### 功能性标准

1. **WindowSideBar 整合**
   - [ ] WindowSideBar 正确显示在 Chat 页面左侧
   - [ ] 布局正确：48px 左列 + 中间内容 + 240px 右列
   - [ ] 响应式：窗口缩小时右列可隐藏

2. **三模式切换**
   - [ ] 点击左侧按钮切换模式（All / ACP Agent / Local Model）
   - [ ] 当前模式状态正确保存
   - [ ] 模式切换时中间和右侧内容正确更新

3. **All 模式功能**
   - [ ] 中间 NewThread 区域顶部显示 Agent/ACP Agent 切换
   - [ ] 切换时底部选项区域正确变化
   - [ ] 右侧显示所有历史会话

4. **ACP Agent 模式功能**
   - [ ] 左侧显示可用的 ACP Agents 列表
   - [ ] 选中 ACP Agent 后中间区域显示对应配置
   - [ ] 底部显示 reasoning effort 选项
   - [ ] 提供 session 管理操作
   - [ ] 右侧显示该 Agent 的历史会话

5. **Local Model 模式功能**
   - [ ] 左侧显示可用的本地模型列表
   - [ ] 底部显示 MCP 工具选择
   - [ ] 右侧显示 Local Model 的历史会话

6. **历史会话显示**
   - [ ] 正确加载并显示历史会话
   - [ ] 点击历史会话打开对应聊天
   - [ ] 历史会话按时间排序

### 非功能性标准

- [ ] 切换模式时动画流畅，无卡顿
- [ ] 侧边栏展开/收起动画流畅

## 非目标（明确不做）

1. **不改动 NewThread 内部实现**: Phase 2 只负责布局整合和模式切换，NewThread 内部功能在 Phase 3 实现
2. **不实现完整的 ACP Session 管理**: Phase 2 只提供 UI 占位，实际功能在 Phase 3
3. **不改改动 Browser 相关功能**: Browser 页面保持不变
4. **不添加搜索功能**: 历史会话搜索在后续迭代

## 界面变化

### Before (Phase 1 完成后)
```
┌─────────────────────────────────────┐
│                                     │
│  Chat View                          │
│  (只有对话内容)                     │
│                                     │
└─────────────────────────────────────┘
```

### After (Phase 2 完成后)
```
┌────────┬──────────────────┬─────────┐
│        │                  │         │
│  48px  │   NewThread      │  240px  │
│ Agent  │   (中间内容区)    │ History │
│ Buttons│                  │ List    │
│        │                  │         │
│ [All]  │ ┌──────────────┐ │ Today   │
│ [Claude│ │ 模式切换      │ │ - Chat 1│
│ [GPT-4]│ │ (Agent/ACP)   │ │ - Chat 2│
│ [本地] │ └──────────────┘ │         │
│        │ ┌──────────────┐ │ Yesterday│
│ [设置] │ │ 选项区域      │ │ - Chat 3│
│        │ │ (随模式变化)  │ │         │
└────────┴──────────────────┴─────────┘
```

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| NewThreadMock 和现有 ChatInput 设计冲突 | 中 | 仔细研究两者差异，选择合适的设计 |
| 历史会话数据量大导致性能问题 | 中 | 实现虚拟滚动或分页加载 |
| 三模式状态管理复杂 | 低 | 使用 Pinia store 集中管理 |

## 验收测试清单

- [ ] 启动应用，WindowSideBar 显示在 Chat 页面
- [ ] 点击左侧按钮切换模式，中间内容正确变化
- [ ] All 模式下可以切换 Agent/ACP Agent
- [ ] ACP Agent 模式下显示 Agent 列表
- [ ] Local Model 模式下显示模型列表
- [ ] 右侧显示对应的历史会话
- [ ] 点击历史会话可以打开聊天
- [ ] 运行 `pnpm run typecheck` 通过
- [ ] 运行 `pnpm run lint` 通过
