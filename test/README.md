# 测试说明文档

## 📁 测试目录结构

```
test/
├── main/                    # 主进程测试
│   └── eventbus/           # EventBus测试
│       └── eventbus.test.ts
├── renderer/               # 渲染进程测试
│   └── shell/              # Shell应用测试
│       ├── App.test.ts     # App组件测试
│       └── main.test.ts    # 入口文件测试
├── setup.ts                # 主进程测试设置
├── setup.renderer.ts       # 渲染进程测试设置
└── README.md              # 本文档
```

## 🚀 快速开始

## 🔗 手工验证 Deeplink Playground

仓库内提供了一个静态验证页：

- `test/manual/deeplink-playground.html`

用途：

- 验证 `deepchat://start`
- 验证 `deepchat://mcp/install`
- 验证 `deepchat://provider/install`

使用方式：

```bash
# 直接在浏览器中打开
test/manual/deeplink-playground.html
```

说明：

- 页面内置了示例 payload、Base64 编码结果和最终 deeplink
- `provider/install` 区块覆盖了当前支持的 built-in provider 与 custom `apiType`
- 页面里的 key 全部是 fake data，仅用于本地联调
- 若浏览器拦截自定义协议，请允许页面打开 `deepchat://` 链接

如果要验证应用内行为，建议先启动 DeepChat，再点击页面中的 `Open` 按钮。

### 安装测试依赖

首先需要安装Vue组件测试所需的依赖：

```bash
# 安装Vue测试工具
npm install -D @vue/test-utils jsdom

# 或使用yarn
yarn add -D @vue/test-utils jsdom
```

### 运行测试

```bash
# 运行所有测试
npm test

# 运行主进程测试
npm run test:main

# 运行渲染进程测试
npm run test:renderer

# 运行测试并生成覆盖率报告
npm run test:coverage

# 监听模式运行测试
npm run test:watch
```

## 📝 测试脚本

在 `package.json` 中添加以下测试脚本：

```json
{
  "scripts": {
    "test": "vitest",
    "test:main": "vitest --config vitest.config.ts test/main",
    "test:renderer": "vitest --config vitest.config.renderer.ts test/renderer",
    "test:coverage": "vitest --coverage",
    "test:watch": "vitest --watch",
    "test:ui": "vitest --ui"
  }
}
```

## 🧪 测试类型

### 主进程测试
- **环境**: Node.js
- **配置**: `vitest.config.ts`
- **重点**: EventBus、Presenter层、工具函数

### 渲染进程测试
- **环境**: jsdom
- **配置**: `vitest.config.renderer.ts`
- **重点**: Vue组件、Store、Composables

## 📊 测试覆盖率

生成测试覆盖率报告：

```bash
npm run test:coverage
```

覆盖率报告将生成在：
- `coverage/` - 主进程覆盖率
- `coverage/renderer/` - 渲染进程覆盖率

打开 `coverage/index.html` 查看详细的覆盖率报告。

## 🔧 配置文件

### vitest.config.ts
主进程测试配置，使用Node.js环境。

### vitest.config.renderer.ts
渲染进程测试配置，使用jsdom环境，支持Vue组件测试。

### test/setup.ts
主进程测试的全局设置，包含Electron模块的mock。

### test/setup.renderer.ts
渲染进程测试的全局设置，包含Vue相关依赖的mock。

## 📋 测试规范

### 文件命名
- 测试文件使用 `.test.ts` 或 `.spec.ts` 后缀
- 与源文件保持相同的目录结构

### 测试描述
- 使用中文描述测试场景
- 使用 `describe` 按功能模块分组
- 使用 `it` 描述具体的测试用例

### 示例测试结构
```typescript
describe('模块名称', () => {
  beforeEach(() => {
    // 测试前置准备
  })

  describe('功能分组', () => {
    it('应该能够执行某个操作', () => {
      // Arrange - 准备测试数据
      // Act - 执行测试操作
      // Assert - 验证测试结果
    })
  })
})
```

## 🐛 调试测试

### 调试单个测试
```bash
# 运行特定的测试文件
npx vitest test/main/eventbus/eventbus.test.ts

# 运行特定的测试用例
npx vitest -t "应该能够正确发送事件到主进程"
```

### 调试配置
在 VSCode 中添加调试配置（`.vscode/launch.json`）：

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Vitest Tests",
  "skipFiles": ["<node_internals>/**"],
  "program": "${workspaceRoot}/node_modules/vitest/vitest.mjs",
  "args": ["--run", "${relativeFile}"],
  "smartStep": true,
  "console": "integratedTerminal"
}
```

## 🎯 最佳实践

### Mock策略
1. **外部依赖**：完全mock（网络请求、文件系统）
2. **内部模块**：选择性mock（复杂依赖、不稳定组件）
3. **纯函数**：尽量使用真实实现

### 测试数据
- 使用简单、明确的测试数据
- 避免使用真实的敏感数据
- 考虑使用工厂函数生成测试数据

### 断言技巧
```typescript
// 推荐的断言方式
expect(result).toBe(expected)           // 严格相等
expect(result).toEqual(expected)        // 深度相等
expect(fn).toHaveBeenCalledWith(args)   // 函数调用验证
expect(element).toBeInTheDocument()     // DOM存在验证
```

## 📚 相关资源

- [Vitest 官方文档](https://vitest.dev/)
- [Vue Test Utils 文档](https://test-utils.vuejs.org/)
- [Testing Library 最佳实践](https://testing-library.com/docs/guiding-principles/)

## ❓ 常见问题

### Q: 如何测试异步操作？
```typescript
it('应该处理异步操作', async () => {
  const result = await asyncFunction()
  expect(result).toBe(expected)
})
```

### Q: 如何测试错误处理？
```typescript
it('应该正确处理错误', () => {
  expect(() => errorFunction()).toThrow('Expected error message')
})
```

### Q: 如何mock模块？
```typescript
vi.mock('./module', () => ({
  exportedFunction: vi.fn()
}))
```
