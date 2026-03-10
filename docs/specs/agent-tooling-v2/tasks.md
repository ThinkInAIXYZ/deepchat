# Agent Tooling V2 Tasks（Prompt 管线与 Env Prompt）

## T0 文档先行

- [x] 更新 `spec.md`：增加 V2.1 system prompt 固定顺序与 env prompt 约束。
- [x] 更新 `plan.md`：补充实现边界、顺序、回退 `allowParallel` 要求。
- [x] 新建 `tasks.md`：形成可执行任务清单。

## T1 回退并清理 `allowParallel`

- [ ] 从 `src/main/presenter/agentPresenter/acp/agentToolManager.ts` 的 `exec` schema 删除 `allowParallel`。
- [ ] 删除 `exec` description 中关于 `allowParallel` 的文案。
- [ ] 删除 `exec` 前置并行守卫逻辑和相关辅助方法。
- [ ] 清理/更新相关测试断言（若涉及）。

## T2 新增统一 Env Prompt Builder

- [ ] 新增 `src/main/presenter/agentPresenter/message/systemEnvPromptBuilder.ts`。
- [ ] 实现 `buildSystemEnvPrompt(...)`，输出固定格式：
  - 模型名 + 模型 ID
  - `<env>`：workdir、git repo、platform、date
  - `<files>` 空块
  - `Instructions from: <workdir>/AGENTS.md`
  - AGENTS.md 全文（读取失败时输出可观测 fallback）
- [ ] 实现 runtime 静态能力说明 builder（YoBrowser + terminal background）。

## T3 调整 Message Builder 拼接顺序

- [ ] 在 `src/main/presenter/agentPresenter/message/messageBuilder.ts` 按固定顺序拼接：
  1. conversation `systemPrompt`
  2. runtime 静态能力说明
  3. skills prompt
  4. env prompt
  5. tooling prompt
- [ ] 移除 YoBrowser 动态状态注入（tab/active tab 实时快照）。
- [ ] 确认不注入后台进程动态列表。

## T4 收敛 Prompt Enhancer 责任

- [ ] 更新 `src/main/presenter/agentPresenter/utility/promptEnhancer.ts`，避免重复拼接 runtime/date/platform/workdir 信息。
- [ ] runtime 环境信息统一由 `systemEnvPromptBuilder` 提供。

## T5 测试

- [ ] 新增/更新 `messageBuilder` 测试：断言 system prompt 段落顺序。
- [ ] 新增 `systemEnvPromptBuilder` 测试：
  - git yes/no
  - AGENTS.md 存在/不存在
  - model name/model id 回退逻辑
- [ ] 更新 `agentToolManager` 测试：确保 `allowParallel` 不可用。

## T6 验证

- [ ] `pnpm run format`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] 跑关键 main 测试集并记录结果
