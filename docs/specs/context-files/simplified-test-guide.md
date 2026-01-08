# Context Files Offload 简化测试指南

## ✅ 实施完成总结

### 修改的文件
1. ✅ `contextStore.ts` - 支持自定义 ID
2. ✅ `ContextOffloadManager.ts` - 使用 nanoid(5) + 分类逻辑
3. ✅ `toolCallProcessor.ts` - 添加 offload 过滤（排除内置工具）
4. ✅ `promptEnhancer.ts` - 简化 Prompt（10 行，说明分类格式）

### 新的 ContextRef 格式
- Bash: `[Bash output in context: 7b8K1p] (14.1KB)`
- Terminal: `[Terminal output in context: 9Q3jM4] (8.2KB)`
- MCP Tool: `[Tool output in context: 5jXkL2] (5.3KB)`

**特点**：
- ✅ 使用 `nanoid(5)` 生成短 ID
- ✅ 分类标签（Bash/Terminal/Tool）
- ✅ 简洁格式

---

## 🧪 测试场景

### 场景 1：Bash 输出 offload（> 5KB）

**命令**：
```bash
find /usr -type f 2>/dev/null | head -n 600
```

**期望输出**：
```
[前 800 字符的文件列表...]

[Bash output in context: 7b8K1p] (15.2KB)

Exit Code: 0
```

**验证点**：
- ✅ ContextRef 格式：`[Bash output in context: xxxxx] (xx.xKB)`
- ✅ ID 长度：5-6 字符（nanoid 格式）
- ✅ 分类正确：显示 "Bash output"
- ✅ 大小格式化：KB/MB

**Console 日志验证**：
```
[AgentBashHandler] Offloaded output: <id>
```

**File 验证**：
```bash
ls ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/
cat ~/Library/Application\ Support/DeepChat/context/<conversationId>/manifest.json | jq
```

---

### 场景 2：Bash 输出（< 5KB，不 offload）

**命令**：
```bash
echo "hello world"
```

**期望输出**：
```
hello world

Exit Code: 0
```

**验证点**：
- ❌ 没有 ContextRef
- ✅ 完整输出 inline 显示

---

### 场景 3：Terminal 输出 offload（> 1KB）

**命令**：
```bash
terminal.create({ command: "ls -laR /usr", outputByteLimit: 2048 })
terminal.waitForTerminalExit({ terminalId: "..." })
```

**期望输出**：
```
[前 800 字符...]

[Terminal output in context: 9Q3jM4] (1.8KB)
```

**验证点**：
- ✅ ContextRef 格式：`[Terminal output in context: xxxxx] (xx.xKB)`
- ✅ 分类正确：显示 "Terminal output"
- ✅ 由 ToolCallProcessor 的通用机制触发

**Console 日志验证**：
```
[ToolCallProcessor] Offloaded tool output: terminal_* (<size> chars)
```

---

### 场景 4：MCP 工具 offload（> 1KB）

**命令**：
```bash
your_mcp_tool_large_output()
```

**期望输出**：
```
[前 800 字符的响应...]

[Tool output in context: 5jXkL2] (5.3KB)
```

**验证点**：
- ✅ ContextRef 格式：`[Tool output in context: xxxxx] (xx.xKB)`
- ✅ 分类正确：显示 "Tool output"（默认）
- ✅ 由 ToolCallProcessor 的通用机制触发

---

### 场景 5：文件系统工具（不应该 offload）

**命令**：
```bash
read large_file.txt
```

**期望输出**：
- ❌ 不显示 ContextRef
- ✅ 使用文件系统工具的自带分页机制

**验证点**：
- ✅ 检查 console：没有 `[ToolCallProcessor] Offloaded` 日志
- ✅ 输出直接返回文件内容（或分页提示）

**Console 日志验证（应该没有）**：
```
# 不应该有类似这样的日志：
[ToolCallProcessor] Offloaded tool output: read_file
```

---

### 场景 6：浏览器工具（不应该 offload）

**命令**：
```bash
browser.scrape("https://example.com/large-page")
```

**期望输出**：
- ❌ 不显示 ContextRef
- ✅ 使用浏览器工具的自带分页机制

**验证点**：
- ✅ 检查 console：没有 offload 日志
- ✅ 浏览器工具自己处理分页

---

### 场景 7：模型交互测试

**测试步骤**：

1. **运行大 bash 命令**：
```bash
find /usr -type f 2>/dev/null | head -n 600
```

2. **输出**：
```
[Bash output in context: 7b8K1p] (15.2KB)

Exit Code: 0
```

3. **Prompt 模型**：
```
请检查上一个 bash 命令的退出代码和最后 20 行
```

**期望模型行为**：
1. ✅ 识别 ContextRef 格式：`[Bash output in context: 7b8K1p] (15.2KB)`
2. ✅ 提取 ID：`7b8K1p`
3. ✅ 调用 `context_tail` 或 `context_list`
4. ✅ 分析结果并回复

**Console 日志验证**：
```
[AgentLoop] Tool call: context_tail with params: {id: "7b8K1p", lines: 20}
```

---

### 场景 8：搜索关键字

**测试步骤**：

1. **运行大 bash 命令**（生成一个包含 "error" 的输出）

2. **Prompt 模型**：
```
搜索 bash 输出中的 "error" 关键词
```

**期望模型行为**：
1. ✅ 调用 `context_list()` 或直接使用已知 ID
2. ✅ 调用 `context_grep(id="7b8K1p", pattern="error")`
3. ✅ 显示匹配的行

**Console 日志验证**：
```
[AgentLoop] Tool call: context_grep with params: {id: "7b8K1p", pattern="error"}
```

---

### 场景 9：分页读取

**测试步骤**：

1. **运行大 bash 命令**

2. **Prompt 模型**：
```
请系统地分析整个 bash 输出，分成 8KB 的块来读取
```

**期望模型行为**：
1. ✅ 调用 `context_read(id="7b8K1p", offset=0, limit=8192)`
2. ✅ 分析第一块，可能请求更多 `context_read`（offset 增加）
3. ✅ 提供总结

---

## 🔍 调试方法

### 查看 Context Files

**位置**：
```bash
~/Library/Application Support/DeepChat/context/<conversationId>/artifacts/
```

**命令**：
```bash
# 列出所有 context files
ls -lh ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/

# 查看 manifest
cat ~/Library/Application\ Support/DeepChat/context/<conversationId>/manifest.json | jq '.items[]'

# 检查文件大小和内容
wc -l -c ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/<id>.txt

# 预览文件
head -20 ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/<id>.txt
tail -20 ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/<id>.txt

# 搜索
grep -i "error" ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/<id>.txt
```

### Console 日志模式

**Offload 成功**：
```
[ToolCallProcessor] Offloaded tool output: <tool_name> (<size> chars)
[ContextStore] Created ref: <nanoid_id>
[ContextStore] Wrote content: <path> (<size> bytes)
```

**Offload 失败**：
```
[AgentBashHandler] Failed to offload output: <error>
[ToolCallProcessor] Failed to offload tool output for <tool_name>: <error>
```

**跳过内置工具**（应该没有 offload 日志）：
```
# 对于文件系统工具、浏览器工具等
# 不应该有 offload 日志
```

---

## 📋 验收检查清单

### Format 验收
- [ ] Bash 输出：`[Bash output in context: xxxxx] (xx.xKB)`
- [ ] Terminal 输出：`[Terminal output in context: xxxxx] (xx.xKB)`
- [ ] MCP 工具：`[Tool output in context: xxxxx] (xx.xKB)`
- [ ] ID 长度：5-6 字符（nanoid 格式）
- [ ] 格式统一，易于理解

### 功能验收
- [ ] 文件系统工具（read_file 等）**不被** offload
- [ ] 浏览器工具 **不被** offload
- [ ] Context tools **不被** offload
- [ ] Bash 工具 **不被** ToolCallProcessor offload（由 Bash Handler 自己处理）
- [ ] Terminal/MCP 工具 **被** offload（通用机制）
- [ ] 分类格式正确识别来源

### Prompt 验收
- [ ] Prompt 长度 ≤ 15 行
- [ ] 说明分类格式（Bash vs Tool）
- [ ] 包含工作流程示例
- [ ] 模型能够理解并使用 context tools

### 错误处理验证
- [ ] Offload 失败时显示：`[Output truncated due to offload error]`
- [ ] Console 显示警告日志
- [ ] 系统不会崩溃

---

## 🐛 常见问题

### 问题 1：ID 冲突（极低概率）

**现象**：
```
Error: Context file already exists: /path/to/abcde.txt
```

**解决方案**：
- 这是 nanoid(5) 的极低概率冲突（~1/10亿）
- 如果遇到，可以重启对话，或手动删除冲突文件

**长期方案**：
- 可以在 `ContextStore.createRef()` 中添加冲突检测和重试逻辑

---

### 问题 2：模型不使用 context tools

**可能原因**：
1. Prompt 中的指导不够清晰
2. 模型不理解 ContextRef 格式
3. 模型认为不需要读取完整输出

**解决方案**：
- 检查 system prompt 中是否包含新的 context files 部分
- 尝试更明确的 prompt："请使用 context_tail 检查错误"
- 查看模型是否调用了 context_* 工具

---

### 问题 3：文件系统工具被 offload

**现象**：
- `read_file large_file.txt` 显示 `[Tool output in context: xxxxx] (xx.xKB)`

**原因**：
- 可能是 server name 不正确或过滤逻辑有问题

**解决方案**：
- 检查 `toolCall.server?.name` 的值
- 确认过滤逻辑包含了正确的 server name

---

### 问题 4：短 ID 太短导致冲突

**现象**：
- 频繁遇到 ID 冲突错误

**解决方案**：
- 将 `nanoid(5)` 改为 `nanoid(7)` 或 `nanoid(8)`
- 或使用完整的 UUID

---

## 🎯 性能测试

### Offload 性能

**测试方法**：
```bash
# 10KB 输出
time bash -c 'printf 'a%.0s' {1..10000}'

# 100KB 输出
time bash -c 'printf 'a%.0s' {1..100000}'
```

**期望**：
- 10KB offload: < 50ms
- 100KB offload: < 200ms

---

## 📊 测试结果记录

| 场景 | 通过 | 备注 |
|------|------|------|
| Bash offload (> 5KB) | ⬜ |  |
| Bash 不 offload (< 5KB) | ⬜ |  |
| Terminal offload (> 1KB) | ⬜ |  |
| MCP tool offload (> 1KB) | ⬜ |  |
| File system 不 offload | ⬜ |  |
| Browser 不 offload | ⬜ |  |
| 模型使用 context_tail | ⬜ |  |
| 模型使用 context_grep | ⬜ |  |
| 模型使用 context_read | ⬜ |  |
| Prompt 指导有效 | ⬜ |  |

---

## 🚀 后续优化建议

### 短期
1. 添加 ID 冲突检测和重试逻辑
2. 优化 offload 性能（使用流式写入）
3. 添加 context file 清理机制（LRU）

### 长期
1. UI 集成：在消息中显示 context file 数量
2. 提供 context file browser 界面
3. 支持手动 offload 历史消息
4. 添加 context file 压缩（对于大文件）

---

**测试愉快！如有问题，请记录在"测试结果记录"表格中。**
