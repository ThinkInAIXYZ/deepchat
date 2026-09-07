# 实施计划

## 模块边界

```text
config.getLanguage
        │
        ▼
renderer i18n bootstrap ──────── load en-US fallback
        │                              │
        ├──── normalize locale ────────┤
        │                              ▼
        └────────────────────── load current locale
                                       │
                                       ▼
                              createI18n + app.mount

config.language.changed / config.setLanguage
        │
        ▼
language store revision token → load → register → publish state
```

### 1. Locale registry 与复数规则

将复数规则移到无 messages 依赖的模块。`i18n/index.ts` 改为只提供支持 locale 类型、规范化函数、显式
dynamic import registry 和带 Promise 缓存的 `loadLocaleMessages()`。别名规范化到完整 locale，未知值
回退到 `en-US`。

每个 registry entry 使用固定 import 路径，确保 Vite 为 locale 生成可预测的异步 chunk，且不会通过
变量路径打包额外模块。

### 2. Renderer bootstrap

新增共享 `createRendererI18n()`：

- 尝试调用注入的 `getLanguageState`；失败时使用 `en-US` 默认状态；
- 必定加载 `en-US`，当前 locale 不同时并行加载当前 locale；
- 当前 locale 加载失败时回退到 `en-US`；
- 只把实际加载成功的 messages 传给 `createI18n`；
- 返回 i18n 实例及最终启动状态，供测试和后续 store 初始化复用。

主窗口、Settings 和 floating 的入口都改为 async bootstrap，在挂载前创建 i18n。必须迁移所有静态
聚合入口，否则任一多入口 renderer 都可能把 locale 重新提升到共享同步 chunk。floating 的运行时语言
事件使用相同的 load/register/publish 顺序和 revision 保护。

### 3. Language store

store 使用 `setLocaleMessage()` 注册动态结果。所有来自初始化、事件和设置 action 的状态统一进入
`applyLanguageState()`：

1. 分配递增 revision；
2. 加载规范化后的 locale；
3. 检查 revision 是否仍为最新；
4. 注册 messages；
5. 原子更新 locale、requested language 与方向。

`setLanguage` 的 route 返回值也进入同一路径，避免依赖事件到达顺序。加载失败保持上一个可用状态并
记录错误；较早加载即使后完成，也不能覆盖较新状态。

### 4. 测试策略

- i18n loader：所有 locale 可解析、别名/未知值规范化、相同 locale Promise 缓存。
- bootstrap：读取成功、IPC 失败、当前 locale import 失败时的 fallback messages 和最终 locale。
- language store：先注册再切换、快速切换 last-write-wins、加载失败保持旧 locale、RTL 方向。
- production build：检查 Settings 与主窗口同步入口不包含 20 份 locale，并存在独立 locale chunk。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 首屏等待动态 import | 只加载当前 locale 与 fallback；应用内本地 chunk，无网络依赖 |
| 语言事件与 action response 重复 | loader Promise 缓存，统一 revision 应用路径 |
| import 失败导致白屏 | bootstrap 始终可退回静态可加载的 `en-US` 动态 chunk |
| 旧异步请求覆盖新选择 | revision token 在注册和状态发布前校验 |
| 构建器重新合并全部 locale | 两个 renderer 入口同时移除静态聚合，并检查 production manifest/chunks |

## 验证命令

```bash
pnpm exec vitest --config vitest.config.renderer.ts test/renderer/i18n
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:renderer
pnpm run build
```
