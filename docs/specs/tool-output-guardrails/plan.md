# 实施计划

## 现状梳理

- 真正的工具路由在 `src/main/presenter/toolPresenter`:
  - `ToolPresenter` + `ToolMapper`.
  - `agentPresenter/tool` 下的 `ToolRegistry`/`toolRouter` 目前未被运行路径使用.
- `ToolCallProcessor` 会把工具结果直接拼接进 `conversationMessages`, 无大小控制.
- `directory_tree` 实现为无限递归.

## 方案设计

### 1) `directory_tree` 深度控制

- 更新 schema:
  - `src/main/presenter/agentPresenter/acp/agentToolManager.ts`
    - `directory_tree` 增加 `depth?: number`(默认 1, 最大 3).
  - `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`
    - `DirectoryTreeArgsSchema` 同步增加 `depth`.
- 递归限制:
  - 在 `directoryTree` 内实现 `currentDepth` 控制.
  - root 深度为 0, 仅当 `currentDepth < depth` 时继续展开.

### 2) 工具输出 offload

- 触发阈值: 工具输出字符串长度 > 3000.
- offload 存储:
  - 目录: `~/.deepchat/sessions/<conversationId>/`
  - 文件名: `tool_<toolCallId>.offload`
  - 内容: 原始完整工具输出(文本)
- stub 内容:
  - 总字符数
  - 预览片段(1024 字符以内)
  - 完整文件绝对路径
- 执行位置:
  - 在 `ToolCallProcessor` 中对工具输出 string 化后做长度判断.
  - 仅替换 `tool_call_response` 和写入 `conversationMessages`.
  - 保持 `tool_call_response_raw` 不变, 避免影响 MCP UI/搜索结果.

### 3) 文件读取放行规则

- 文件类工具在读取 `~/.deepchat` 时需要额外校验:
  - 只放行 `~/.deepchat/sessions/<conversationId>` 下的文件.
  - 会话不匹配则拒绝访问.
- 实现位置建议:
  - 在 `AgentFileSystemHandler.validatePath` 增加路径前缀校验(读取时).
- 路径安全:
  - 参考 `skillSyncPresenter/security.ts` 的路径规范化/安全校验逻辑.

### 4) 错误呈现

- 保证 error event 携带错误文本:
  - `AgentLoopHandler`/`StreamGenerationHandler`/`AgentPresenter` 的 error 事件
    统一包含 `error` 字段.
- UI 侧:
  - `MessageBlockError.vue` 默认直接展示 raw text.
  - 不依赖 i18n key 时也能显示完整错误内容.

## 事件流

1. 工具调用完成 → `ToolCallProcessor` 取到输出.
2. 输出超过 3000 字符 → offload 写文件 + 生成 stub.
3. stub 进入 `conversationMessages` 和 `tool_call_response`.
4. UI 展示 stub; 模型可用 file 工具读取完整路径.
5. 出错时, error block 写入消息 + `STREAM_EVENTS.ERROR` 发送错误文本.

## 数据/文件结构

- `~/.deepchat/sessions/<conversationId>/tool_<toolCallId>.offload`
  - 原始完整工具输出文本

## 测试策略

- 单元测试:
  - `directory_tree` 深度限制(0/1/3/4).
  - tool output 超过 3000 字符时触发 offload, stub 格式正确.
- 集成/手动:
  - 触发 `directory_tree` 大输出, 确认不再触发 10MB 失败.
  - 触发 provider error, UI 能直接看到 raw text.

## 风险与对策

- offload 文件增多:
  - 可在后续增加清理策略(按时间或数量).
- conversationId 缺失场景:
  - 需定义降级行为(例如仅截断不 offload).
  - 若确认不存在此场景可忽略.
