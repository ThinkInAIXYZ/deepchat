# 任务拆分

1. 更新 `directory_tree` schema 与描述, 增加 `depth`(默认 1, 最大 3).
2. 在 `AgentFileSystemHandler.directoryTree` 实现 depth 控制(root=0)并补充测试.
3. 在 `ToolCallProcessor` 增加工具输出长度检测:
   - 超过 3000 字符 → 写入 `~/.deepchat/sessions/<conversationId>/tool_<toolCallId>.txt`
   - 生成 stub 替换 `tool_call_response` 与上下文内容.
4. 在文件工具读路径校验中放行 `~/.deepchat/sessions/<conversationId>`:
   - 仅限当前会话.
5. 统一 error event 的 `error` 字段传递, 并确保写入 error block.
6. 更新 `MessageBlockError.vue` 默认展示 raw text(不依赖 i18n key).
7. 运行 `pnpm run format` 与 `pnpm run lint`.
