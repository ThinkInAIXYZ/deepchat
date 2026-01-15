# Agent 工具输出保护与错误呈现

> 状态: Draft
> 日期: 2025-03-08

## 背景

当前 agent 运行中出现以下问题:

- Provider 报错会出现在主进程日志, 但 UI 未必能看到错误信息.
- `directory_tree` 无深度限制, 可能产生巨量输出, 触发 10MB 限制.
- 工具返回过大时会被直接注入到 LLM 上下文, 容易导致请求失败.

## 目标

- 让生成失败时的错误信息可见并可追溯.
- 给 `directory_tree` 增加深度控制, 最大不超过 3.
- 对过大的工具输出做 offload, 用小的 stub 替代进入上下文.

## 非目标

- 不改动或替换 `agentPresenter/tool` 下的 `ToolRegistry`/`toolRouter`.
- 不改变 MCP UI 资源与搜索结果的解析逻辑.

## 用户故事

1. 作为用户, 我希望生成失败时能在 UI 直接看到原始错误文本.
2. 作为模型, 我希望能指定目录树深度, 避免一次输出过大.
3. 作为系统, 我希望工具输出过大时自动 offload, 仍可在需要时读取完整内容.

## 验收标准

### 错误呈现

- 生成失败会将消息状态置为 `error`, 并写入一个 error block.
- error block 直接显示 raw error 文本(不要求点击展开).
- `STREAM_EVENTS.ERROR` 会携带错误文本, 便于 UI 展示或通知.

### `directory_tree` 深度控制

- `directory_tree` 增加 `depth` 可选参数, 默认值为 1.
- depth 最大为 3, 超出直接校验失败.
- 深度计数方式为 root=0.
  - depth=0: 仅返回根目录下条目, 不展开子目录.
  - depth=1: 展开一级子目录, 不包含孙级.
- 响应格式保持不变: JSON 数组 `{ name, type, children? }`.

### 工具输出 offload

- 当工具输出字符串长度 > 3000 字符时触发 offload.
- 完整内容写入:
  - `~/.deepchat/sessions/<conversationId>/tool_<toolCallId>.offload`
- LLM 只收到 stub, 包含:
  - 总字符数
  - 预览片段
  - 完整文件的绝对路径
- 模型可以通过文件类工具读取上述路径.
- 文件类读取工具仅放行当前会话 `conversationId` 对应目录.
- `tool_call_response_raw` 不被改写, 避免影响 MCP UI/搜索结果处理.
