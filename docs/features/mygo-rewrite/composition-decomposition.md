# composition 拆解方案

状态：第 1 步已实施（`createSettingsSubsystem`），其余待做
目的：把 `src/main/app/composition.ts`（3903 行）拆成可独立装配的业务子系统，让 Node sidecar 与 Electron 主进程共用同一批工厂。这是剩余 8 条 sidecar 路由的共同前提。

## 1. 现状

`createComposition` 在单个函数里做了五件事：

1. 创建基础设施（数据库、设置、日志、事件发布）
2. 创建业务服务（provider、session、agent、mcp、skill、memory、tape、tool、knowledge、workspace、plugin、scheduler、remote、sync）
3. 创建桌面部件（window、tray、menu、shortcut、dialog、notification、floating 的残骸）
4. 注册 32 个 route map 并暴露 dispatch
5. 编排启停顺序（startup workload、destroy steps）

其中第 2 项是 sidecar 需要的，第 3 项是 Go 壳要替换的，第 1 项两侧都需要但实现不同（已经通过 `platform/*` 处理）。

已实测可单独装配并从 sidecar 调用的部分（本轮及前几轮验证）：

| 子系统 | sidecar 里的构造方式 | 状态 |
| --- | --- | --- |
| 设置 | `createSettingsStore()` | 通过 |
| 会话数据 | `createSessionDataFromDatabase(new SessionDatabase(db))`（间接） | 通过 |
| 会话列表 | `new AppSessionService(new ProjectDatabase(db), new SessionDatabase(db))` | 通过 |
| Provider | `new ProviderSettings(settings, privacy, new ProviderDatabase(db), publish, version)` | 通过 |
| MCP 设置 | `new McpSettings(new SecretStore(settings))` + `connectDatabase` | 通过 |
| Onboarding | `createOnboardingRoutes(settings)` | 通过 |

即：**依赖少的子系统已经能直接构造**，问题只在于 `composition.ts` 没有把它们写成工厂。

## 2. 目标形态

```ts
// src/main/app/subsystems/settings.ts
export function createSettingsSubsystem(deps: { store: SettingsStore; publish: DeepchatEventPublisher }) {
  const desktopSettings = new DesktopSettings(deps.store, effects, deps.publish)
  const fontSettings = new FontSettings(deps.store, deps.publish)
  const promptSettings = new PromptSettings(deps.store, { publishCustomPromptsChanged })
  const skillSettings = new SkillSettings(deps.store)
  return { desktopSettings, fontSettings, promptSettings, skillSettings }
}
```

约定：

- 工厂只接收**显式依赖**，不读全局单例（`appHost` 这类已由平台层承担）。
- 返回值是一个具名对象，调用方按需取用，不提供「取任意服务」的通用入口。
- 工厂内部不启动后台任务；启动/停止仍由调用方（Electron 的 startup 编排或 sidecar）决定。
- 事件发布通过参数传入，工厂自己不订阅全局总线。

## 3. 拆分顺序

按依赖深度从浅到深，每一步都能单独验证：

| 步骤 | 工厂 | 主要依赖 | 解锁的 sidecar 路由 |
| --- | --- | --- | --- |
| 1 | `createSettingsSubsystem` ✅ | store、publish | `settings.getSnapshot` |
| 2 | `createProviderSubsystem` ✅ | settings、providerDatabase、publish | `providers.*` 其余条目 |
| 3 | `createAgentSubsystem` | settings、agentDatabase、provider、publish | `sessions.getAgents`、`agents.*` |
| 4 | `createMcpSubsystem` | settings、mcpDatabase、pluginRuntime、publish | `mcp.listPrompts`、`mcp.getClients`、`mcp.listToolDefinitions`、`mcp.listResources` |
| 5 | `createSessionSubsystem` | 上述全部 | `startup.getBootstrap`、会话相关剩余 |
| 6 | `createToolchainSubsystem` | settings、filesystem | `toolchains.getStatus` |

每个工厂完成后：

1. `composition.ts` 改为调用工厂，Electron 行为必须不变（现有测试全绿）
2. sidecar 改为调用同一工厂
3. 用 `boot-route-inventory.md` 里对应的路由做回归

## 4. 已知难点

- **`publishDeepchatEvent` 是闭包**：composition 里的事件发布依赖 webContents 分发。工厂需要把它变成参数，而不是让工厂自己去 `webContents.send`。
- **`createLivePort` 延迟取值**：多处用 `createLivePort(() => service)` 绕过构造顺序。工厂化后应改为「先建依赖、再建服务」，减少这层间接。
- **启动编排与销毁顺序**有测试约束（`compositionBoundaries.test.ts` 里的 destroy 顺序断言）。拆工厂时不要动顺序，先原样搬运。
- **`agentSettings` 有 12 个构造参数**，是最难拆的一块。建议最后做，且先只暴露 sidecar 需要的读方法。

## 4.1 第 1 步的实施结果

`src/main/app/subsystems/settings.ts` 已抽出，`composition.ts` 改为调用它，同时 sidecar 也用它构建 `DesktopSettings`：

- 新增 `platform/node/themeHost.ts`（sidecar 侧的主题源）
- `AppHost` 补 `getLoginItemEnabled` / `setLoginItemEnabled`，`desktop/settings.ts` 不再 import electron
- sidecar 的 `config.getTheme` / `config.setTheme` 改为走 `DesktopSettings`，不再直接读写设置

顺带修掉一个真 bug：之前 `config.setTheme` 只写设置、不通知 theme host，导致返回 `{theme:'dark', isDark:false}` 自相矛盾。现在两条路径统一。

验证：`config.setTheme dark` → `{theme:'dark',isDark:true}`；壳通过 `DEEPCHAT_SYSTEM_THEME_DARK=1` 注入系统外观时，`theme:'system'` 也能得到 `isDark:true`。

第 2 步（`createProviderSubsystem`）同样已完成：`composition.ts` 与 sidecar 共用同一工厂，sidecar 的 `providers.listSummaries` 仍返回完整 provider 目录。

## 5. 验证方式

- 每步：`pnpm run typecheck`、`pnpm run test:main`、`pnpm run test:renderer`
- 每步后：`pnpm run sidecar:build` 并重放 `boot-route-inventory.md` 的对应请求
- 全部完成后：`grep -rl "from 'electron'" src/main | grep -v '^src/main/platform/'` 应只剩 `desktop/`、`app/` 与 OAuth 三处

## 6. 不建议的做法

- **不要把 `composition.ts` 整体复制一份到 sidecar**。两份装配会立刻漂移，且体积、初始化顺序都会分叉。
- **不要为了 sidecar 在业务模块里加 `if (isSidecar)` 分支**。运行时判断会让两条路径长期共存，难以删除。
- **不要先拆 `Window`/`Desktop`**。它们在 mygo 版里会被 Go 直接替换，拆成工厂没有收益。
