# 实施计划

## 1. 建立 feature model

在 `src/renderer/src/features/chat-page/model/displayMessage.ts` 原样迁移
`messageListItems.ts` 的所有 type 和 pure helper：

- `DisplayMessage` 家族与 `MessageListItem`；
- assistant block 的 internal tool、filter、presence 策略；
- compaction 判定。

新模块只保留对 `@shared/types/*` 的 type/value 依赖，因此可以被 feature、component、store 和
纯 UI helper 使用而不引入运行时分层循环。

## 2. 原子切换消费者

把 renderer source、renderer tests 和 fixtures 的 import 改为
`@/features/chat-page/model/displayMessage`。特别保留 component 对 feature model 的单向读取：
组件不会导入 ChatPage、feature composable 或 store。

删除旧的 `components/chat/messageListItems.ts`，不建立过渡 re-export；这样新增引用无法继续落在
错误的 component 目录。

## 3. 验证

1. 搜索确认旧模块 import 为零。
2. 执行 formatter；随后执行 i18n、lint 与 renderer type check。
3. 运行直接覆盖消息 list/window、message block 和 chat feature composable 的 targeted suites；如
   repository runner 支持，再执行完整 renderer test suite。

## 兼容性与回滚

模块导出名和实现不变，调用方数据格式与运行时行为不变。若出现解析或架构问题，单次提交即可将
imports 和文件位置恢复，无需迁移数据或 IPC contract。
