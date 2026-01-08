# Skills 系统调研报告

## 1. 概述

### 1.1 什么是 Skills 系统

Skills 系统是一种 AI 助手的可扩展性机制，允许 AI Agent 动态发现和应用专业知识、工作流程和能力。与传统的 Tools（执行动作）不同，Skills 提供**专业知识**和**程序性知识**，教会 AI Agent 如何处理特定领域或任务。

### 1.2 核心特征

| 特征 | 说明 |
|------|------|
| **Model-invoked** | AI Agent 基于语义匹配自动决定何时使用 Skill |
| **Progressive Disclosure** | 启动时仅加载元数据，激活时才加载完整内容 |
| **Domain Expertise** | 编码专业知识和行为模式，而非仅仅是可执行函数 |
| **Token Efficient** | 仅元数据（名称+描述）在启动时加载，完整内容按需加载 |
| **Composable** | 将通用 Agent 转换为特定领域的专家 |

### 1.3 Skills vs Tools vs MCP 对比

| 维度 | Skills | MCP Tools | Custom Prompts |
|------|--------|-----------|----------------|
| **提供内容** | "怎么做" - 专业知识、方法论 | "做什么" - 能力、数据访问 | 模板化的提示词 |
| **焦点** | 程序性知识 | 外部集成 | 文本生成 |
| **加载方式** | 渐进式（元数据 → 完整内容） | 预先加载（完整 Schema） | 按需加载 |
| **Token 成本** | 低（~50 元数据 + 2-5K 激活时） | 高（90+ 工具可达 50K+） | 中等 |
| **调用方式** | 语义匹配描述 | 函数调用按名称 | @ 提及或 LLM 调用 |
| **内容类型** | 指令、工作流、模式 | 可执行函数 | 模板文本 |

---

## 2. 业界实现模式分析

### 2.1 Claude Code Skills 系统

Claude Code 实现了最完整的 Skills 系统，是本次调研的主要参考。

#### 2.1.1 文件结构

```
.claude/skills/
├── skill-name/
│   ├── SKILL.md (必需)         # 元数据 + 指令
│   ├── scripts/                # 可执行脚本
│   ├── references/             # 按需加载的文档
│   └── assets/                 # 输出模板/资源
```

#### 2.1.2 SKILL.md 格式

```yaml
---
name: skill-name
description: 描述 Skill 的用途和触发条件（用于语义匹配）
allowed-tools: [可选] Read, Bash, Grep  # 工具限制
model: [可选] claude-sonnet-4
---

# Skill 指令
[Markdown 格式的 AI Agent 指令]
```

#### 2.1.3 发现流程

```
1. 启动: 扫描 ~/.claude/skills/ 和 .claude/skills/
2. 加载: 仅解析 YAML frontmatter（名称 + 描述）
3. 呈现: Skills 可用于语义匹配
4. 匹配: 用户请求 → LLM 匹配描述
5. 确认: 用户看到确认提示
6. 激活: 加载完整 SKILL.md 正文
7. 执行: 遵循指令，按需加载 references
```

#### 2.1.4 多级作用域

```typescript
const skillPaths = [
  '/enterprise/skills/',        // 优先级 1: 企业级
  '~/.claude/skills/',          // 优先级 2: 个人
  '.claude/skills/',            // 优先级 3: 项目
  'plugins/*/skills/'           // 优先级 4: 插件提供
];
```

### 2.2 LangChain Skills 模式

LangChain 的 Skills 模式结合了渐进式加载和动态工具注册：

```typescript
class SkillManager {
  async loadSkill(skillName: string) {
    // 先加载元数据
    const metadata = await loadMetadata(skillName);

    // Skill 激活时动态注册工具
    if (metadata.tools) {
      this.registerTools(metadata.tools);
    }

    // 加载完整指令
    const instructions = await loadInstructions(skillName);
    return { metadata, instructions };
  }
}
```

**适用场景**：
- 单个 Agent 有多个专业化领域
- 不同技能之间没有严格约束
- 不同团队独立开发能力

### 2.3 VS Code Extension 模式

VS Code 的扩展架构提供了隔离和安全性的参考：

```
主进程 (应用管理)
    ↓
渲染进程 (UI)
    ↓
Extension Host 进程 (隔离)
    ↓ (Extension API)
扩展 (用户代码)
```

**关键原则**：
- 扩展不直接访问 DOM
- 通过消息传递通信 (IPC)
- 定义良好、稳定的 Extension API
- 激活事件触发按需加载

### 2.4 工具注册表模式 (OpenAI/LangChain)

传统的工具重型架构：

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (args: any) => Promise<any>;
}

// 所有工具预先加载到上下文
const toolRegistry = new ToolRegistry();
toolRegistry.register(databaseTool);
// ...50+ 工具 = 50K+ tokens
```

**问题**：Token 成本高，所有工具定义预先加载。

---

## 3. Token 经济与性能

### 3.1 传统工具重型架构

```
预先成本: 50,000 tokens (90+ 工具完整 Schema)
每次请求: 所有工具在上下文中
总计: 50K + 消息 tokens
```

### 3.2 Skills 架构

```
启动: 2,500 tokens (50 skills × 50 tokens 元数据)
空闲: 2,500 tokens
激活 (1 skill): 2,500 + 3,000 = 5,500 tokens
节省: 空闲时 90%+ 减少
```

### 3.3 最佳实践

1. **SKILL.md 保持在 500 行以下**
2. **使用渐进式加载**（拆分到 references/）
3. **执行脚本不加载**（0 token 成本）
4. **按需加载 references**
5. **避免重复**（信息只在 SKILL.md 或 references 中出现一次）

---

## 4. 调用模式

### 4.1 自动调用（基于上下文）

- Agent 持续评估上下文与 Skill 描述的匹配度
- 超过阈值时激活 Skill
- 用户在完整加载前看到确认提示

### 4.2 显式调用（斜杠命令）

```bash
# 手动调用
> /review-code --strict

# 背后可能激活 "code-review" skill
```

### 4.3 混合调用（Tool-Skill 桥接）

```typescript
// SlashCommand 工具允许程序化调用 Skill
{
  name: "SlashCommand",
  description: "执行自定义斜杠命令",
  parameters: {
    command: "/skill-name",
    args: "附加参数"
  }
}
```

---

## 5. 安全考虑

### 5.1 沙箱隔离模式

| 模式 | 描述 | 适用场景 |
|------|------|----------|
| **容器 (Docker/LXC)** | 标准隔离，无性能惩罚 | 受信代码 |
| **MicroVM (Firecracker)** | 强隔离，独立内核 | 不受信代码 |
| **用户模式内核 (gVisor)** | 应用与 OS 之间的安全屏障 | Kubernetes Agent |
| **WebAssembly** | 默认拒绝权限模型 | 轻量级插件 |
| **V8 Isolates** | 隔离的 V8 引擎实例 | 高密度、低启动 |

### 5.2 权限控制模式

#### Skill 级工具限制
```yaml
---
name: read-only-analysis
description: 分析代码但不修改
allowed-tools: Read, Grep, Glob  # 禁止 Write, Edit, Bash
---
```

#### 白名单模式
```yaml
allowed-tools:
  - Bash(git status:*)
  - Bash(git add:*)
  - Bash(npm test:*)
```

#### 深度防御
```
层 1: 显式命令白名单
层 2: 最小权限，时间限制 Token
层 3: 沙箱隔离 (gVisor/Firecracker)
层 4: 关键操作的人机协作
层 5: 审计日志和监控
```

---

## 6. DeepChat 现有架构分析

### 6.1 现有类似 Skill 的功能

#### Custom Prompts 系统

DeepChat 已有的 Custom Prompts 系统与 Skills 有 80% 的相似度：

```typescript
interface Prompt {
  id: string
  name: string
  description: string
  content?: string              // 模板文本
  parameters?: Array<{          // 动态参数
    name: string
    description: string
    required: boolean
  }>
  files?: FileItem[]
  enabled?: boolean
  source?: 'local' | 'imported' | 'builtin'
  createdAt?: number
  updatedAt?: number
}
```

**已有功能**：
- ✅ 命名、可重用操作
- ✅ 参数支持
- ✅ 启用/禁用开关
- ✅ 用户管理 UI
- ✅ LLM 集成（AutoPromptingServer）
- ✅ 缓存优化
- ✅ 事件驱动架构

#### AutoPromptingServer

DeepChat 通过内置的 MCP 服务器暴露 Custom Prompts：

```typescript
// 服务器名称: deepchat-inmemory/custom-prompts-server
// 暴露的工具:
- get_template_parameters  // 列出 Prompt 参数
- fill_template            // 用参数填充 Prompt
```

### 6.2 MCP 架构

DeepChat 的 MCP 系统已经非常完善：

```
McpPresenter (核心协调器)
    ├── ServerManager (服务器生命周期)
    ├── ToolManager (工具执行和权限)
    ├── McpClient (单个服务器连接)
    └── InMemoryServers (内置服务器)
        ├── ArtifactsServer
        ├── SearchServers
        ├── KnowledgeServers
        ├── DeepResearchServer
        ├── AutoPromptingServer  ← 已有 Skill-like 功能
        ├── ConversationSearchServer
        ├── MeetingServer
        └── AppleServer
```

### 6.3 工具执行数据流

```
用户消息 (Chat/Agent)
    ↓
Agent Loop (llmProviderPresenter)
    ↓
LLM 调用 agent.stream() 带工具定义
    ↓
LLM 返回 tool_call 事件
    ↓
ToolPresenter.callTool() 路由到:
    - MCP via McpPresenter.callTool()
    - Agent tools via AgentToolManager.callTool()
    ↓
ToolManager 解析工具名 → 客户端映射
    ↓
检查权限 (read/write/all)
    ↓
在目标客户端执行
    ↓
格式化响应
    ↓
返回 Agent Loop → LLM 整合
```

### 6.4 配置系统

DeepChat 使用 ElectronStore 持久化配置：

```
~/.../userData/
├── app-settings.json        # 主设置
├── custom_prompts.json      # Custom Prompts
├── system_prompts.json      # 系统提示词
├── mcp-settings.json        # MCP 配置
├── model-config.json        # 模型配置
└── ...
```

**配置模式**：
- Helper 模式：每个配置域有专门的 Helper 类
- 代理模式：Renderer → Main 通过 IPC 代理通信
- 缓存模式：高频读取的内存缓存
- 事件驱动更新：通过 EventBus 广播到所有窗口

---

## 7. Skills 系统与现有架构的集成点

### 7.1 与 MCP 的关系

Skills 可以**指导**工具使用方法论，而 MCP Tools 提供实际能力：

```
用户请求
     ↓
AI Agent (带 Skills)
     ↓
Skill 激活 → 提供领域专业知识
     ↓                        ↓
Skill 指令指导 → MCP Tool 执行
                                ↓
                         外部系统
```

**示例**：
- **Skill**: "按公司标准进行代码审查"（教方法论）
- **MCP Tools**: Git 操作、文件读取、Lint（提供能力）
- **结果**: Skill 指导 Agent 如何审查；Tools 提供代码访问

### 7.2 自然扩展点

1. **存储层**
   - 扩展 Prompt 接口或创建 SkillDefinition
   - 添加元数据（标签、分类、版本、依赖）
   - 存储在独立的 skills store 或扩展 prompts store

2. **注册**
   - 使用类似 in-memory servers 的模式
   - 创建 skills builder/registry
   - 可能作为 MCP 服务器暴露

3. **执行**
   - 如果基于 MCP，通过 ToolPresenter 路由
   - 如需更深集成，可直接调用
   - 通过现有系统进行权限检查

4. **UI 集成**
   - 设置中的 Skills 面板
   - 专门的 Skills 浏览器
   - Skill 市场/发现
   - Skill 链式/组合 UI

5. **事件广播**
   - 新增 SKILL_EVENTS 常量
   - 广播 Skill 注册/执行事件
   - 与现有 EventBus 集成

---

## 8. 关键发现与建议

### 8.1 DeepChat 的优势

1. **模块化 Presenter 模式** - 清晰的关注点分离
2. **事件驱动** - 通过 EventBus 松耦合
3. **动态工具加载** - MCP 服务器运行时加载
4. **多格式支持** - 工具可与任何 LLM 提供商配合
5. **权限框架** - 内置访问控制
6. **缓存** - 优化性能
7. **统一工具接口** - 所有工具来源的单一入口

### 8.2 Skills 系统的自然演进路径

1. **起点**：Custom Prompts（已有 80%）
2. **添加**：Skill 元数据和分类
3. **暴露**：通过现有 MCP 基础设施
4. **增强**：UI 专门的 Skills 管理
5. **可选**：LLM 上下文外的直接 Skill 执行

### 8.3 推荐的实现策略

基于调研结果，建议采用**渐进式增强**策略：

1. **Phase 1**: 扩展现有 Custom Prompts 为 Skills
2. **Phase 2**: 添加文件系统发现机制
3. **Phase 3**: 实现渐进式加载和语义匹配
4. **Phase 4**: 添加权限控制和工具限制
5. **Phase 5**: UI 增强和市场功能

---

## 9. 参考资源

### Skills 系统
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Claude Skills vs. MCP](https://intuitionlabs.ai/articles/claude-skills-vs-mcp)
- [LangChain Skills](https://docs.langchain.com/oss/python/langchain/multi-agent/skills)

### 架构模式
- [Google Cloud: Agentic AI Design Patterns](https://cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)
- [VS Code Architecture](https://franz-ajit.medium.com/understanding-visual-studio-code-architecture-5fc411fca07)
- [Plugin Architecture Pattern](https://www.devleader.ca/2023/09/07/plugin-architecture-design-pattern-a-beginners-guide-to-modularity/)

### 安全与沙箱
- [Sandboxes for AI](https://www.luiscardoso.dev/blog/sandboxes-for-ai)
- [Google Agent Sandbox](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/agent-sandbox)
- [E2B Code Interpreter](https://e2b.dev/)
