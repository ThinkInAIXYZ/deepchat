# ThreadPresenter 迁移方案：完全迁移到 SessionPresenter

## 概述

本文档详细描述了从 `threadPresenter` 到 `sessionPresenter` 的完整迁移方案。目标是消除 `threadPresenter`，将所有功能按职责分离到合适的模块中，建立清晰的架构边界。

### 核心原则

1. **sessionPresenter** - 负责核心会话管理（生命周期、消息、Agent Loop、ACP、权限协调）
2. **searchPresenter** - 独立模块，负责搜索引擎和搜索执行
3. **exporter** - 通用模块，负责会话导出（跨 presenter 使用）
4. **共享模块** - 消息格式化、内容增强、权限检查等作为共享工具

### 迁移策略

- **完全迁移**：不保留向后兼容，直接替换
- **功能归属**：所有会话相关功能都去 sessionPresenter；额外功能扩充到 utility 或其他合适的 presenter
- **保留功能**：子会话/父子会话、消息变体系统完全支持

---

## 当前架构分析

### ThreadPresenter 结构（待废弃）

```
threadPresenter/
├── handlers/          # 9个处理器，负责特定领域的业务逻辑
│   ├── baseHandler.ts (20行) - 基础处理器
│   ├── streamGenerationHandler.ts (645行) - 流式生成处理
│   ├── llmEventHandler.ts - LLM事件处理
│   ├── toolCallHandler.ts - 工具调用处理
│   ├── permissionHandler.ts (862行) - 权限处理
│   ├── searchHandler.ts (350行) - 搜索处理
│   ├── utilityHandler.ts (462行) - 工具处理
│   ├── commandPermissionHandler.ts (275行) - 命令权限
│   └── contentBufferHandler.ts (196行) - 流式缓冲
├── managers/          # 3个管理器，负责资源管理和数据持久化
│   ├── messageManager.ts (389行) - 消息管理
│   ├── conversationManager.ts (524行) - 会话管理
│   └── searchManager.ts (1405行) - 搜索管理
├── exporters/         # 2个导出器，负责数据格式转换
│   ├── conversationExporter.ts (691行) - 会话导出
│   └── nowledgeMemExporter.ts (302行) - NowledgeMem导出
├── utils/             # 工具类，提供辅助功能
│   └── contentEnricher.ts (384行) - 内容增强
├── templates/
│   └── conversationExportTemplates.ts - 导出模板
├── types.ts           # 类型定义
├── const.ts           # 常量定义（搜索提示模板）
└── index.ts           # 主入口（1140行）
```

### SessionPresenter 结构（目标）

```
sessionPresenter/
├── index.ts                     # 主入口 (576行)
├── interface.ts                 # 接口定义 (88行)
├── types.ts                     # 类型定义 (81行)
├── events.ts                    # 事件定义 (13行)
│
├── session/
│   └── sessionManager.ts         # 会话管理器 (247行)
│
├── tab/
│   ├── tabAdapter.ts
│   ├── tabManager.ts            # Tab管理器 (210行)
│   └── index.ts
│
├── loop/
│   ├── agentLoopHandler.ts      # Agent循环处理器 (670行)
│   ├── loopOrchestrator.ts      # 循环编排器 (25行)
│   ├── loopState.ts             # 循环状态 (26行)
│   ├── errorClassification.ts   # 错误分类
│   └── toolCallProcessor.ts     # 工具调用处理器 (445行)
│
├── persistence/
│   ├── conversationPersister.ts # 会话持久化 (46行)
│   ├── messagePersister.ts      # 消息持久化 (97行)
│   └── index.ts
│
├── message/
│   ├── messageBuilder.ts        # 消息构造器 (285行)
│   ├── messageTruncator.ts
│   ├── messageFormatter.ts
│   ├── messageCompressor.ts
│   └── index.ts
│
├── acp/                         # ACP模块 (13个文件)
│   ├── acpProcessManager.ts     # ACP进程管理 (1132行)
│   ├── acpSessionManager.ts     # ACP会话管理 (370行)
│   ├── agentToolManager.ts      # Agent工具 (577行)
│   ├── agentFileSystemHandler.ts# 文件系统 (960行)
│   └── ... (其他 ACP 相关文件)
│
├── tool/
│   ├── toolCallCenter.ts        # 工具调用中心 (26行)
│   ├── toolRegistry.ts
│   ├── toolRouter.ts
│   └── index.ts
│
└── utility/
    ├── promptEnhancer.ts        # 提示词增强
    └── index.ts
```

---

## 功能归属表

### 现有模块归属

| 模块 | 源文件行数 | 所属 | 说明 | 优先级 |
|------|-----------|------|------|--------|
| **会话管理核心** | | | | |
| ConversationManager | 524行 | sessionPresenter | 会话CRUD、Tab绑定、分支、子会话 | P0 |
| MessageManager | 389行 | sessionPresenter | 消息CRUD、变体、历史、分页 | P0 |
| StreamGenerationHandler | 645行 | sessionPresenter | 流式生成协调、搜索集成 | P0 |
| LLMEventHandler | 389行 | sessionPresenter | LLM事件处理（响应/错误/结束） | P0 |
| ToolCallHandler | 525行 | sessionPresenter | 工具调用块管理、权限阶段 | P1 |
| PermissionHandler | 862行 | sessionPresenter | 权限响应协调、ACP/MCP/命令 | P0 |
| ContentBufferHandler | 196行 | sessionPresenter | 流式缓冲优化、节流发送 | P1 |
| **搜索功能** | | | | |
| SearchManager | 1405行 | searchPresenter | 搜索引擎管理、窗口管理、搜索执行 | P0 |
| SearchHandler | 350行 | searchPresenter | 搜索适配器、LLM查询优化 | P0 |
| 搜索提示模板 | - | searchPrompts | 搜索提示模板常量 | P2 |
| **导出功能** | | | | |
| ConversationExporter | 691行 | exporter | Markdown/HTML/TXT导出 | P1 |
| NowledgeMemExporter | 302行 | nowledgeMemPresenter | 已存在，保持独立 | 保持 |
| 导出模板 | - | exporter | HTML模板 | P2 |
| **辅助功能** | | | | |
| UtilityHandler::translateText | - | sessionPresenter/utility | 翻译服务 | P1 |
| UtilityHandler::askAI | - | sessionPresenter/utility | AI问答服务 | P1 |
| UtilityHandler::summaryTitles | - | sessionPresenter/utility | 标题生成 | P1 |
| UtilityHandler::exportConversation | - | exporter | 已存在 | 已迁移 |
| UtilityHandler::getMessageRequestPreview | - | sessionPresenter/utility | 调试预览 | P2 |
| CommandPermissionHandler | 275行 | permission | 命令权限检查、风险评估 | P0 |
| ContentEnricher | 384行 | content | URL内容提取、HTML解析 | P2 |

---

## 目标架构

```
src/main/presenter/
├── sessionPresenter/                    # 核心：所有会话管理功能
│   ├── index.ts                         # 主入口，实现 ISessionPresenter
│   ├── interface.ts
│   ├── types.ts
│   ├── events.ts
│   │
│   ├── session/
│   │   └── sessionManager.ts
│   ├── tab/
│   │   ├── tabAdapter.ts
│   │   ├── tabManager.ts
│   │   └── index.ts
│   ├── loop/
│   │   ├── agentLoopHandler.ts
│   │   ├── loopOrchestrator.ts
│   │   ├── loopState.ts
│   │   ├── errorClassification.ts
│   │   ├── toolCallProcessor.ts
│   │   └── index.ts
│   ├── persistence/
│   │   ├── conversationPersister.ts
│   │   ├── messagePersister.ts
│   │   └── index.ts
│   ├── message/
│   │   ├── messageBuilder.ts
│   │   ├── messageTruncator.ts
│   │   ├── messageFormatter.ts
│   │   ├── messageCompressor.ts
│   │   └── index.ts
│   ├── acp/
│   │   ├── acpProcessManager.ts
│   │   ├── acpSessionManager.ts
│   │   ├── agentToolManager.ts
│   │   ├── agentFileSystemHandler.ts
│   │   ├── agentBashHandler.ts
│   │   ├── acpFsHandler.ts
│   │   ├── acpTerminalManager.ts
│   │   ├── acpMessageFormatter.ts
│   │   ├── acpPersistence.ts
│   │   ├── shellEnvHelper.ts
│   │   ├── mcpTransportFilter.ts
│   │   ├── mcpConfigConverter.ts
│   │   ├── acpContentMapper.ts
│   │   ├── commandProcessTracker.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── tool/
│   │   ├── toolCallCenter.ts
│   │   ├── toolRegistry.ts
│   │   ├── toolRouter.ts
│   │   └── index.ts
│   ├── permission/                      # 新增：权限协调
│   │   ├── permissionCoordinator.ts
│   │   └── index.ts
│   ├── utility/                        # 新增：辅助功能
│   │   ├── aiService.ts
│   │   ├── debuggerService.ts
│   │   ├── titleGenerator.ts
│   │   ├── promptEnhancer.ts
│   │   └── index.ts
│   ├── managers/                       # 新增：核心管理器
│   │   ├── conversationManager.ts
│   │   ├── messageManager.ts
│   │   └── index.ts
│   ├── streaming/
│   │   ├── streamingGenerator.ts        # 新增整合类
│   │   ├── streamEventHandler.ts
│   │   ├── contentBufferHandler.ts
│   │   └── index.ts
│   └── const.ts
│
├── searchPresenter/                     # 搜索功能独立模块
│   ├── index.ts
│   ├── interface.ts
│   ├── managers/
│   │   ├── searchManager.ts
│   │   └── index.ts
│   ├── handlers/
│   │   ├── searchHandler.ts
│   │   └── index.ts
│   └── types.ts
│
├── exporter/                            # 导出服务（跨presenter）
│   ├── index.ts
│   ├── interface.ts
│   ├── formats/
│   │   ├── conversationExporter.ts
│   │   ├── markdownExporter.ts
│   │   ├── htmlExporter.ts
│   │   ├── textExporter.ts
│   │   └── index.ts
│   ├── templates/
│   │   └── conversationExportTemplates.ts
│   └── types.ts
│
├── knowledgePresenter/                  # 保留（不迁移）
├── nowledgeMemPresenter/                # 保留（独立功能）
│
├── permission/                          # 共享：权限工具
│   ├── commandPermissionService.ts
│   ├── commandPermissionCache.ts
│   └── index.ts
│
├── content/                             # 共享：内容处理
│   ├── contentEnricher.ts
│   ├── htmlParser.ts
│   └── index.ts
│
├── searchPrompts/                       # 共享：搜索提示
│   ├── searchPrompts.ts
│   ├── templates/
│   │   ├── searchPromptTemplate.ts
│   │   └── searchPromptArtifactsTemplate.ts
│   └── index.ts
│
├── index.ts                             # 更新：移除 threadPresenter
└── ... (其他 presenter 保持不变)
```

---

## 迁移阶段计划

### 阶段 1：准备基础设施（1-2天）

#### 1.1 创建新目录结构

```bash
mkdir -p src/main/presenter/searchPresenter/{managers,handlers}
mkdir -p src/main/presenter/exporter/{formats,templates}
mkdir -p src/main/presenter/searchPrompts/templates
mkdir -p src/main/presenter/permission
mkdir -p src/main/presenter/content
mkdir -p src/main/presenter/sessionPresenter/{permission,utility,managers,streaming}
```

#### 1.2 创建基础接口定义

**`src/main/presenter/searchPresenter/interface.ts`**

```typescript
export interface ISearchPresenter {
  // 搜索引擎管理
  getEngines(): Promise<SearchEngineTemplate[]>
  getActiveEngine(): Promise<SearchEngineTemplate>
  setActiveEngine(engineId: string): Promise<void>
  testEngine(query?: string): Promise<boolean>

  // 搜索执行（通过 conversationId 关联到会话）
  executeSearch(conversationId: string, query: string): Promise<SearchResult[]>
  stopSearch(conversationId: string): Promise<void>

  // 搜索配置
  updateEngines(engines: SearchEngineConfig[]): Promise<void>
  addCustomEngine(engine: SearchEngineConfig): Promise<void>
  removeCustomEngine(engineId: string): Promise<void>

  // 工具方法
  search(query: string): Promise<SearchResult[]>
  testSearch(query?: string): Promise<boolean>
}
```

**`src/main/presenter/exporter/interface.ts`**

```typescript
export interface IConversationExporter {
  // 导出格式
  exportConversation(
    conversationId: string,
    format: 'markdown' | 'html' | 'txt'
  ): Promise<{ filename: string; content: string }>

  // NowledgeMem 集成（委派给 NowledgeMemPresenter）
  exportToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    data?: NowledgeMemThread
    summary?: NowledgeMemExportSummary
    errors?: string[]
  }>

  submitToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    threadId?: string
    data?: NowledgeMemThread
    errors?: string[]
  }>

  testNowledgeMemConnection(): Promise<{
    success: boolean
    message?: string
    error?: string
  }>

  getNowledgeMemConfig(): NowledgeMemConfig
}
```

---

### 阶段 2：迁移搜索功能（2-3天）

#### 2.1 创建 SearchPresenter

**`src/main/presenter/searchPresenter/index.ts`**

```typescript
import type { ISearchPresenter } from './interface'
import { SearchManager } from './managers/searchManager'
import { SearchHandler } from './handlers/searchHandler'
import type { IConfigPresenter, IWindowPresenter } from '@shared/presenter'
import type { ContentEnricher } from '@/main/presenter/content/contentEnricher'

interface SearchPresenterDependencies {
  configPresenter: IConfigPresenter
  windowPresenter: IWindowPresenter
  contentEnricher: ContentEnricher
}

export class SearchPresenter implements ISearchPresenter {
  private readonly searchManager: SearchManager
  private readonly searchHandler: SearchHandler

  constructor(deps: SearchPresenterDependencies) {
    this.searchManager = new SearchManager({
      configPresenter: deps.configPresenter,
      windowPresenter: deps.windowPresenter,
      contentEnricher: deps.contentEnricher
    })
    this.searchHandler = new SearchHandler(this.searchManager)
  }

  // 搜索引擎管理
  async getEngines(): Promise<SearchEngineTemplate[]> {
    return this.searchManager.getEngines()
  }

  async getActiveEngine(): Promise<SearchEngineTemplate> {
    return this.searchManager.getActiveEngine()
  }

  async setActiveEngine(engineId: string): Promise<void> {
    return this.searchManager.setActiveEngine(engineId)
  }

  async testEngine(query?: string): Promise<boolean> {
    return this.searchManager.testSearch(query)
  }

  // 搜索执行
  async executeSearch(conversationId: string, query: string): Promise<SearchResult[]> {
    return this.searchHandler.startStreamSearch(conversationId, query)
  }

  async stopSearch(conversationId: string): Promise<void> {
    return this.searchManager.stopSearch(conversationId)
  }

  // 搜索配置
  async updateEngines(engines: SearchEngineConfig[]): Promise<void> {
    return this.searchManager.updateEngines(engines)
  }

  async addCustomEngine(engine: SearchEngineConfig): Promise<void> {
    return this.searchManager.addCustomEngine(engine)
  }

  async removeCustomEngine(engineId: string): Promise<void> {
    return this.searchManager.removeCustomEngine(engineId)
  }

  // 工具方法
  async search(query: string): Promise<SearchResult[]> {
    return this.searchManager.search(query)
  }

  async testSearch(query?: string): Promise<boolean> {
    return this.searchManager.testSearch(query)
  }

  destroy() {
    this.searchManager.destroy()
  }
}
```

#### 2.2 迁移文件清单

- `threadPresenter/managers/searchManager.ts` → `searchPresenter/managers/searchManager.ts`
- `threadPresenter/handlers/searchHandler.ts` → `searchPresenter/handlers/searchHandler.ts`
- `threadPresenter/const.ts` (搜索提示模板部分) → `searchPrompts/templates/searchPromptTemplate.ts`
- `threadPresenter/const.ts` (搜索提示 artifacts 模板) → `searchPrompts/templates/searchPromptArtifactsTemplate.ts`

#### 2.3 更新主 Presenter 初始化

**修改 `src/main/presenter/index.ts`：**

```typescript
export class Presenter implements IPresenter {
  searchPresenter: ISearchPresenter

  private constructor(lifecycleManager: ILifecycleManager) {
    // ... 现有初始化 ...

    // 初始化 SearchPresenter
    this.searchPresenter = new SearchPresenter({
      configPresenter: this.configPresenter,
      windowPresenter: this.windowPresenter,
      contentEnricher: new ContentEnricher(this.configPresenter)
    })
  }

  // ...
}
```

---

### 阶段 3：迁移导出功能（1-2天）

#### 3.1 创建通用导出模块

**`src/main/presenter/exporter/index.ts`**

```typescript
import type { IConversationExporter } from './interface'
import { ConversationExporter } from './formats/conversationExporter'
import { type ISQLitePresenter, type IConfigPresenter } from '@shared/presenter'

interface ExporterDependencies {
  sqlitePresenter: ISQLitePresenter
  configPresenter: IConfigPresenter
}

export class ConversationExporterService implements IConversationExporter {
  private readonly exporter: ConversationExporter

  constructor(deps: ExporterDependencies) {
    this.exporter = new ConversationExporter(deps)
  }

  async exportConversation(
    conversationId: string,
    format: 'markdown' | 'html' | 'txt'
  ): Promise<{ filename: string; content: string }> {
    return this.exporter.export(conversationId, format)
  }

  async exportToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    data?: NowledgeMemThread
    summary?: NowledgeMemExportSummary
    errors?: string[]
  }> {
    return this.exporter.exportToNowledgeMem(conversationId)
  }

  async submitToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    threadId?: string
    data?: NowledgeMemThread
    errors?: string[]
  }> {
    return this.exporter.submitToNowledgeMem(conversationId)
  }

  getNowledgeMemConfig(): NowledgeMemConfig {
    return this.exporter.getConfig()
  }

  async testNowledgeMemConnection(): Promise<{
    success: boolean
    message?: string
    error?: string
  }> {
    return this.exporter.testConnection()
  }
}
```

#### 3.2 迁移文件清单

- `threadPresenter/exporters/conversationExporter.ts` → `exporter/formats/conversationExporter.ts`
- `threadPresenter/exporters/templates/conversationExportTemplates.ts` → `exporter/templates/conversationExportTemplates.ts`
- 保持 `nowledgeMemPresenter` 独立，不迁移

#### 3.3 更新接口定义

**`src/main/presenter/exporter/formats/conversationExporter.ts`**

```typescript
export class ConversationExporter {
  async export(
    conversationId: string,
    format: 'markdown' | 'html' | 'txt'
  ): Promise<{ filename: string; content: string }> {
    const conversation = await this.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      throw new Error('Conversation not found')
    }

    // 获取所有消息（分页处理）
    const messages = await this.fetchAllMessages(conversationId)

    switch (format) {
      case 'markdown':
        return this.exportToMarkdown(conversation, messages)
      case 'html':
        return this.exportToHtml(conversation, messages)
      case 'txt':
        return this.exportToText(conversation, messages)
      default:
        throw new Error(`Unsupported format: ${format}`)
    }
  }

  private async exportToMarkdown(
    conversation: CONVERSATION,
    messages: Message[]
  ): Promise<{ filename: string; content: string }> {
    const content = buildMarkdownExportContent(conversation, messages)
    const filename = generateExportFilename(conversation, 'md')
    return { filename, content }
  }

  private async exportToHtml(
    conversation: CONVERSATION,
    messages: Message[]
  ): Promise<{ filename: string; content: string }> {
    const content = buildHtmlExportContent(conversation, messages)
    const filename = generateExportFilename(conversation, 'html')
    return { filename, content }
  }

  private async exportToTxt(
    conversation: CONVERSATION,
    messages: Message[]
  ): Promise<{ filename: string; content: string }> {
    const content = buildTextExportContent(conversation, messages)
    const filename = generateExportFilename(conversation, 'txt')
    return { filename, content }
  }

  // NowledgeMem 集成
  async exportToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    data?: NowledgeMemThread
    summary?: NowledgeMemExportSummary
    errors?: string[]
  }> {
    const conversation = await this.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      return { success: false, errors: ['Conversation not found'] }
    }

    const messages = await this.fetchAllMessages(conversationId)
    return buildNowledgeMemExportData(conversation, messages)
  }
}
```

---

### 阶段 4：迁移会话核心功能到 sessionPresenter（3-4天）

#### 4.1 迁移 ConversationManager

**`src/main/presenter/sessionPresenter/managers/conversationManager.ts`**

```typescript
import type {
  CONVERSATION,
  CONVERSATION_SETTINGS,
  ISQLitePresenter,
  IConfigPresenter,
  ParentSelection
} from '@shared/presenter'
import type { Message } from '@shared/chat'
import { presenter } from '@/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { CONVERSATION_EVENTS, TAB_EVENTS } from '@/events'
import { DEFAULT_SETTINGS } from '../const'
import type { MessageManager } from './messageManager'
import type { TabManager } from '../tab/tabManager'

export interface CreateConversationOptions {
  forceNewAndActivate?: boolean
  tabId?: number
}

export interface CreateChildConversationParams {
  parentConversationId: string
  parentMessageId: string
  parentSelection: ParentSelection | string
  title: string
  settings?: Partial<CONVERSATION_SETTINGS>
  tabId?: number
  openInNewTab?: boolean
}

export class ConversationManager {
  private readonly sqlitePresenter: ISQLitePresenter
  private readonly configPresenter: IConfigPresenter
  private readonly messageManager: MessageManager
  private readonly tabManager: TabManager
  private readonly activeConversationIds: Map<number, string>

  constructor(options: {
    sqlitePresenter: ISQLitePresenter
    configPresenter: IConfigPresenter
    messageManager: MessageManager
    tabManager: TabManager
    activeConversationIds: Map<number, string>
  }) {
    this.sqlitePresenter = options.sqlitePresenter
    this.configPresenter = options.configPresenter
    this.messageManager = options.messageManager
    this.tabManager = options.tabManager
    this.activeConversationIds = options.activeConversationIds
  }

  // === Tab绑定管理 ===

  getActiveConversationIdSync(tabId: number): string | null {
    return this.activeConversationIds.get(tabId) || null
  }

  getTabsByConversation(conversationId: string): number[] {
    return Array.from(this.activeConversationIds.entries())
      .filter(([, id]) => id === conversationId)
      .map(([tabId]) => tabId)
  }

  async setActiveConversation(conversationId: string, tabId: number): Promise<void> {
    // 验证会话存在
    const conversation = await this.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    // 检查是否已在其他 tab 中激活
    const existingTabId = await this.findTabForConversation(conversationId)
    if (existingTabId && existingTabId !== tabId) {
      // 可选：询问用户是否切换到已有的 tab
      console.warn(`Conversation ${conversationId} is already active in tab ${existingTabId}`)
    }

    // 设置激活状态
    this.activeConversationIds.set(tabId, conversationId)
    eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
      tabId,
      conversationId
    })
  }

  async clearActiveConversation(tabId: number, options: { notify?: boolean } = {}): Promise<void> {
    if (!this.activeConversationIds.has(tabId)) {
      return
    }
    this.activeConversationIds.delete(tabId)
    if (options.notify) {
      eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, { tabId })
    }
  }

  async clearConversationBindings(conversationId: string): Promise<void> {
    for (const [tabId, activeId] of this.activeConversationIds.entries()) {
      if (activeId === conversationId) {
        this.activeConversationIds.delete(tabId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
          tabId
        })
      }
    }
  }

  async findTabForConversation(conversationId: string): Promise<number | null> {
    for (const [tabId, activeId] of this.activeConversationIds.entries()) {
      if (activeId === conversationId) {
        try {
          const tabView = await presenter.tabPresenter.getTab(tabId)
          if (tabView && !tabView.webContents.isDestroyed()) {
            return tabId
          }
        } catch (error) {
          console.error('Error finding tab for conversation:', error)
        }
      }
    }
    return null
  }

  // === 会话 CRUD ===

  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>,
    tabId: number,
    options: CreateConversationOptions = {}
  ): Promise<string> {
    const mergedSettings = { ...DEFAULT_SETTINGS, ...settings }
    const conversationId = await this.sqlitePresenter.createConversation(
      title,
      mergedSettings
    )

    // 自动激活
    if (options.forceNewAndActivate || !this.activeConversationIds.has(tabId)) {
      await this.setActiveConversation(conversationId, tabId)
    }

    return conversationId
  }

  async getConversation(conversationId: string): Promise<CONVERSATION> {
    const conversation = await this.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }
    return conversation
  }

  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return this.sqlitePresenter.getConversationList(page, pageSize)
  }

  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    return this.sqlitePresenter.updateConversation(conversationId, { title })
  }

  async deleteConversation(conversationId: string): Promise<void> {
    // 清除绑定
    this.clearConversationBindings(conversationId)

    // 清除消息
    await this.sqlitePresenter.deleteAllMessages(conversationId)

    // 删除会话
    await this.sqlitePresenter.deleteConversation(conversationId)
  }

  async toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    return this.sqlitePresenter.updateConversation(conversationId, { pinned: pinned ? 1 : 0 })
  }

  async updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void> {
    return this.sqlitePresenter.updateConversation(conversationId, { settings })
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    return this.sqlitePresenter.updateConversation(conversationId, { title })
  }

  async loadMoreThreads(): Promise<{ hasMore: boolean; total: number }> {
    // 实现分页加载逻辑
    // 这里需要根据实际需求实现
    return { hasMore: false, total: 0 }
  }

  async broadcastThreadListUpdate(): Promise<void> {
    eventBus.sendToRenderer(CONVERSATION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS, {})
  }

  // === 会话分支 ===

  async forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string> {
    // 1. 获取源会话和消息
    const sourceConversation = await this.sqlitePresenter.getConversation(targetConversationId)
    if (!sourceConversation) {
      throw new Error('Source conversation not found')
    }

    const targetMessage = await this.messageManager.getMessage(targetMessageId)
    if (!targetMessage) {
      throw new Error('Target message not found')
    }

    // 2. 创建新会话
    const mergedSettings = {
      ...sourceConversation.settings,
      ...settings,
      selectedVariantsMap,
      parentConversationId: targetConversationId,
      parentMessageId: targetMessageId,
      is_new: 0
    }
    mergedSettings.selectedVariantsMap = {}

    const newConversationId = await this.sqlitePresenter.createConversation(newTitle, mergedSettings)

    // 3. 复制消息（只到目标消息及其父消息）
    await this.copyMessagesUpTo(
      targetConversationId,
      newConversationId,
      targetMessageId,
      selectedVariantsMap
    )

    // 4. 广播更新
    await this.broadcastThreadListUpdate()

    return newConversationId
  }

  async createChildConversationFromSelection(
    payload: CreateChildConversationParams
  ): Promise<string> {
    const {
      parentConversationId,
      parentMessageId,
      parentSelection,
      title,
      settings,
      tabId,
      openInNewTab
    } = payload

    const parentConversation = await this.sqlitePresenter.getConversation(parentConversationId)
    if (!parentConversation) {
      throw new Error('Parent conversation not found')
    }

    await this.messageManager.getMessage(parentMessageId)

    const mergedSettings = {
      ...parentConversation.settings,
      ...settings
    }
    mergedSettings.selectedVariantsMap = {}

    const newConversationId = await this.sqlitePresenter.createConversation(title, mergedSettings)
    const resolvedParentSelection =
      typeof parentSelection === 'string'
        ? (() => {
            try {
              return JSON.parse(parentSelection) as ParentSelection
            } catch {
              throw new Error('Invalid parent selection payload')
            }
          })()
        : parentSelection
    await this.sqlitePresenter.updateConversation(newConversationId, {
      is_new: 0,
      parentConversationId,
      parentMessageId,
      parentSelection: resolvedParentSelection
    })

    const shouldOpenInNewTab = openInNewTab ?? true
    if (shouldOpenInNewTab && tabId) {
      const sourceWindowId = presenter.tabPresenter.getWindowIdByWebContentsId(tabId)
      const fallbackWindowId = presenter.windowPresenter.getFocusedWindow()?.id
      const windowId = sourceWindowId ?? fallbackWindowId

      if (windowId) {
        const newTabId = await presenter.tabPresenter.createTab(windowId, 'local://chat', {
          active: true
        })
        if (newTabId) {
          await this.setActiveConversation(newConversationId, newTabId)
          await this.broadcastThreadListUpdate()
          return newConversationId
        }
      }
    }

    if (tabId) {
      await this.setActiveConversation(newConversationId, tabId)
    }

    await this.broadcastThreadListUpdate()
    return newConversationId
  }

  // === 子会话查询 ===

  async listChildConversationsByParent(parentConversationId: string): Promise<CONVERSATION[]> {
    return this.sqlitePresenter.listChildConversationsByParent(parentConversationId)
  }

  async listChildConversationsByMessageIds(parentMessageIds: string[]): Promise<CONVERSATION[]> {
    return this.sqlitePresenter.listChildConversationsByMessageIds(parentMessageIds)
  }

  // === 私有方法 ===

  private async copyMessagesUpTo(
    sourceConversationId: string,
    targetConversationId: string,
    targetMessageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    const allMessages = await this.messageManager.getMessageHistory(targetMessageId, 1000)

    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i]
      if (msg.id === targetMessageId) {
        // 到达目标消息，停止复制
        break
      }

      // 应用变体选择
      let content = msg.content
      if (msg.role === 'assistant' && selectedVariantsMap && selectedVariantsMap[msg.id] && msg.variants) {
        const variant = msg.variants.find((v) => v.id === selectedVariantsMap[msg.id])
        if (variant) {
          content = variant.content
        }
      }

      // 插入消息到目标会话
      await this.sqlitePresenter.insertMessage(
        targetConversationId,
        JSON.stringify(content),
        msg.role,
        msg.parentId || '',
        JSON.stringify(msg.usage),
        msg.is_variant,
        msg.timestamp || Date.now(),
        msg.status
      )
    }
  }
}
```

#### 4.2 迁移 MessageManager

**`src/main/presenter/sessionPresenter/managers/messageManager.ts`**

```typescript
import {
  IMessageManager,
  MESSAGE_METADATA,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  ISQLitePresenter,
  SQLITE_MESSAGE
} from '@shared/presenter'
import {
  Message,
  AssistantMessageBlock,
  UserMessageContent,
  UserMessageTextBlock,
  UserMessageMentionBlock,
  UserMessageCodeBlock
} from '@shared/chat'
import { eventBus, SendTarget } from '@/eventbus'
import { CONVERSATION_EVENTS } from '@/events'

export class MessageManager implements IMessageManager {
  private sqlitePresenter: ISQLitePresenter

  constructor(sqlitePresenter: ISQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  // === 消息 CRUD ===

  async sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE,
    parentId: string,
    isVariant: boolean,
    metadata: MESSAGE_METADATA,
    searchResults?: string
  ): Promise<Message> {
    const maxOrderSeq = await this.sqlitePresenter.getMaxOrderSeq(conversationId)
    const msgId = await this.sqlitePresenter.insertMessage(
      conversationId,
      content,
      role,
      parentId,
      JSON.stringify(metadata),
      isVariant,
      maxOrderSeq + 1,
      Date.now(),
      'pending'
    )

    // 如果有搜索结果，保存为附件
    if (searchResults) {
      await this.sqlitePresenter.insertMessageAttachment(msgId, 'search_result', searchResults)
    }

    return this.getMessage(msgId)
  }

  async getMessage(messageId: string): Promise<Message> {
    const sqliteMessage = await this.sqlitePresenter.getMessage(messageId)
    if (!sqliteMessage) {
      throw new Error(`Message not found: ${messageId}`)
    }
    return this.convertToMessage(sqliteMessage)
  }

  async editMessage(messageId: string, content: string): Promise<Message> {
    await this.sqlitePresenter.updateMessage(messageId, { content })
    return this.getMessage(messageId)
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.sqlitePresenter.deleteMessage(messageId)
  }

  async retryMessage(messageId: string, metadata: MESSAGE_METADATA): Promise<Message> {
    const originalMessage = await this.getMessage(messageId)
    if (originalMessage.role !== 'assistant') {
      throw new Error('Can only retry assistant messages')
    }

    if (!originalMessage.parentId) {
      throw new Error('Assistant message must have a parent')
    }

    const newMessage = await this.sendMessage(
      originalMessage.conversationId,
      JSON.stringify([]),
      'assistant',
      originalMessage.parentId,
      false,
      metadata
    )

    return newMessage
  }

  async updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void> {
    await this.sqlitePresenter.updateMessage(messageId, { status })
  }

  async updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void> {
    const existing = await this.getMessage(messageId)
    const currentMetadata: MESSAGE_METADATA = existing.usage
    const merged = { ...currentMetadata, ...metadata }

    await this.sqlitePresenter.updateMessage(messageId, {
      metadata: JSON.stringify(merged)
    })
  }

  async markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void> {
    await this.updateMessageMetadata(messageId, { contextEdge: isEdge ? 1 : 0 })
  }

  // === 消息查询 ===

  async getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: Message[] }> {
    return this.sqlitePresenter.getMessageThread(conversationId, page, pageSize)
  }

  async getMessageHistory(messageId: string, limit: number = 100): Promise<Message[]> {
    const message = await this.getMessage(messageId)
    const { list } = await this.getMessageThread(message.conversationId, 1, limit)

    // 找到目标消息的位置
    const index = list.findIndex(msg => msg.id === messageId)
    if (index === -1) {
      return list
    }

    return list.slice(index + 1)
  }

  async getContextMessages(conversationId: string, messageCount: number): Promise<Message[]> {
    const { list } = await this.getMessageThread(conversationId, 1, messageCount)
    return list.slice(-messageCount)
  }

  async getMessageVariants(messageId: string): Promise<Message[]> {
    const message = await this.getMessage(messageId)
    return message.variants || []
  }

  async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<Message | null> {
    const messages = await this.sqlitePresenter.getMessagesByParentId(conversationId, parentId)
    if (messages.length === 0) {
      return null
    }

    // 返回第一条（通常是按 order_seq 排序的）
    return this.convertToMessage(messages[0])
  }

// ... (继续补充剩余方法)
```

#### 4.3 补充 SessionPresenter 缺失的方法

**需要在 `sessionPresenter/index.ts` 中添加的方法：**

```typescript
// 从 StreamGenerationHandler 迁移
async startStreamCompletion(
  sessionId: string,
  queryMsgId?: string,
  selectedVariantsMap?: Record<string, string>
): Promise<void> {
  const streamingGenerator = new StreamingGenerator(this.dependencies)
  return streamingGenerator.startStream(sessionId, queryMsgId, selectedVariantsMap)
}

async continueStreamCompletion(
  sessionId: string,
  queryMsgId: string,
  selectedVariantsMap?: Record<string, string>
): Promise<void> {
  const streamingGenerator = new StreamingGenerator(this.dependencies)
  return streamingGenerator.continueStream(sessionId, queryMsgId, selectedVariantsMap)
}

async regenerateFromUserMessage(
  sessionId: string,
  userMessageId: string,
  selectedVariantsMap?: Record<string, string>
): Promise<AssistantMessage> {
  const userMessage = await this.messagePersister.getMessage(userMessageId)
  if (!userMessage || userMessage.role !== 'user') {
    throw new Error('Can only regenerate based on user messages.')
  }

  const conversation = await this.conversationPersister.getConversation(sessionId)
  const { providerId, modelId } = conversation.settings

  const assistantMessage = await this.messagePersister.insertMessage(
    sessionId,
    JSON.stringify([]),
    'assistant',
    userMessageId,
    JSON.stringify({
      totalTokens: 0,
      generationTime: 0,
      firstTokenTime: 0,
      tokensPerSecond: 0,
      contextUsage: 0,
      inputTokens: 0,
      outputTokens: 0,
      model: modelId,
      provider: providerId
    }),
    0,
    Date.now(),
    'pending',
    0,
    0
  )

  // 启动流式生成
  await this.startStreamCompletion(sessionId, userMessageId, selectedVariantsMap)

  return (await this.getMessage(assistantMessage)) as AssistantMessage
}

// 从 PermissionHandler 迁移
async handlePermissionResponse(
  messageId: string,
  toolCallId: string,
  granted: boolean,
  permissionType: 'read' | 'write' | 'all' | 'command',
  remember: boolean = true
): Promise<void> {
  const permissionCoordinator = new PermissionCoordinator(this.dependencies)
  return permissionCoordinator.handlePermissionResponse(
    messageId,
    toolCallId,
    granted,
    permissionType,
    remember
  )
}

// 从 MessageManager 迁移
async editMessage(messageId: string, content: string): Promise<Message> {
  const messageManager = new MessageManager(this.sqlitePresenter)
  return messageManager.editMessage(messageId, content)
}

async retryMessage(messageId: string): Promise<Message> {
  const messageManager = new MessageManager(this.sqlitePresenter)
  const message = await messageManager.getMessage(messageId)

  const metadata: MESSAGE_METADATA = {
    contextUsage: 0,
    totalTokens: 0,
    generationTime: 0,
    firstTokenTime: 0,
    tokensPerSecond: 0,
    inputTokens: 0,
    outputTokens: 0,
    model: message.model_id,
    provider: message.model_provider
  }

  return messageManager.retryMessage(messageId, metadata)
}

async getMessageThread(
  sessionId: string,
  page: number,
  pageSize: number
): Promise<{ total: number; messages: Message[] }> {
  const messageManager = new MessageManager(this.sqlitePresenter)
  const result = await messageManager.getMessageThread(sessionId, page, pageSize)
  return { total: result.total, messages: result.list }
}

async getContextMessages(sessionId: string): Promise<Message[]> {
  const conversation = await this.conversationPersister.getConversation(sessionId)
  let messageCount = Math.ceil(conversation.settings.contextLength / 300)
  if (messageCount < 2) {
    messageCount = 2
  }
  const messageManager = new MessageManager(this.sqlitePresenter)
  return messageManager.getContextMessages(sessionId, messageCount)
}

async clearContext(sessionId: string): Promise<void> {
  await this.sqlitePresenter.deleteAllMessages(sessionId)
}

async clearAllMessages(sessionId: string): Promise<void> {
  await this.sqlitePresenter.deleteAllMessages(sessionId)

  // 停止所有正在生成的消息
  const tabs = this.getActiveTabsBySession(sessionId)
  for (const tabId of tabs) {
    await this.stopConversationGeneration(sessionId)
  }
}

async stopConversationGeneration(sessionId: string): Promise<void> {
  const messageIds = Array.from(this.activeLoops.entries())
    .filter(([, state]) => state.conversationId === sessionId)
    .map(([messageId]) => messageId)

  await Promise.all(messageIds.map((messageId) => this.cancelLoop(sessionId, messageId)))
}
```

#### 4.4 创建流式生成协调器

**`src/main/presenter/sessionPresenter/streaming/streamingGenerator.ts`** (新整合类)

```typescript
import type { SessionPresenterDependencies } from '../index'
import type { ISearchPresenter } from '@/main/presenter/searchPresenter'
import type { Message, AssistantMessage } from '@shared/chat'
import type { SearchResult, CONVERSATION } from '@shared/presenter'
import { LoopOrchestrator } from '../loop/loopOrchestrator'
import { preparePromptContent } from '../message/messageBuilder'
import { buildUserMessageContext, formatUserMessageContent } from '../message/messageFormatter'
import { ContentEnricher } from '@/main/presenter/content/contentEnricher'

export class StreamingGenerator {
  constructor(private deps: SessionPresenterDependencies) {}

  async startStream(
    sessionId: string,
    userMessageId?: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    const session = await this.deps.sessionManager.getSession(sessionId)

    // 1. 准备上下文
    const { conversation, userMessage, contextMessages } = await this.prepareConversationContext(
      sessionId,
      userMessageId,
      selectedVariantsMap
    )

    // 2. 处理用户消息内容
    const { userContent, urlResults, imageFiles } = await this.processUserMessageContent(
      userMessage
    )

    // 3. 执行搜索（如果需要）
    let searchResults: SearchResult[] | null = null
    if ((userMessage.content as any).search) {
      searchResults = await this.executeSearch(sessionId, userContent)
    }

    // 4. 准备提示内容
    const { finalContent, promptTokens } = await preparePromptContent({
      conversation,
      userContent,
      contextMessages,
      searchResults,
      urlResults,
      userMessage,
      vision: false,
      imageFiles: [],
      supportsFunctionCall: false,
      modelType: 'chat'
    })

    // 5. 更新生成状态
    await this.updateGenerationState(sessionId, userMessage?.id || '', promptTokens)

    // 6. 启动 Agent Loop
    const stream = this.deps.llmProviderPresenter.startStreamCompletion(
      conversation.settings.providerId,
      finalContent,
      conversation.settings.modelId,
      userMessageId || '',
      conversation.settings.temperature,
      conversation.settings.maxTokens,
      conversation.settings.enabledMcpTools,
      conversation.settings.thinkingBudget,
      conversation.settings.reasoningEffort,
      conversation.settings.verbosity,
      conversation.settings.enableSearch,
      conversation.settings.forcedSearch,
      conversation.settings.searchStrategy,
      sessionId
    )

    // 7. 通过 LoopOrchestrator 消费流
    const loopOrchestrator = new LoopOrchestrator({
      handleLLMAgentResponse: async (msg) => this.handleResponse(msg),
      handleLLMAgentError: async (msg) => this.handleError(msg),
      handleLLMAgentEnd: async (msg) => this.handleEnd(msg)
    })

    await loopOrchestrator.consume(stream)
  }

  async continueStream(
    sessionId: string,
    queryMsgId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    const session = await this.deps.sessionManager.getSession(sessionId)

    // 1. 获取查询消息
    const queryMessage = await this.deps.messagePersister.getMessage(queryMsgId)
    if (!queryMessage) {
      throw new Error('Message not found')
    }

    // 2. 处理待定的工具调用
    const content = queryMessage.content as AssistantMessageBlock[]
    const lastActionBlock = content.filter((block) => block.type === 'action').pop()

    if (lastActionBlock?.action_type === 'maximum_tool_calls_reached' && lastActionBlock.tool_call) {
      // 执行工具调用
      const toolCallResponse = await this.executeToolCall(lastActionBlock.tool_call, sessionId)

      // 发送工具调用事件
      await this.sendToolCallEvents(lastActionBlock.tool_call, toolCallResponse, queryMsgId)
    }

    // 3. 准备上下文并继续生成
    const { conversation, contextMessages, userMessage } = await this.prepareConversationContext(
      sessionId,
      queryMsgId,
      selectedVariantsMap
    )

    const { finalContent } = await preparePromptContent({
      conversation,
      userContent: 'continue',
      contextMessages,
      searchResults: null,
      urlResults: [],
      userMessage,
      vision: false,
      imageFiles: [],
      supportsFunctionCall: false,
      modelType: 'chat'
    })

    const stream = this.deps.llmProviderPresenter.startStreamCompletion(
      conversation.settings.providerId,
      finalContent,
      conversation.settings.modelId,
      queryMsgId,
      conversation.settings.temperature,
      conversation.settings.maxTokens,
      conversation.settings.enabledMcpTools,
      conversation.settings.thinkingBudget,
      conversation.settings.reasoningEffort,
      conversation.settings.verbosity,
      conversation.settings.enableSearch,
      conversation.settings.forcedSearch,
      conversation.settings.searchStrategy,
      sessionId
    )

    const loopOrchestrator = new LoopOrchestrator({
      handleLLMAgentResponse: async (msg) => this.handleResponse(msg),
      handleLLMAgentError: async (msg) => this.handleError(msg),
      handleLLMAgentEnd: async (msg) => this.handleEnd(msg)
    })

    await loopOrchestrator.consume(stream)
  }

  private async prepareConversationContext(
    sessionId: string,
    queryMsgId?: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<{
    conversation: CONVERSATION
    userMessage: Message
    contextMessages: Message[]
  }> {
    const conversation = await this.deps.conversationPersister.getConversation(sessionId)
    let contextMessages: Message[] = []
    let userMessage: Message | null = null

    if (queryMsgId) {
      const queryMessage = await this.deps.messagePersister.getMessage(queryMsgId)
      if (!queryMessage) {
        throw new Error('Message not found')
      }

      if (queryMessage.role === 'user') {
        userMessage = queryMessage
      } else if (queryMessage.role === 'assistant') {
        if (!queryMessage.parentId) {
          throw new Error('Assistant message missing parentId')
        }
        userMessage = await this.deps.messagePersister.getMessage(queryMessage.parentId)
        if (!userMessage) {
          throw new Error('Trigger message not found')
        }
      } else {
        throw new Error('Unsupported message type')
      }

      contextMessages = await this.getMessageHistory(userMessage.id, 100)
    } else {
      userMessage = await this.deps.messagePersister.getLastUserMessage(sessionId)
      if (!userMessage) {
        throw new Error('User message not found')
      }
      contextMessages = await this.getContextMessages(sessionId)
    }

    return { conversation, userMessage: userMessage!, contextMessages }
  }

  private async processUserMessageContent(
    userMessage: Message
  ): Promise<{ userContent: string; urlResults: SearchResult[]; imageFiles: any[] }> {
    const userContent = buildUserMessageContext(userMessage.content)
    const normalizedText = (userMessage.content as any).text || userContent
    const urlResults = await ContentEnricher.extractAndEnrichUrls(normalizedText)
    const imageFiles = []

    return { userContent, urlResults, imageFiles }
  }

  private async executeSearch(sessionId: string, query: string): Promise<SearchResult[]> {
    // 集成 searchPresenter
    return [] // 实现搜索逻辑
  }

  private async executeToolCall(toolCall: any, sessionId: string): Promise<any> {
    // 实现工具调用逻辑
    return { content: '', rawData: {} }
  }

  private async handleResponse(msg: any): Promise<void> {
    // 处理 LLM 响应
  }

  private async handleError(msg: any): Promise<void> {
    // 处理 LLM 错误
  }

  private async handleEnd(msg: any): Promise<void> {
    // 处理 LLM 结束
  }

  private async updateGenerationState(sessionId: string, messageId: string, promptTokens: number): Promise<void> {
    // 更新生成状态
  }

  private async getMessageHistory(messageId: string, limit: number): Promise<Message[]> {
    return []
  }

  private async getContextMessages(sessionId: string): Promise<Message[]> {
    return []
  }

  private async sendToolCallEvents(toolCall: any, response: any, messageId: string): Promise<void> {
    // 发送工具调用事件
  }
}
```

#### 4.5 创建权限协调器

**`src/main/presenter/sessionPresenter/permission/permissionCoordinator.ts`**

```typescript
import type { SessionPresenterDependencies } from '../index'
import type { IToolPresenter, ILlmProviderPresenter, IMCPPresenter } from '@shared/presenter'
import type { PermissionState } from '../types'
import { CommandPermissionService } from '@/main/presenter/permission/commandPermissionService'
import type { AssistantMessageBlock } from '@shared/chat'
import { buildContinueToolCallContext, buildPostToolExecutionContext } from '../message/messageBuilder'

export class PermissionCoordinator {
  constructor(private deps: SessionPresenterDependencies) {}

  async handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command',
    remember: boolean = true
  ): Promise<void> {
    const message = await this.deps.messagePersister.getMessage(messageId)
    if (!message || message.role !== 'assistant') {
      throw new Error(`Message not found or not assistant message (${messageId})`)
    }

    const content = message.content as AssistantMessageBlock[]
    const permissionBlock = content.find(
      (block) =>
        block.type === 'action' &&
        block.action_type === 'tool_call_permission' &&
        block.tool_call?.id === toolCallId
    )

    if (!permissionBlock) {
      throw new Error(
        `Permission block not found (messageId: ${messageId}, toolCallId: ${toolCallId})`
      )
    }

    const isAcpPermission = this.isAcpPermissionBlock(permissionBlock)

    // 更新权限块状态
    permissionBlock.status = granted ? 'granted' : 'denied'
    if (permissionBlock.extra) {
      permissionBlock.extra.needsUserAction = false
      if (granted) {
        permissionBlock.extra.grantedPermissions = permissionType
      }
    }

    await this.deps.messagePersister.updateMessage(messageId, {
      content: JSON.stringify(content),
      metadata: JSON.stringify({ ...message, content })
    })

    if (isAcpPermission) {
      await this.handleAcpPermissionFlow(messageId, permissionBlock, granted)
      this.deps.sessionManager.clearPendingPermission(message.conversationId)
      this.deps.sessionManager.setStatus(message.conversationId, 'generating')
      return
    }

    if (permissionType === 'command') {
      if (granted) {
        await this.handleCommandPermission(messageId, permissionBlock, remember)
        await this.restartAgentLoopAfterPermission(messageId)
      } else {
        await this.continueAfterPermissionDenied(messageId)
      }
      return
    }

    // MCP 权限
    if (granted) {
      const serverName = permissionBlock?.extra?.serverName as string
      if (!serverName) {
        throw new Error(`Server name not found in permission block (${messageId})`)
      }

      await this.deps.mcpPresenter.grantPermission(serverName, permissionType, remember)
      await this.waitForMcpServiceReady(serverName)
      await this.restartAgentLoopAfterPermission(messageId)
    } else {
      await this.continueAfterPermissionDenied(messageId)
    }
  }

  private async handleAcpPermissionFlow(
    messageId: string,
    block: AssistantMessageBlock,
    granted: boolean
  ): Promise<void> {
    const requestId = this.getExtraString(block, 'permissionRequestId')
    if (!requestId) {
      throw new Error(`Missing ACP permission request identifier for message ${messageId}`)
    }

    await this.deps.llmProviderPresenter.resolveAgentPermission(requestId, granted)
  }

  private async handleCommandPermission(
    messageId: string,
    block: AssistantMessageBlock,
    remember: boolean
  ): Promise<void> {
    const conversationId = (await this.deps.messagePersister.getMessage(messageId)).conversationId
    const command = this.getCommandFromPermissionBlock(block)
    if (!command) {
      throw new Error(`Unable to extract command from permission block (${messageId})`)
    }

    const signature = CommandPermissionService.extractCommandSignature(command)
    CommandPermissionService.approve(conversationId, signature, remember)
  }

  private async restartAgentLoopAfterPermission(messageId: string): Promise<void> {
    const message = await this.deps.messagePersister.getMessage(messageId)
    if (!message) {
      throw new Error(`Message not found (${messageId})`)
    }

    const sessionId = message.conversationId
    await this.deps.sessionManager.startLoop(sessionId, messageId)

    // 恢复流式生成
    const streamingGenerator = new (await import('../streaming/streamingGenerator')).StreamingGenerator(this.deps)
    await streamingGenerator.continueStream(sessionId, messageId)
  }

  private async continueAfterPermissionDenied(messageId: string): Promise<void> {
    const message = await this.deps.messagePersister.getMessage(messageId)
    if (!message || message.role !== 'assistant') {
      throw new Error(`Message not found or not assistant message (${messageId})`)
    }

    const sessionId = message.conversationId
    const content = message.content as AssistantMessageBlock[]
    const deniedPermissionBlock = content.find(
      (block) =>
        block.type === 'action' &&
        block.action_type === 'tool_call_permission' &&
        block.status === 'denied'
    )

    if (!deniedPermissionBlock?.tool_call) {
      console.warn('[PermissionCoordinator] No denied permission block for', messageId)
      return
    }

    const toolCall = deniedPermissionBlock.tool_call
    const errorMessage = `Tool execution failed: Permission denied by user for ${
      toolCall.name || 'this tool'
    }`

    // 发送工具调用结束事件
    // ... 发送事件

    // 继续生成
    await this.deps.sessionManager.startLoop(sessionId, messageId)

    const streamingGenerator = new (await import('../streaming/streamingGenerator')).StreamingGenerator(this.deps)
    await streamingGenerator.continueStream(sessionId, messageId)
  }

  private async waitForMcpServiceReady(serverName: string, maxWaitTime: number = 3000): Promise<void> {
    const startTime = Date.now()

    return new Promise((resolve) => {
      const checkReady = async () => {
        try {
          const isRunning = await this.deps.mcpPresenter.isServerRunning(serverName)
          if (isRunning) {
            setTimeout(() => resolve(), 200)
            return
          }

          if (Date.now() - startTime > maxWaitTime) {
            console.warn('[PermissionCoordinator] Timeout waiting for MCP service', serverName)
            resolve()
            return
          }

          setTimeout(checkReady, 100)
        } catch (error) {
          console.error('[PermissionCoordinator] Error checking MCP service status:', error)
          resolve()
        }
      }

      checkReady()
    })
  }

  private isAcpPermissionBlock(block: AssistantMessageBlock): boolean {
    const providerIdFromExtra = this.getExtraString(block, 'providerId')
    return providerIdFromExtra === 'acp'
  }

  private getExtraString(block: AssistantMessageBlock, key: string): string | undefined {
    const extraValue = block.extra?.[key]
    return typeof extraValue === 'string' ? extraValue : undefined
  }

  private getCommandFromPermissionBlock(block: AssistantMessageBlock): string | undefined {
    const extraCommandInfo = this.getExtraString(block, 'commandInfo')
    if (extraCommandInfo) {
      try {
        const parsed = JSON.parse(extraCommandInfo) as { command?: string }
        if (parsed?.command) {
          return parsed.command
        }
      } catch (error) {
        console.warn('[PermissionCoordinator] Failed to parse commandInfo:', error)
      }
    }

    const params = block.tool_call?.params
    if (typeof params === 'string' && params.trim()) {
      try {
        const parsed = JSON.parse(params) as { command?: string }
        if (typeof parsed.command === 'string') {
          return parsed.command
        }
      } catch {
        // Ignore parse errors
      }
    }

    return undefined
  }
}
```

---

### 阶段 5：迁移辅助功能（2天）

#### 5.1 拆分 UtilityHandler

**`src/main/presenter/sessionPresenter/utility/aiService.ts`**

```typescript
import type { Message } from '@shared/chat'
import { preparePromptContent } from '../message/messageBuilder'

export class AIService {
  constructor(
    private llmProviderPresenter: any,
    private configPresenter: any
  ) {}

  async translateText(text: string, sessionId: string): Promise<string> {
    const conversation = await this.conversationPersister.getConversation(sessionId)

    const stream = this.llmProviderPresenter.startStreamCompletion(
      conversation.settings.providerId,
      [
        {
          role: 'system',
          content: 'You are a professional translator. Translate the following text into the user\'s language.'
        },
        {
          role: 'user',
          content: text
        }
      ],
      conversation.settings.modelId,
      `${Date.now()}-translate`,
      0.3,
      2048,
      [],
      undefined,
      undefined,
      undefined,
      false,
      false,
      undefined,
      sessionId
    )

    let result = ''
    for await (const event of stream) {
      if (event.type === 'response') {
        result += event.data.content || ''
      }
    }

    return result || text
  }

  async askAI(text: string, sessionId: string): Promise<string> {
    const conversation = await this.conversationPersister.getConversation(sessionId)

    const stream = this.llmProviderPresenter.startStreamCompletion(
      conversation.settings.providerId,
      [
        {
          role: 'system',
          content: 'You are a helpful AI assistant.'
        },
        {
          role: 'user',
          content: text
        }
      ],
      conversation.settings.modelId,
      `${Date.now()}-ask-ai`,
      0.7,
      2048,
      [],
      undefined,
      undefined,
      undefined,
      false,
      false,
      undefined,
      sessionId
    )

    let result = ''
    for await (const event of stream) {
      if (event.type === 'response') {
        result += event.data.content || ''
      }
    }

    return result || 'Sorry, I could not generate a response.'
  }
}
```

**`src/main/presenter/sessionPresenter/utility/titleGenerator.ts`**

```typescript
export class TitleGenerator {
  constructor(private llmProviderPresenter: any, private configPresenter: any) {}

  async generateTitle(conversationId: string, maxRetries: number = 3): Promise<string> {
    const conversation = await this.conversationPersister.getConversation(conversationId)
    const messages = await this.messagePersister.queryMessages(conversationId)

    if (messages.length < 3) {
      return 'New Chat'
    }

    const userMessages = messages.filter((msg) => msg.role === 'user')
    if (userMessages.length === 0) {
      return 'New Chat'
    }

    // 使用前3条用户消息生成标题
    const contextText = userMessages.slice(0, 3).map((msg) => {
      const content = JSON.parse(msg.content)
      return (content.text || content.content as string || '...').slice(0, 200)
    }).join('\n\n')

    const prompt = `Generate a concise title (max 50 characters) for this conversation based on the user messages:\n\n${contextText}\n\nOnly output the title, no other text.`

    const stream = this.llmProviderPresenter.startStreamCompletion(
      conversation.settings.providerId,
      [
        {
          role: 'system',
          content: 'You are a helpful assistant that generates concise conversation titles.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      conversation.settings.modelId,
      `${Date.now()}-title`,
      0.7,
      100,
      [],
      undefined,
      undefined,
      undefined,
      false,
      false,
      undefined,
      conversationId
    )

    let result = ''
    for await (const event of stream) {
      if (event.type === 'response') {
        result += event.data.content || ''
      }
    }

    const title = result.trim().slice(0, 50)
    return title || 'New Chat'
  }
}
```

**`src/main/presenter/sessionPresenter/utility/debuggerService.ts`**

```typescript
export class DebuggerService {
  constructor(
    private sessionManager: any,
    private messagePersister: any
  ) {}

  async getMessageRequestPreview(messageId: string): Promise<unknown> {
    const message = await this.messagePersister.getMessage(messageId)
    const conversation = await this.conversationPersister.getConversation(message.conversationId)

    const { contextMessages, userMessage } = await this.deps.streamingGenerator.prepareConversationContext(
      message.conversationId,
      message.parentId
    )

    // 构建请求预览（脱敏敏感信息）
    const preview = {
      conversationId: message.conversationId,
      messageId: message.id,
      settings: {
        providerId: conversation.settings.providerId,
        modelId: conversation.settings.modelId,
        temperature: conversation.settings.temperature,
        maxTokens: conversation.settings.maxTokens,
        enabledMcpTools: conversation.settings.enabledMcpTools
      },
      contextMessagesCount: contextMessages.length,
      userMessage: {
        role: userMessage.role,
        content: typeof userMessage.content === 'string'
          ? userMessage.content.slice(0, 200) + '...'
          : '[Complex content]'
      },
      toolDefinitions: this.previewToolDefinitions(conversation),
      reasoningBudget: conversation.settings.thinkingBudget,
      searchEnabled: conversation.settings.enableSearch
    }

    return preview
  }

  private previewToolDefinitions(conversation: any): Array<{ name: string; count: number }> {
    // 返回工具定义的摘要信息
    return []
  }
}
```

**`src/main/presenter/sessionPresenter/utility/index.ts`**

```typescript
export { AIService } from './aiService'
export { TitleGenerator } from './titleGenerator'
export { DebuggerService } from './debuggerService'
```

#### 5.2 创建独立的权限检查服务

**`src/main/presenter/permission/commandPermissionService.ts`**

```typescript
import { CommandPermissionCache } from './commandPermissionCache'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface PermissionCheckResult {
  allowed: boolean
  reason: 'whitelist' | 'session' | 'permission' | 'invalid'
  riskLevel?: RiskLevel
}

export class CommandPermissionService {
  private static instance: CommandPermissionService
  private readonly cache: CommandPermissionCache = new CommandPermissionCache()

  private static readonly SAFE_COMMANDS = new Set([
    'ls', 'pwd', 'cd', 'cat', 'head', 'tail', 'grep', 'find',
    'echo', 'printf', 'date', 'whoami', 'id', 'env'
  ])

  private static readonly RISK_PATTERNS = [
    { pattern: /rm\s+-r?f?\s*\//, level: 'critical' as const },
    { pattern: /:\s*\(.*\)/, level: 'medium' as const }, // 命令链
    { pattern: /sudo\s+[^-]/, level: 'high' as const },
    { pattern: /\.\/|sh\s+/, level: 'medium' as const },
    { pattern: /curl|wget|nc|telnet/, level: 'medium' as const }
  ]

  static getInstance(): CommandPermissionService {
    if (!CommandPermissionService.instance) {
      CommandPermissionService.instance = new CommandPermissionService()
    }
    return CommandPermissionService.instance
  }

  checkPermission(conversationId: string, command: string): PermissionCheckResult {
    // 1. 检查白名单
    const baseCommand = this.extractBaseCommand(command)
    if (CommandPermissionService.SAFE_COMMANDS.has(baseCommand)) {
      return { allowed: true, reason: 'whitelist', riskLevel: 'low' }
    }

    // 2. 检查会话缓存
    const signature = this.extractCommandSignature(command)
    const cached = this.cache.get(conversationId, signature)
    if (cached) {
      return { allowed: true, reason: 'session', riskLevel: cached.riskLevel }
    }

    // 3. 评估风险
    const riskLevel = this.assessCommandRisk(command)
    if (riskLevel === 'low') {
      return { allowed: true, reason: 'whitelist', riskLevel }
    }

    return { allowed: false, reason: 'permission', riskLevel }
  }

  assessCommandRisk(command: string): RiskLevel {
    // 检查高风险模式
    for (const { pattern, level } of CommandPermissionService.RISK_PATTERNS) {
      if (pattern.test(command)) {
        return level
      }
    }

    // 检查构建命令
    if (/^npm run|gradlew|mvn\b/.test(command)) {
      return 'medium'
    }

    // 检查文件操作
    if (/^rm\s+|^mv\s+|^cp\s+/.test(command)) {
      const target = command.split(/\s+/).pop()
      if (target?.includes('/') && !target.includes('.')) {
        return 'high' // 删除/移动目录
      }
    }

    return 'low'
  }

  approve(conversationId: string, signature: string, remember: boolean): void {
    const command = this.parseCommandFromSignature(signature)
    const riskLevel = this.assessCommandRisk(command)
    this.cache.set(conversationId, signature, { riskLevel, remember })
  }

  clearConversation(conversationId: string): void {
    this.cache.clearConversation(conversationId)
  }

  clearAll(): void {
    this.cache.clearAll()
  }

  extractBaseCommand(command: string): string {
    return command.trim().split(/\s+/)[0].replace(/^-+/, '')
  }

  extractCommandSignature(command: string): string {
    const baseCommand = this.extractBaseCommand(command)
    const args = command.split(/\s+/).slice(1).join(' ')
    return `${baseCommand} ${args}`.trim()
  }

  private parseCommandFromSignature(signature: string): string {
    return signature
  }
}

// 导出缓存类
export { CommandPermissionCache } from './commandPermissionCache'
```

**`src/main/presenter/permission/commandPermissionCache.ts`**

```typescript
import type { RiskLevel } from './commandPermissionService'

interface CacheEntry {
  riskLevel: RiskLevel
  remember: boolean
  timestamp: number
}

export class CommandPermissionCache {
  private readonly cache: Map<string, Map<string, CacheEntry>> = new Map()
  private readonly GLOBAL_CACHE_KEY = '_global'

  get(conversationId: string, signature: string): CacheEntry | null {
    const sessionCache = this.cache.get(conversationId)
    if (sessionCache) {
      const entry = sessionCache.get(signature)
      if (entry && entry.remember) {
        return entry
      }
    }

    // 检查全局缓存
    const globalCache = this.cache.get(this.GLOBAL_CACHE_KEY)
    if (globalCache) {
      return globalCache.get(signature) || null
    }

    return null
  }

  set(conversationId: string, signature: string, entry: Omit<CacheEntry, 'timestamp'>): void {
    const cache = remember ? this.cache.get(this.GLOBAL_CACHE_KEY) : this.cache.get(conversationId)
    if (!cache) {
      if (entry.remember) {
        this.cache.set(this.GLOBAL_CACHE_KEY, new Map())
      } else {
        this.cache.set(conversationId, new Map())
      }
    }

    const targetCache = entry.remember
      ? this.cache.get(this.GLOBAL_CACHE_KEY)!
      : this.cache.get(conversationId)!

    targetCache.set(signature, {
      ...entry,
      timestamp: Date.now()
    })
  }

  clearConversation(conversationId: string): void {
    this.cache.delete(conversationId)
  }

  clearAll(): void {
    this.cache.clear()
  }
}
```

**`src/main/presenter/permission/index.ts`**

```typescript
export { CommandPermissionService } from './commandPermissionService'
export { CommandPermissionCache } from './commandPermissionCache'
export type { RiskLevel, PermissionCheckResult } from './commandPermissionService'
```

#### 5.3 创建内容处理服务

**`src/main/presenter/content/contentEnricher.ts`**

```typescript
import axios from 'axios'
import * as cheerio from 'cheerio'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { IConfigPresenter, SearchResult } from '@shared/presenter'

export class ContentEnricher {
  private static instance: ContentEnricher

  constructor(private configPresenter: IConfigPresenter) {}

  static getInstance(configPresenter: IConfigPresenter): ContentEnricher {
    if (!ContentEnricher.instance) {
      ContentEnricher.instance = new ContentEnricher(configPresenter)
    }
    return ContentEnricher.instance
  }

  static async extractAndEnrichUrls(text: string): Promise<SearchResult[]> {
    const urlRegex = /https?:\/\/[^\s]+/g
    const urls = text.match(urlRegex) || []

    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          return await ContentEnricher.enrichUrl(url, {})
        } catch (error) {
          console.error('Failed to enrich URL:', url, error)
          return null
        }
      })
    )

    return results.filter((r): r is SearchResult => r !== null)
  }

  static async enrichUrl(url: string, config: any = {}): Promise<SearchResult> {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    const $ = cheerio.load(response.data)

    const title = $('title').text().trim()
    const description = $('meta[name="description"]').attr('content') || ''
    const favicon = ContentEnricher.extractFavicon(url, $)
    const content = ContentEnricher.extractMainContent($)

    return {
      title,
      url,
      description,
      favicon,
      content: content.slice(0, 5000)
    }
  }

  static extractFavicon(url: string, $: cheerio.CheerioAPI): string {
    const faviconUrl = $('link[rel="icon"], link[rel="shortcut icon"]').attr('href')
    if (!faviconUrl) {
      return ''
    }

    try {
      return new URL(faviconUrl, url).href
    } catch {
      return ''
    }
  }

  static extractMainContent($: cheerio.CheerioAPI): string {
    // 移除不需要的元素
    $('script, style, nav, footer, aside, header').remove()

    // 尝试多种选择器
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '#content',
      'body'
    ]

    for (const selector of selectors) {
      const element = $(selector).first()
      if (element.length > 0) {
        return element.text().trim().slice(0, 10000)
      }
    }

    return $('body').text().trim().slice(0, 10000)
  }

  static async htmlToMarkdown(html: string): Promise<string> {
    // 使用 turndown 或类似库
    return html.replace(/<[^>]+>/g, '')
  }
}

export { ContentEnricher } from './contentEnricher'
```

---

### 阶段 6：更新 IPC 接口（1-2天）

#### 6.1 更新 `@shared/presenter.d.ts`

```typescript
export interface ISessionPresenter extends IThreadPresenter {
  // === Session Lifecycle ===
  createSession(params: CreateSessionParams): Promise<string>
  getSession(sessionId: string): Promise<Session>
  getSessionList(page: number, pageSize: number): Promise<{total: number; sessions: Session[]}>
  renameSession(sessionId: string, title: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void>
  updateSessionSettings(sessionId: string, settings: Partial<Session['config']>): Promise<void>

  // === Session-Tab Binding ===
  bindToTab(sessionId: string, tabId: number): Promise<void>
  unbindFromTab(tabId: number): Promise<void>
  activateSession(tabId: number, sessionId: string): Promise<void>
  getActiveSession(tabId: number): Promise<Session | null>
  findTabForSession(sessionId: string, preferredWindowType?: 'main' | 'floating'): Promise<number | null>

  // === Message ===
  sendMessage(sessionId: string, content: string, tabId?: number, selectedVariantsMap?: Record<string, string>): Promise<AssistantMessage | null>
  editMessage(messageId: string, content: string): Promise<Message>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string): Promise<Message>
  getMessage(messageId: string): Promise<Message>
  getMessageVariants(messageId: string): Promise<Message[]>
  getMessageThread(sessionId: string, page: number, pageSize: number): Promise<{ total: number; messages: Message[] }>
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  getContextMessages(sessionId: string): Promise<Message[]>
  getLastUserMessage(sessionId: string): Promise<Message | null>

  // === Loop Control ===
  startStreamCompletion(sessionId: string, queryMsgId?: string, selectedVariantsMap?: Record<string, string>): Promise<void>
  continueStreamCompletion(sessionId: string, queryMsgId: string, selectedVariantsMap?: Record<string, string>): Promise<void>
  stopStreamCompletion(sessionId: string, messageId?: string): Promise<void>
  regenerateFromUserMessage(sessionId: string, userMessageId: string, selectedVariantsMap?: Record<string, string>): Promise<AssistantMessage>

  // === Session Branching ===
  forkSession(targetSessionId: string, targetMessageId: string, newTitle: string, settings?: Partial<Session['config']>, selectedVariantsMap?: Record<string, string>): Promise<string>
  createChildSessionFromSelection(params: CreateChildSessionParams): Promise<string>
  listChildSessionsByParent(parentSessionId: string): Promise<Session[]>
  listChildSessionsByMessageIds(parentMessageIds: string[]): Promise<Session[]>

  //=== Session Helpers ===
  clearContext(sessionId: string): Promise<void>
  clearAllMessages(sessionId: string): Promise<void>
  stopSessionGeneration(sessionId: string): Promise<void>

  // === Permission ===
  handlePermissionResponse(messageId: string, toolCallId: string, granted: boolean, permissionType: 'read' | 'write' | 'all' | 'command', remember?: boolean): Promise<void>

  // === Utility ===
  translateText(text: string, sessionId: string): Promise<string>
  askAI(text: string, sessionId: string): Promise<string>
  generateTitle(sessionId: string): Promise<string>
  getMessageRequestPreview(messageId: string): Promise<unknown>

  // === ACP Workdir ===
  getAcpWorkdir(conversationId: string, agentId: string): Promise<AcpWorkdirInfo>
  setAcpWorkdir(conversationId: string, agentId: string, workdir: string | null): Promise<void>
  warmupAcpProcess(agentId: string, workdir: string): Promise<void>
  getAcpProcessModes(agentId: string, workdir: string): Promise<{availableModes?: any; currentModeId?: string}>
  setAcpPreferredProcessMode(agentId: string, workdir: string, modeId: string)
  setAcpSessionMode(conversationId: string, modeId: string): Promise<void>
  getAcpSessionModes(conversationId: string): Promise<{current: string; available: any[]}>
}

export interface ISearchPresenter {
  getEngines(): Promise<SearchEngineTemplate[]>
  getActiveEngine(): Promise<SearchEngineTemplate>
  setActiveEngine(engineId: string): Promise<void>
  testEngine(query?: string): Promise<boolean>
  updateEngines(engines: SearchEngineConfig[]): Promise<void>
  addCustomEngine(engine: SearchEngineConfig): Promise<void>
  removeCustomEngine(engineId: string): Promise<void>
}

export interface IExporter {
  exportConversation(conversationId: string, format: 'markdown' | 'html' | 'txt'): Promise<{filename: string; content: string}>
}
```

#### 6.2 更新渲染进程调用示例

在 `src/renderer/` 中寻找所有 `threadPresenter` 的调用：

```typescript
// 之前：
await presenter.threadPresenter.createConversation(title, settings, tabId)
await presenter.threadPresenter.sendMessage(conversationId, content, 'user')
await presenter.threadPresenter.getSearchEngines()

// 之后：
await presenter.sessionPresenter.createSession({ title, settings, tabId })
await presenter.sessionPresenter.sendMessage(conversationId, content, tabId)
await presenter.searchPresenter.getEngines()
```

---

### 阶段 7：清理与测试（2-3天）

#### 7.1 删除 threadPresenter

```bash
# 确认所有功能已迁移后执行
rm -rf src/main/presenter/threadPresenter
```

#### 7.2 更新导入

全局搜索并替换：

```bash
# 搜索所有引用 threadPresenter 的文件
grep -r "threadPresenter" src/main src/renderer --include="*.ts" --include="*.tsx"

# 替换导入语句
from '@/presenter/threadPresenter'
  →
from '@/presenter/sessionPresenter'
```

#### 7.3 更新主 Presenter

**修改 `src/main/presenter/index.ts`：**

```typescript
export class Presenter implements IPresenter {
  windowPresenter: IWindowPresenter
  sqlitePresenter: ISQLitePresenter
  llmproviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter

  // 新增
  sessionPresenter: ISessionPresenter
  searchPresenter: ISearchPresenter

  // 移除
  // threadPresenter: IThreadPresenter

  agentPresenter: IAgentPresenter
  // ... 其他 presenter

  private constructor(lifecycleManager: ILifecycleManager) {
    this.lifecycleManager = lifecycleManager
    const context = lifecycleManager.getLifecycleContext()
    this.configPresenter = context.config as IConfigPresenter
    this.sqlitePresenter = context.database as ISQLitePresenter

    // 初始化其他 presenter
    this.windowPresenter = new WindowPresenter(this.configPresenter)
    this.tabPresenter = new TabPresenter(this.windowPresenter)
    this.llmproviderPresenter = new LLMProviderPresenter(this.configPresenter, this.sqlitePresenter)

    // 初始化 SessionPresenter (包含会话管理、Agent Loop、ACP等)
    const commandPermissionService = CommandPermissionService.getInstance()
    this.sessionPresenter = new SessionPresenter({
      sessionManager: new SessionManager({...}),
      tabManager: new TabManager(...),
      conversationPersister: new ConversationPersister(this.sqlitePresenter),
      messagePersister: new MessagePersister(this.sqlitePresenter),
      agentLoopHandler: new AgentLoopHandler(...),
      toolCallCenter: new ToolCallCenter(...),
      configPresenter: this.configPresenter,
      toolPresenter: this.toolPresenter,
      llmProviderPresenter: this.llmproviderPresenter
    })

    // 初始化 SearchPresenter
    this.searchPresenter = new SearchPresenter({
      configPresenter: this.configPresenter,
      windowPresenter: this.windowPresenter,
      contentEnricher: ContentEnricher.getInstance(this.configPresenter)
    })

    // 初始化其他 presenter...
  }

  // ...
}
```

#### 7.4 测试清单

**核心会话功能：**
- ✅ 创建会话（createSession）
- ✅ 删除会话（deleteSession）
- ✅ 重命名会话（renameSession）
- ✅ 获取会话列表（getSessionList）
- ✅ 会话固定/取消固定（toggleSessionPinned）

**消息功能：**
- ✅ 发送消息（sendMessage）
- ✅ 编辑消息（editMessage）
- ✅ 删除消息（deleteMessage）
- ✅ 重试消息（retryMessage）
- ✅ 获取消息（getMessage）
- ✅ 获取消息变体（getMessageVariants）
- ✅ 分页加载消息（getMessageThread）
- ✅ 获取上下文消息（getContextMessages）

**会话分支：**
- ✅ 创建分支会话（forkSession）
- ✅ 创建子会话（createChildSessionFromSelection）
- ✅ 查询子会话（listChildSessionsByParent）

**Tab 绑定：**
- ✅ 绑定会话到 tab（bindToTab）
- ✅ 解绑会话（unbindFromTab）
- ✅ 激活会话（activateSession）
- ✅ 获取激活会话（getActiveSession）
- ✅ 查找会话的 tab（findTabForSession）

**Agent Loop：**
- ✅ 启动流式生成（startStreamCompletion）
- ✅ 继续流式生成（continueStreamCompletion）
- ✅ 停止生成（cancelLoop）
- ✅ 从用户消息重新生成（regenerateFromUserMessage）

**权限系统：**
- ✅ 处理权限响应（handlePermissionResponse）
- ✅ 命令权限检查（CommandPermissionService）
- ✅ ACP 权限流程
- ✅ MCP 权限流程

**搜索功能：**
- ✅ 获取搜索引擎列表（getEngines）
- ✅ 设置激活的搜索引擎（setActiveEngine）
- ✅ 测试搜索引擎（testEngine）
- ✅ 执行搜索（executeSearch）

**辅助功能：**
- ✅ 翻译文本（translateText）
- ✅ AI 问答（askAI）
- ✅ 生成标题（generateTitle）
- ✅ 导出会话（exportConversation）

---

## 依赖更新清单

### 需要更新的文件

1. **`src/main/presenter/index.ts`**
   - 添加 `sessionPresenter`, `searchPresenter`, `exporter` 实例
   - 移除 `threadPresenter`
   - 更新依赖注入

2. **`src/main/presenter/toolPresenter/index.ts`**
   - 更新 `CommandPermissionHandler` 导入路径为 `@/main/presenter/permission`

3. **`src/shared/presenter.d.ts`**
   - 更新 `ISessionPresenter`, `ISearchPresenter`, `IExporter` 接口

4. **所有引用 threadPresenter 的渲染进程文件**
   - 更新导入语句
   - 更新方法调用名称

---

## 关键风险点与缓解措施

### 1. 权限系统耦合

**风险**：`PermissionHandler` 依赖多个 presenter (LLMProvider, MCP, Tool)

**缓解措施**：
- 创建 `PermissionCoordinator` 在 sessionPresenter 内部协调
- 通过接口依赖注入，避免直接引用

### 2. 循环依赖

**风险**：StreamGenerationHandler 依赖 SearchHandler，反之亦然

**缓解措施**：
- 使用 `ISearchPresenter` 接口
- 通过依赖注入，避免直接引用

### 3. 消息变体

**风险**：上下文消息构建依赖变体系统

**缓解措施**：
- 在 `MessageManager` 中完整实现变体逻辑
- 在 `prepareConversationContext` 中处理变体选择

### 4. 搜索提示模板

**风险**：`const.ts` 包含硬编码的搜索提示

**缓解措施**：
- 提取到 `searchPrompts/`，保持可配置性
- 支持模板的动态加载和更新

### 5. 测试覆盖

**风险**：大规模重构可能导致现有测试失败

**缓解措施**：
- 先迁移并测试单个模块
- 逐步集成，每个阶段都运行测试
- 补充新的测试用例

---

## 工作量估算

| 阶段 | 工作内容 | 预计时间 | 风险 |
|------|----------|----------|------|
| 1 | 准备基础设施 | 1-2天 | 低 |
| 2 | 迁移搜索功能 | 2-3天 | 中 |
| 3 | 迁移导出功能 | 1-2天 | 低 |
| 4 | 迁移会话核心功能 | 3-4天 | **高** |
| 5 | 迁移辅助功能 | 2天 | 中 |
| 6 | 更新 IPC 接口 | 1-2天 | 中 |
| 7 | 清理与测试 | 2-3天 | **高** |
| **总计** | | **12-16天** | |

---

## 后续优化建议

### 1. 单元测试
在迁移过程中或完成后，为关键模块添加单元测试：
- `SessionManager` 测试
- `MessageManager` 测试
- `PermissionCoordinator` 测试

### 2. 类型安全
完善 TypeScript 类型定义，减少 `any` 类型的不必要使用

### 3. 性能优化
- 优化大消息的加载和传输
- 实现消息分页的虚拟滚动
- 优化搜索结果的提取和缓存

### 4. 文档更新
更新 API 文档和架构说明文档

---

## 附录：文件移动清单

### 从 threadPresenter 迁移到 sessionPresenter

| 源文件 | 目标位置 | 优先级 |
|--------|----------|--------|
| `managers/conversationManager.ts` | `sessionPresenter/managers/` | P0 |
| `managers/messageManager.ts` | `sessionPresenter/managers/` | P0 |
| `handlers/streamGenerationHandler.ts` | 整合到 `sessionPresenter/streaming/` | P0 |
| `handlers/llmEventHandler.ts` | 整合到 `sessionPresenter/streaming/` | P0 |
| `handlers/toolCallHandler.ts` | 整合到 `sessionPresenter/loop/` | P1 |
| `handlers/permissionHandler.ts` | `sessionPresenter/permission/` | P0 |
| `handlers/contentBufferHandler.ts` | 整合到 `sessionPresenter/streaming/` | P1 |
| `handlers/searchHandler.ts` | `searchPresenter/handlers/` | P0 |
| `handlers/utilityHandler.ts` | 拆分到多个模块 | P0 |
| `handlers/commandPermissionHandler.ts` | `permission/` | P0 |
| `exporters/conversationExporter.ts` | `exporter/formats/` | P1 |
| `utils/contentEnricher.ts` | `content/` | P2 |
| `const.ts` (搜索提示) | `searchPrompts/templates/` | P2 |
| `types.ts` | 部分到 `sessionPresenter/types.ts` | P0 |

### 从 threadPresenter 迁移到 searchPresenter

| 源文件 | 目标位置 | 优先级 |
|--------|----------|--------|
| `managers/searchManager.ts` | `searchPresenter/managers/` | P0 |
| `handlers/searchHandler.ts` | `searchPresenter/handlers/` | P0 |

### 从 threadPresenter 迁移到共享模块

| 源文件 | 目标位置 | 优先级 |
|--------|----------|--------|
| `handlers/commandPermissionHandler.ts` | `permission/commandPermissionService.ts` | P0 |
| `utils/contentEnricher.ts` | `content/contentEnricher.ts` | P2 |

---

## 总结

这份迁移方案提供了从 `threadPresenter` 到 `sessionPresenter` 的完整迁移路径，包括：

1. **清晰的模块划分**：根据功能职责将功能分配到合适的模块
2. **详细的实施步骤**：7个阶段，每个阶段都有具体的任务和代码示例
3. **完整的风险分析**：识别关键风险点并提供缓解措施
4. **准确的工作量估算**：12-16天，可分阶段实施
5. **测试清单**：确保迁移后所有功能正常运行

核心原则是：
- **完全迁移**：不保留向后兼容
- **功能归位**：会话相关功能去 sessionPresenter，辅助功能去合适的地方
- **保留特性**：子会话、消息变体、搜索、导出等所有功能完整保留

迁移完成后，将获得：
- 更清晰的架构和职责分离
- 更好的可维护性和可测试性
- 更容易扩展的功能模块
- 统一的术语概念（session 替代 thread）
