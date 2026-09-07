# Plan: ChatPage 分解与竞态治理

## 实施顺序

按"每抽一个 composable 即 typecheck + 测试"的节奏,从耦合最少的关注点开始,
逐步收编模块级令牌;滚动仲裁族(`useChatScrollController` 等)保持不动,只归拢胶水调用。

1. **死代码清理** — 删除零引用的 `composables/message/useMessageScroll.ts`(339 行,
   旧 vue-virtual-scroller 实现)及其孤儿测试、`ScrollInfo` 类型。
2. **useDisplayMessages + usePlanFloatLifecycle** — 记录→DisplayMessage 转换、
   稳定/流式分离、占位符四态机(见 spec 决策记录)、Plan 快照生命周期。
3. **useChatSearch** — 会话内搜索,包装 `lib/chatSearch` 的 rAF/highlight 调度。
4. **useListGestures + useMessageVirtualization** — 手势原子与虚拟化原子,
   再组合接入主文件;composable 声明顺序移到会话 watch 之前。
5. **useComposerSubmit** — 发送/排队/steer/命令/compaction 统一提交路径,
   自持 `attachmentFilterToken`;四个提交入口的重复守卫收敛为 `canSubmitNow()`。
6. **useSessionRestore** — 会话恢复 epoch(`restoreRequestId`)、`canWriteSessionView`
   写 gate、启动延迟恢复调度、`deactivate()` 卸载语义;主文件通过
   `currentRestoreRequestId()` 读取最新令牌。

## 验证策略

- 每步:`pnpm run typecheck:web` + `ChatPage.test.ts`(82 用例)。
- 收尾:`pnpm run format` / `lint` / `i18n` / `test:renderer` 全量,
  与 origin/dev 对照隔离既有失败。
- 行为零漂移由测试 + 逐行 diff 审查共同保证;竞态令牌语义(闭包内最新值 vs 快照)
  单独走一轮对抗性 review。

## 回滚

每个 composable 一个独立 commit。因抽取提交之间存在依赖(后一个 composable 的接入
依赖前面已建立的装配结构与导入),回滚须按提交的**逆序**进行,或连同依赖它的后续
提交一并回滚,不能孤立 revert 中间某一步。滚动仲裁契约(`useChatScrollController`
及其协作模块)全程未动,整体回滚到基线不影响该子系统。
