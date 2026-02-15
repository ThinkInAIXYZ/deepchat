# Phase 3: NewThread 三模式适配 - 需求规格说明书

## 用户故事

作为 DeepChat 用户，我希望在创建新对话时，根据选择的 Agent 类型看到对应的配置选项，以便更好地控制对话行为。

## 业务价值

- **针对性配置**: 不同 Agent 类型显示对应的配置选项
- **简化界面**: 不显示无关的配置项
- **提升体验**: ACP Agent 特有的 session 管理、reasoning effort 等选项易于访问

## 现状分析

当前架构：
- NewThreadMock.vue 是一个设计原型，展示了新的 UI 概念
- ChatInput.vue 是当前实际的输入组件，包含完整的输入功能
- ACP Agent 的 session 管理目前分散在不同地方

目标架构：
- 统一 NewThread 组件，支持三模式
- All 模式: 显示 Agent/ACP Agent 切换 + 对应的配置选项
- ACP Agent 模式: 显示 reasoning effort + session 操作
- Local Model 模式: 显示 MCP 工具选择

## 三模式详细设计

### 模式 1: All Agents（全部）

**顶部区域**:
- 模式切换 Tabs: "Agent" / "ACP Agent"
- 默认选中 "Agent"

**Agent Tab 内容**:
- 输入框（参考 ChatInput.vue 设计）
- 底部快捷工具栏

**ACP Agent Tab 内容**:
- ACP Agent 选择器（下拉或卡片）
- 输入框
- 底部显示 reasoning effort 下拉

**底部选项**:
- Agent 模式: 模型选择、MCP 工具
- ACP Agent 模式: reasoning effort (low/medium/high)

### 模式 2: ACP Agent（已选择具体 Agent）

**顶部区域**:
- 显示选中的 ACP Agent 名称和图标
- 返回 All 模式的按钮

**输入区域**:
- 大型输入框（占满中间区域）

**底部选项栏**:
- reasoning effort 下拉选择（low/medium/high）
- session 操作按钮组:
  - "销毁当前 session" 按钮（带确认提示）
  - "创建新 session" 按钮

**Session 状态显示**:
- 显示当前 session 状态（如 "Session: active" 或 "Session: none"）

### 模式 3: Local Model（已选择具体模型）

**顶部区域**:
- 显示选中的模型名称
- 返回 All 模式的按钮

**输入区域**:
- 大型输入框

**底部选项栏**:
- MCP 工具选择（可多选）
- 其他模型特定选项

## 验收标准

### 功能性标准

1. **All 模式功能**
   - [ ] 顶部显示 Agent/ACP Agent 切换 Tabs
   - [ ] Agent Tab 显示普通模型选择
   - [ ] ACP Agent Tab 显示 ACP Agent 选择
   - [ ] 切换 Tab 时底部选项正确变化
   - [ ] 输入框功能正常（支持多行、粘贴、快捷键）

2. **ACP Agent 模式功能**
   - [ ] 显示选中的 ACP Agent 信息
   - [ ] 显示 reasoning effort 选项（low/medium/high）
   - [ ] 提供 "销毁当前 session" 按钮
   - [ ] 提供 "创建新 session" 按钮
   - [ ] 显示当前 session 状态
   - [ ] session 操作调用正确的 Presenter 方法

3. **Local Model 模式功能**
   - [ ] 显示选中的模型信息
   - [ ] 提供 MCP 工具选择
   - [ ] 输入框功能正常

4. **输入功能**
   - [ ] 支持多行文本输入
   - [ ] 支持 @ 提及文件/上下文
   - [ ] 支持图片粘贴和上传
   - [ ] 支持 Enter 发送（Shift+Enter 换行）
   - [ ] 支持 Ctrl+Enter 发送（可选）

5. **Session 管理功能（ACP）**
   - [ ] "创建新 session" 调用 `acpSessionManager.createSession()`
   - [ ] "销毁当前 session" 调用 `acpSessionManager.destroySession()`
   - [ ] 操作成功后更新 session 状态显示
   - [ ] 操作失败时显示错误提示

### 非功能性标准

- [ ] 输入框高度自适应内容
- [ ] 选项切换时无闪烁
- [ ] Session 操作有 loading 状态

## 非目标（明确不做）

1. **不改动核心的 LLM 调用逻辑**: 只改动 UI 层，不改动 provider 层
2. **不实现复杂的历史记录**: 只实现基本的 session 状态显示
3. **不改动 MCP 工具的具体实现**: 只提供选择 UI
4. **不改改动 Browser 相关功能**: 本 Phase 只关注 Chat 页面

## 界面变化

### All 模式 - Agent Tab
```
┌────────────────────────────────────┐
│ [Agent] [ACP Agent]                │  ← 模式切换 Tabs
├────────────────────────────────────┤
│                                    │
│                                    │
│         ┌──────────────────────┐   │
│         │  输入框              │   │
│         │  支持多行、@提及     │   │
│         │                      │   │
│         └──────────────────────┘   │
│                                    │
│  [模型 ▼] [MCP ▼] [图片] [发送]   │  ← 底部选项
└────────────────────────────────────┘
```

### All 模式 - ACP Agent Tab
```
┌────────────────────────────────────┐
│ [Agent] [ACP Agent]                │
├────────────────────────────────────┤
│  [Claude ▼] 选择 ACP Agent         │  ← Agent 选择器
│                                    │
│         ┌──────────────────────┐   │
│         │  输入框              │   │
│         └──────────────────────┘   │
│                                    │
│  [Reasoning ▼] [图片] [发送]       │  ← 底部选项
└────────────────────────────────────┘
```

### ACP Agent 模式（已选择）
```
┌────────────────────────────────────┐
│  ← Claude                          │  ← 返回按钮 + Agent 名
├────────────────────────────────────┤
│  Session: active                   │  ← Session 状态
│                                    │
│         ┌──────────────────────┐   │
│         │                      │   │
│         │     大型输入框       │   │
│         │     （占满空间）     │   │
│         │                      │   │
│         └──────────────────────┘   │
│                                    │
│ [Reasoning ▼] [销毁] [新建] [发送]│  ← 底部选项
└────────────────────────────────────┘
```

### Local Model 模式（已选择）
```
┌────────────────────────────────────┐
│  ← GPT-4                           │  ← 返回按钮 + 模型名
├────────────────────────────────────┤
│                                    │
│         ┌──────────────────────┐   │
│         │     大型输入框       │   │
│         └──────────────────────┘   │
│                                    │
│ [MCP ▼] [图片] [发送]              │  ← 底部选项
└────────────────────────────────────┘
```

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| ChatInput 和 NewThreadMock 设计差异大 | 高 | 仔细研究两者，选择合适的设计融合 |
| Session 管理逻辑复杂 | 中 | 参考 AcpSessionManager 实现，确保调用正确 |
| 输入框功能多，容易遗漏 | 中 | 列清单逐一验证，参考现有 ChatInput |

## 验收测试清单

- [ ] All 模式 Agent Tab 输入功能正常
- [ ] All 模式 ACP Agent Tab 输入功能正常
- [ ] ACP Agent 模式显示 session 状态
- [ ] ACP Agent 模式 reasoning effort 选项工作
- [ ] ACP Agent 模式可以销毁 session
- [ ] ACP Agent 模式可以创建新 session
- [ ] Local Model 模式 MCP 选择工作
- [ ] 输入框支持多行、@提及、图片
- [ ] 发送消息正常工作
- [ ] 运行 `pnpm run typecheck` 通过
- [ ] 运行 `pnpm run lint` 通过
