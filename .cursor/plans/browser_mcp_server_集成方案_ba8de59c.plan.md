---
name: Browser MCP Server 集成方案
overview: 将 UI-TARS 的 browser MCP server 移植到 deepchat 作为 inmem server，使用 Electron BrowserWindow 替代 Puppeteer，实现会话隔离和窗口显示控制
todos:
  - id: create-session-manager
    content: 创建 BrowserSessionManager：实现会话创建、获取、清理，管理 conversationId 到 BrowserWindow 的映射
    status: pending
  - id: create-browser-adapter
    content: 创建 ElectronBrowserAdapter：实现 Browser 接口，管理 BrowserWindow 实例，支持 headless 模式
    status: pending
  - id: create-page-adapter
    content: 创建 ElectronPageAdapter：实现 Page 接口核心方法，使用 webContents API 实现导航和脚本执行
    status: pending
  - id: implement-navigate-tools
    content: 实现导航工具：browser_navigate, browser_go_back, browser_go_forward
    status: pending
    dependencies:
      - create-page-adapter
  - id: implement-action-tools
    content: 实现交互工具：browser_click, browser_hover, browser_form_input_fill, browser_select, browser_scroll, browser_press_key
    status: pending
    dependencies:
      - create-page-adapter
  - id: implement-content-tools
    content: 实现内容获取工具：browser_get_text, browser_get_markdown, browser_read_links
    status: pending
    dependencies:
      - create-page-adapter
  - id: implement-dom-tree
    content: 实现 DOM 树工具：browser_get_clickable_elements，注入 DOM 树构建脚本，创建 selectorMap
    status: pending
    dependencies:
      - create-page-adapter
  - id: implement-screenshot
    content: 实现截图工具：browser_screenshot，支持元素截图和全页截图，支持高亮功能
    status: pending
    dependencies:
      - create-page-adapter
  - id: implement-tabs-tools
    content: 实现标签页管理工具：browser_new_tab, browser_tab_list, browser_switch_tab, browser_close_tab
    status: pending
    dependencies:
      - create-browser-adapter
  - id: implement-download
    content: 实现下载管理工具：browser_get_download_list，监听下载事件，跟踪下载进度
    status: pending
    dependencies:
      - create-page-adapter
  - id: create-browser-server
    content: 创建 BrowserServer 类：实现 Server 接口，注册所有工具和资源，从配置读取 showWindow 选项
    status: pending
    dependencies:
      - implement-navigate-tools
      - implement-action-tools
      - implement-content-tools
      - implement-dom-tree
      - implement-screenshot
      - implement-tabs-tools
      - implement-download
  - id: update-builder
    content: 更新 builder.ts：添加 deepchat-inmemory/browser-server 到 getInMemoryServer，传递配置参数
    status: pending
    dependencies:
      - create-browser-server
  - id: update-config-types
    content: 更新配置类型定义：在 @shared/presenter 中添加 BrowserServerConfig 类型，支持 showWindow 配置项
    status: pending
  - id: implement-session-context
    content: 实现会话上下文获取：从 tool call 上下文获取 conversationId，确保会话隔离
    status: pending
    dependencies:
      - create-session-manager
  - id: implement-network-idle
    content: 实现网络空闲检测：监听加载事件，实现 waitForNetworkIdle 功能
    status: pending
    dependencies:
      - create-page-adapter
  - id: implement-wait-selector
    content: 实现元素等待功能：实现 waitForSelector，支持超时配置
    status: pending
    dependencies:
      - create-page-adapter
  - id: resource-management
    content: 实现资源管理：会话超时清理，监控资源使用，处理窗口关闭等异常
    status: pending
    dependencies:
      - create-session-manager
---

# Browser MCP Server 集成方案

## 一、概述

将 UI-TARS-desktop-main 中的 browser MCP server 移植到 deepchat，作为 inmem server 实现。使用 Electron BrowserWindow 替代 Puppeteer，实现完整的浏览器自动化功能，并支持会话隔离和窗口显示控制。

**核心原则**：

- **直接使用** `@agent-infra/browser-use` 和 `@agent-infra/browser-context` 库，不重复造轮子
- **不参考** ContentEnricher，使用 browser MCP 中的结构化 DOM 方案
- 专注于实现 Electron 适配器和会话管理，复用现有库的功能

## 二、架构设计

### 2.1 核心组件

```
deepchat/src/main/presenter/mcpPresenter/inMemoryServers/
├── browserServer.ts          # 主服务器类
├── browserAdapter/           # 浏览器适配器层
│   ├── ElectronBrowserAdapter.ts    # Browser 适配器
│   ├── ElectronPageAdapter.ts       # Page 适配器
│   └── ElectronCDPSessionAdapter.ts # CDP 会话适配器（可选）
├── browserContext/          # 浏览器上下文管理
│   ├── BrowserSessionManager.ts     # 会话管理器（按 conversationId 隔离）
│   └── BrowserWindowManager.ts     # 窗口管理器
└── browserTools/            # 工具实现
    ├── navigate.ts          # 导航工具
    ├── action.ts            # 交互工具
    ├── content.ts           # 内容获取工具
    ├── tabs.ts              # 标签页管理工具
    ├── screenshot.ts        # 截图工具
    ├── download.ts          # 下载管理工具
    └── vision.ts            # Vision 模式工具（可选）
```

### 2.2 会话隔离机制

- **BrowserSessionManager**: 管理每个 conversationId 对应的浏览器会话
- **会话存储**: `Map<conversationId, BrowserSession>`
- **窗口隔离**: 每个会话拥有独立的 BrowserWindow 实例
- **生命周期**: 会话结束时自动清理窗口和资源

### 2.3 配置支持

在 MCP server 配置中添加 `showWindow` 选项：

```typescript
interface BrowserServerConfig {
  showWindow?: boolean  // 是否显示浏览器窗口，默认 false（headless）
  // 其他配置项...
}
```

## 三、实现步骤

### 阶段一：核心适配器和会话管理

1. **创建 BrowserSessionManager**

   - 实现会话创建、获取、清理
   - 管理 conversationId 到 BrowserWindow 的映射
   - 实现会话超时和自动清理机制

2. **创建 ElectronBrowserAdapter**

   - 实现 Browser 接口（pages, newPage, close）
   - 管理 BrowserWindow 实例
   - 支持 headless 模式（show: false）

3. **创建 ElectronPageAdapter**

   - 实现 Page 接口的核心方法，**重点实现 `evaluate()` 方法以兼容 @agent-infra/browser-use**
   - 实现 `$()` 方法返回 ElementHandle 适配器（用于 `locateElement`）
   - 使用 webContents API 实现导航、脚本执行等
   - 实现事件监听和状态管理
   - **确保与 @agent-infra/browser-use 的函数兼容**

### 阶段二：工具实现

4. **导航工具** (`browser_navigate`, `browser_go_back`, `browser_go_forward`)

   - 使用 `webContents.loadURL()` 实现导航
   - 等待页面加载完成（监听 `did-finish-load`）
   - 构建 DOM 树并返回可点击元素列表

5. **交互工具** (`browser_click`, `browser_hover`, `browser_form_input_fill`, `browser_select`, `browser_scroll`, `browser_press_key`)

   - **直接使用** `@agent-infra/browser-use` 的 `locateElement()` 定位元素
   - **直接使用** `removeHighlights()` 移除高亮
   - 通过 `executeJavaScript` 实现 DOM 操作（点击、输入、滚动等）
   - 支持索引和选择器两种定位方式
   - 元素定位后通过 `evaluate()` 执行交互操作

6. **内容获取工具** (`browser_get_text`, `browser_get_markdown`, `browser_read_links`)

   - **直接使用** `@agent-infra/browser-context` 的 `extractContent()` 提取内容并转换为 Markdown（结构化 DOM 方案，优于 ContentEnricher）
   - 使用 `evaluate` 提取页面文本（`document.body.innerText`）
   - 使用 `evaluate` 提取链接信息（查询所有 `a[href]` 元素）
   - 通过 ElectronPageAdapter 的 `evaluate()` 方法执行

7. **DOM 树工具** (`browser_get_clickable_elements`)

   - **直接使用** `@agent-infra/browser-use` 的 `getBuildDomTreeScript()` 注入脚本
   - **直接使用** `parseNode()` 和 `createSelectorMap()` 解析节点
   - **直接使用** `DOMElementNode.clickableElementsToString()` 生成列表
   - 通过 ElectronPageAdapter 的 `evaluate()` 方法执行脚本

8. **截图工具** (`browser_screenshot`)

   - 使用 `webContents.capturePage()` 实现截图
   - 支持元素截图和全页截图
   - 支持高亮元素功能

9. **标签页管理工具** (`browser_new_tab`, `browser_tab_list`, `browser_switch_tab`, `browser_close_tab`)

   - 管理多个 BrowserWindow 实例
   - 实现窗口切换和关闭

10. **下载管理工具** (`browser_get_download_list`)

    - 监听 `session.on('will-download')` 事件
    - 跟踪下载进度和状态
    - 提供下载列表查询接口

### 阶段三：集成和配置

11. **创建 BrowserServer 类**

    - 实现 Server 接口
    - 注册所有工具
    - 注册资源（console logs, downloads, screenshots）
    - 从配置中读取 `showWindow` 选项

12. **更新 builder.ts**

    - 添加 `deepchat-inmemory/browser-server` 到 getInMemoryServer
    - 传递配置参数（包括 showWindow）

13. **更新配置类型定义**

    - 在 `@shared/presenter` 中添加 BrowserServerConfig 类型
    - 支持 showWindow 配置项

14. **实现会话上下文获取**

    - 从 tool call 的上下文中获取 conversationId
    - 如果无法获取，使用默认会话或创建新会话
    - 确保会话隔离

### 阶段四：优化和测试

15. **实现网络空闲检测**

    - **参考** `@agent-infra/browser-use` 的 `waitForStableNetwork()` 实现
    - 监听 Electron 的 `did-start-loading` 和 `did-stop-loading` 事件
    - 监听 `webContents.session.webRequest` 事件跟踪网络请求
    - 实现 `waitForNetworkIdle()` 方法，用于内容提取前等待页面完全加载

16. **实现元素等待功能**

    - 实现 waitForSelector（轮询或 MutationObserver）
    - 支持超时配置

17. **内存和资源管理**

    - 实现窗口复用机制（可选）
    - 实现会话超时清理
    - 监控资源使用情况

18. **错误处理和日志**

    - 完善错误处理机制
    - 添加详细的日志记录
    - 处理窗口关闭、页面崩溃等异常情况

## 四、关键技术点

### 4.1 会话隔离实现

```typescript
class BrowserSessionManager {
  private sessions = new Map<string, BrowserSession>()
  
  getSession(conversationId: string): BrowserSession {
    if (!this.sessions.has(conversationId)) {
      this.sessions.set(conversationId, this.createSession(conversationId))
    }
    return this.sessions.get(conversationId)!
  }
  
  cleanupSession(conversationId: string): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.window.destroy()
      this.sessions.delete(conversationId)
    }
  }
}
```

### 4.2 窗口显示控制

```typescript
// 在创建 BrowserWindow 时根据配置决定是否显示
const searchWindow = new BrowserWindow({
  width: 800,
  height: 600,
  show: config.showWindow ?? false,  // 从配置读取
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true
  }
})
```

### 4.3 DOM 树构建（使用 @agent-infra/browser-use）

**直接使用库中的功能**：

- `getBuildDomTreeScript()` - 获取 DOM 树构建脚本（纯 JavaScript）
- `parseNode()` - 解析原始 DOM 树节点（纯函数）
- `createSelectorMap()` - 创建选择器映射（纯函数）
- `removeHighlights()` - 移除高亮（需要 Page 接口，通过适配器实现）
- `locateElement()` - 定位元素（需要 Page 接口，通过适配器实现）

**适配器实现**：

- ElectronPageAdapter 需要实现 `evaluate()` 方法以支持这些函数
- 对于 `locateElement()`，需要实现 `$()` 方法返回 ElementHandle 适配器

### 4.4 内容提取和 Markdown 转换（使用 @agent-infra/browser-context）

**直接使用库中的功能**：

- `extractContent(page)` - 从页面提取内容并转换为 Markdown（基于结构化 DOM）
- 该库使用结构化的 DOM 树来识别主内容区域，比 ContentEnricher 更准确
- 返回 `{ title, content }` 格式，content 已经是 Markdown 格式

**实现方式**：

- 在 `browser_get_markdown` 工具中直接调用 `extractContent(page)`
- 等待网络空闲后提取内容（参考 browser MCP 的实现）
- 通过 ElectronPageAdapter 的 `evaluate()` 方法执行

## 五、文件清单

### 需要创建的文件

1. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserServer.ts`
2. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserAdapter/ElectronBrowserAdapter.ts`
3. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserAdapter/ElectronPageAdapter.ts`
4. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserContext/BrowserSessionManager.ts`
5. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserContext/BrowserWindowManager.ts`
6. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserTools/navigate.ts`
7. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserTools/action.ts`
8. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserTools/content.ts`
9. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserTools/tabs.ts`
10. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserTools/screenshot.ts`
11. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/browserTools/download.ts`

### 需要修改的文件

1. `deepchat/src/main/presenter/mcpPresenter/inMemoryServers/builder.ts` - 添加 browser server
2. `deepchat/src/shared/presenter/index.ts` - 添加 BrowserServerConfig 类型定义

## 六、注意事项

1. **会话隔离**: 确保每个 conversationId 的窗口完全独立，不会相互干扰
2. **资源清理**: 会话结束时及时清理窗口和资源，避免内存泄漏
3. **错误处理**: 处理窗口关闭、页面崩溃等异常情况
4. **性能优化**: 考虑窗口复用机制，但要注意会话隔离
5. **配置兼容**: 确保配置项向后兼容，默认值合理
6. **代码复用**: 

   - **直接使用 @agent-infra/browser-use 库**，减少重复实现
   - **直接使用 @agent-infra/browser-context 库**，使用结构化的 DOM 方案提取内容（优于 ContentEnricher）
   - 通过适配器模式实现与库的兼容
   - **不参考 ContentEnricher**，使用 browser MCP 中的结构化 DOM 方案

## 七、依赖管理

### 需要添加的依赖

- `@agent-infra/browser-use` - **直接使用**，提供：
  - DOM 树构建脚本 (`getBuildDomTreeScript`)
  - DOM 节点解析 (`parseNode`, `createSelectorMap`)
  - 元素定位和高亮管理 (`removeHighlights`, `locateElement`)
  - DOM 元素节点类 (`DOMElementNode`)

- `@agent-infra/browser-context` - **直接使用**，提供：
  - 内容提取和 Markdown 转换 (`extractContent`)
  - 基于结构化 DOM 的内容识别方案（优于 ContentEnricher）

**注意**：这些库的函数接受 Puppeteer 的 `Page` 类型，但主要使用 `page.evaluate()` 方法。我们通过 ElectronPageAdapter 实现兼容的接口即可直接使用这些函数。

### 不需要的依赖

- `puppeteer-core` - 使用 Electron BrowserWindow 替代
- `@agent-infra/browser` - 使用 Electron API 替代

### 适配器兼容性

ElectronPageAdapter 需要实现以下方法以兼容 `@agent-infra/browser-use` 和 `@agent-infra/browser-context`：

- `evaluate(fn, ...args)` - 执行 JavaScript（必需，所有库函数依赖此方法）
- `$(selector)` - 查询元素（用于 `locateElement`）
- `url()` - 获取当前 URL（用于内容提取）
- `title()` - 获取页面标题（用于内容提取）
- `waitForNetworkIdle(options?)` - 等待网络空闲（用于内容提取前等待页面加载完成）

## 八、测试要点

1. 会话隔离测试：多个 conversationId 同时使用浏览器，确保窗口不穿透
2. 窗口显示控制测试：验证 showWindow 配置生效
3. 工具功能测试：所有工具正常工作
4. 资源清理测试：会话结束后资源正确清理
5. 异常处理测试：窗口关闭、页面崩溃等异常情况处理