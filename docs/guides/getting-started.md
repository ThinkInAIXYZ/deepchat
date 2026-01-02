# 快速入门指南

本文档帮助开发者快速设置开发环境并开始贡献代码。

## 📋 前置要求

- Node.js ≥ 20.19
- pnpm ≥ 10.11
- Git
- 适合的代码编辑器（推荐 VSCode）

## 🚀 开发环境设置

### 1. 克隆仓库

```bash
git clone https://github.com/ThinkInAIXYZ/deepchat.git
cd deepchat
```

### 2. 安装依赖

```bash
pnpm install
pnpm run installRuntime  # 首次安装
```

### 3. 启动开发服务器

```bash
# 主进程 + 渲染进程 HMR
pnpm run dev

# 主进程调试
pnpm run dev:inspect

# Linux 开发
pnpm run dev:linux
```

### 4. 验证安装

打开应用并检查：
- ✓ 窗口正常启动
- ✓ 可发送消息
- ✓ 配置页面正常显示
- ✓ 工具调用正常

## 📁 项目目录结构

```
deepchat/
├── src/
│   ├── main/                           # 主进程
│   │   ├── presenter/                  # Presenter 层
│   │   │   ├── agentPresenter/         # Agent 编排器（核心）
│   │   │   ├── sessionPresenter/       # 会话管理（核心）
│   │   │   ├── toolPresenter/          # 工具路由（核心）
│   │   │   ├── mcpPresenter/           # MCP 集成
│   │   │   ├── llmProviderPresenter/   # LLM 提供商
│   │   │   ├── configPresenter/        # 配置管理
│   │   │   ├── windowPresenter/        # 窗口管理
│   │   │   └── tabPresenter/           # 标签管理
│   │   ├── lib/                        # 工具库
│   │   ├── eventbus.ts                 # 事件总线
│   │   ├── events.ts                   # 事件常量
│   │   └── index.ts                    # 主入口
│   ├── renderer/                       # 渲染进程
│   │   ├── src/                        # Vue 应用
│   │   │   ├── components/             # Vue 组件
│   │   │   ├── stores/                 # Pinia Store
│   │   │   ├── views/                  # 页面
│   │   │   └── i18n/                   # 国际化
│   │   ├── shell/                      # 标签栏 UI
│   │   └── floating/                   # 浮动按钮
│   ├── preload/                        # Preload 脚本
│   └── shared/                         # 共享代码
├── test/                               # 测试
├── docs/                               # 文档
├── scripts/                            # 构建脚本
└── build/                              # 构建配置
```

## 🛠️ 常用开发任务

### 添加新的 Presenter

1. 在 `src/main/presenter/` 创建新目录
2. 创建接口（在 `src/shared/presenter.d.ts`）
3. 在 `src/main/presenter/index.ts` 中初始化
4. 在 Preload 中暴露接口
5. 编写测试

### 添加新工具

参考 [tool-system.md](../architecture/tool-system.md)：

**Agent 工具**：
1. 在 `src/main/presenter/agentPresenter/acp/agentToolManager.ts` 中添加工具定义
2. 实现工具处理函数
3. 添加权限类型（如需要）

**MCP 工具**：
1. 配置外部 MCP 服务器
2. 服务器自动注册工具

### 修改 UI 组件

1. 在 `src/renderer/src/components/` 中找到对应组件
2. 修改 Vue 单文件组件
3. 更新国际化字符串（在 `src/renderer/src/i18n/`）

### 添加新事件

1. 在 `src/main/events.ts` 中添加常量
2. 使用 EventBus 发送事件
3. 在渲染进程监听事件

## 🧪 开发工作流

### 分支规范

```bash
# 创建功能分支
git checkout -b feat/your-feature-name

# 创建修复分支
git checkout -b fix/bug-description

# 创建文档分支
git checkout -b docs/some-doc
```

### 提交规范

遵循 Conventional Commits：

```
feat(scope): 添加新功能
fix(scope): 修复 bug
docs(scope): 更新文档
refactor(scope): 重构代码
test(scope): 添加测试
chore(scope): 构建/工具链更新
```

示例：
```
feat(agent): 添加新的文件搜索工具
fix(mcp): 修复 MCP 服务器连接断开问题
docs(architecture): 更新 Agent 系统文档
```

### 代码流程

1. **编辑代码**
2. **TypeScript 类型检查**：`pnpm run typecheck`
3. **Lint 检查**：`pnpm run lint`
4. **运行测试**：`pnpm test`
5. **格式化代码**：`pnpm run format`

### 测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test:main
pnpm test:renderer

# 测试覆盖率
pnpm test:coverage

# 监听测试
pnpm test:watch

# 测试 UI（Vitest）
pnpm test:ui
```

## 📝 首次提交

1. **Fork 仓库**（如果是外部贡献者）
2. **Clone fork**：`git clone https://github.com/YOUR_USERNAME/deepchat.git`
3. **添加 upstream**：`git remote add upstream https://github.com/ThinkInAIXYZ/deepchat.git`
4. **创建分支**：`git checkout -b feat/your-feature`
5. **开发和提交**
6. **推送分支**：`git push origin feat/your-feature`
7. **创建 Pull Request**

## 🔍 常用命令

### 开发命令
```bash
pnpm run dev              # 启动开发服务器
pnpm run dev:inspect      # 主进程调试
pnpm run preview          # 预览生产构建
pnpm run build            # 构建应用
pnpm run build:win        # 构建 Windows 版本
pnpm run build:mac        # 构建 macOS 版本
pnpm run build:linux      # 构建 Linux 版本
```

### 代码质量
```bash
pnpm run typecheck        # TypeScript 类型检查
pnpm run typecheck:node   # Node 端类型检查
pnpm run typecheck:web    # Web 端类型检查
pnpm run lint            # 运行 Lint
pnpm run format          # 格式化代码
pnpm run format:check    # 检查格式
```

### 测试命令
```bash
pnpm test                 # 运行所有测试
pnpm test:main           # 运行主进程测试
pnpm test:renderer       # 运行渲染进程测试
pnpm test:coverage       # 测试覆盖率
pnpm test:watch          # 监听模式
```

## 🐛 调试技巧

### 主进程调试

使用 VSCode 调试配置：

```json
{
  "type": "node",
  "request": "launch",
  "name": "Main Process",
  "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
  "runtimeArgs": ["."],
  "cwd": "${workspaceFolder}"
}
```

### 渲染进程调试

1. 打开 DevTools（F12 或 Ctrl+Shift+I）
2. 使用 Vue DevTools Chrome 扩展
3. 在代码中添加 `debugger` 断点

### 日志系统

```typescript
// 主进程日志
import { logger } from '@/shared/logger'
logger.info('信息日志')
logger.error('错误日志')
logger.debug('调试日志')
```

### 事件追踪

```typescript
// 在 EventBus 中添加日志
eventBus.on('some:event', (...args) => {
  console.log('[EventBus] some:event:', ...args)
})
```

## 📚 深入学习

### 必读文档

- [整体架构概览](../ARCHITECTURE.md)
- [核心流程](../FLOWS.md)
- [会话管理详解](../architecture/session-management.md)
- [Agent 系统详解](../architecture/agent-system.md)
- [工具系统详解](../architecture/tool-system.md)

### 推荐阅读顺序

1. **第一天**：阅读 ARCHITECTURE.md + FLOWS.md（前 3 个流程）
2. **第二天**：阅读 architecture/session-management.md
3. **第三天**：阅读 architecture/agent-system.md
4. **第四天**：阅读 architecture/tool-system.md
5. **第五天**：阅读 architecture/event-system.md + 开始实践

## 🔧 VSCode 扩展推荐

- **Volar** - Vue 3 语言支持
- **TypeScript Vue Plugin (Volar)** - TypeScript + Vue
- **ESLint** - 代码检查
- **Prettier** - 代码格式化
- **GitLens** - Git 增强
- **Thunder Client** - API 测试（可选）

## 📖 额外资源

- [Electron 文档](https://www.electronjs.org/docs)
- [Vue 3 文档](https://vuejs.org/)
- [Pinia 文档](https://pinia.vuejs.org/)
- [TypeScript 文档](https://www.typescriptlang.org/)
- [Vitest 文档](https://vitest.dev/)

## 🆘 常见问题

### **Q：依赖安装失败？**

A：尝试：
```bash
# 清除缓存
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### **Q：TypeScript 错误？**

A：运行 `pnpm run typecheck` 查看详细错误

### **Q：热更新不生效？**

A：重启开发服务器

### **Q：找不到某个接口？**

A：查看 `src/shared/presenter.d.ts` 或 `src/preload/index.d.ts`

### **Q：如何添加新的 LLM Provider？**

A：参考现有的 Provider 实现（`src/main/presenter/llmProviderPresenter/providers/`）

## 🎯 下一步

- 阅读 [代码导航指南](./code-navigation.md)
- 查看 [调试技巧](./debugging.md)
- 开始实践第一个任务

---

祝你开发愉快！如有问题，请查看项目issues或提问。
