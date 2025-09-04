# Presenter 类型拆分计划（无兼容妥协）

## 目标
- 将 `src/shared/presenter.d.ts` 拆分为小而清晰的强类型模块，单文件尽量 ≤ 200 行，单层目录文件数尽量 ≤ 8。
- 稳定跨进程（main ↔ renderer）类型契约，降低循环依赖与脆弱性风险。
- 统一共享类型（如 `UsageStats`、`RateLimitInfo`）。

## 目录结构（建议）

```
src/shared/
  types/
    core/
      llm-events.ts            // LLMCoreStreamEvent 判别联合 + 工厂 + 守卫
      agent-events.ts          // LLMAgentEvent/LLMAgentEventData + 共享类型引用
      chat.ts                  // Message/AssistantMessageBlock/UserMessageContent
      mcp.ts                   // MCP* 系列类型（Tool/Response/Resource）
      usage.ts                 // UsageStats/RateLimitInfo 等共享类型
    presenters/
      window.presenter.d.ts
      tab.presenter.d.ts
      sqlite.presenter.d.ts
      oauth.presenter.d.ts
      config.presenter.d.ts
      llmprovider.presenter.d.ts
      thread.presenter.d.ts
      device.presenter.d.ts
      upgrade.presenter.d.ts
      file.presenter.d.ts
      mcp.presenter.d.ts
      sync.presenter.d.ts
      deeplink.presenter.d.ts
      dialog.presenter.d.ts
      knowledge.presenter.d.ts
      vector.presenter.d.ts
    index.d.ts                 // 门面：聚合导出（仅类型 re-export）
```

说明：
- 将 `presenter` 接口按领域拆分至 `presenters/` 子目录，每个文件专注单一 Presenter，避免超过 200 行；如接近上限，进一步分解子接口。
- 将通用类型抽出至 `types/core`，形成强依赖的“核心层”，供各 Presenter 引用；Presenter 间不得互相引用，只能向下依赖核心类型，向上由 `index.d.ts` 聚合导出，防止环依赖。

## 重命名与导出策略
- 文件命名以 `*.presenter.d.ts` 结尾，避免与实现/类名冲突。
- `index.d.ts` 仅做 `export type { ... } from './presenters/xxx.presenter'` 的类型再导出；禁止引入实现逻辑。

## 共享类型规范
- 新增 `types/core/usage.ts`：
```ts
export interface UsageStats {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  context_length?: number
}

export interface RateLimitInfo {
  providerId: string
  qpsLimit: number
  currentQps: number
  queueLength: number
  estimatedWaitTime?: number
}
```
- `agent-events.ts`、`chat.ts`、数据持久层统计结构统一引用上述共享类型，禁止再定义形状相似的内联对象。

## 事件层强类型规范
- `llm-events.ts`：落地判别联合 `LLMCoreStreamEvent` 与 `createStreamEvent` 工厂与类型守卫；禁止“单接口+可选字段”模式。
- `agent-events.ts`：`LLMAgentEvent = 'response' | 'error' | 'end'`，明确 `permission-required`、`rate_limit` 负载；引用 `UsageStats`、`RateLimitInfo`。

## 引用方向约束
- `presenters/*` 只能依赖 `types/core/*` 与 `types/chat.ts`。
- UI（renderer）只能依赖 `types/chat.ts` 与 `agent-events.ts`，不得依赖 `llm-events.ts`。
- Provider 实现只能依赖 `llm-events.ts` 与必要的 `mcp.ts`。

## 分阶段推进（无兼容妥协）
1) 创建 `types/core/*` 与 `types/chat.ts`、`agent-events.ts`、`llm-events.ts` 骨架与导出门面；不动现有实现。
2) 将 `presenter.d.ts` 按 Presenter 维度等价拆分为 `presenters/*.presenter.d.ts`；同步修正文档中的导入路径；删除旧文件。
3) 调整 main/renderer 引用路径：
   - main 侧 Presenter/实现改为从 `src/shared/types` 与 `src/shared/types/presenters` 引用。
   - renderer 侧组件与 store 改为从 `src/shared/types/chat` 与 `agent-events` 引用。
4) 编译检查与类型回归，修正边界类型不一致。

## 代码风格与边界
- 强制判别联合、避免可选字段“泥团”。
- 单文件尽量 ≤ 200 行；超出需拆分子接口/子模块。
- 单层目录尽量 ≤ 8 文件；超过建立子目录。
- 注释与日志统一英文，避免晦涩命名。

## 后续工作（可选）
- 为 `事件→UI 块` 映射建立快照测试与契约测试。
- 为 `createStreamEvent` 提供小型校验工具（dev 断言）。
- 在 PR 审查中加入 OxLint/TS 类型规则，禁止新增“可选字典式事件”。


