# Context Files Offload Testing Guide

## Quick Start

1. Start dev mode: `pnpm run dev`
2. Start a new conversation in Agent mode
3. Test the scenarios below

---

## Test Scenarios

### 1. Bash Command Output Offload

#### 1.1 Small Output (< 5KB)
```bash
> echo "hello world"
```

**Expected Result:**
- Output displayed inline without ContextRef
- No context file created
- Format: plain text

**Verify:**
```bash
# Check if context directory exists (should be empty or not exist)
ls ~/Library/Application\ Support/DeepChat/context/<conversationId>/ 2>&1 || echo "No context directory (expected)"
```

---

#### 1.2 Medium Output (~4.8KB, just under threshold)
```bash
> printf 'a%.0s' {1..4800}
```

**Expected Result:**
- Output displayed inline without ContextRef
- No context file created

**Verify:**
```bash
# Check manifest (should be empty or not exist)
cat ~/Library/Application\ Support/DeepChat/context/<conversationId>/manifest.json 2>&1 || echo "No manifest (expected)"
```

---

#### 1.3 Large Output (> 5KB)
```bash
> find /usr -type f 2>/dev/null | head -n 600
```

**Expected Result:**
- Inline preview: first 800 characters
- ContextRef displayed at the end
- Format: `[Full bash command output saved to context file](context:xxx) (X.XKB)`
- Context file created in `<userData>/context/<conversationId>/artifacts/`

**Verify:**
```bash
# 1. Check context file created
ls -lh ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/

# 2. Check metadata in manifest
cat ~/Library/Application\ Support/DeepChat/context/<conversationId>/manifest.json | jq '.items[]'

# 3. Verify context file content
context_path=$(ls ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/*.txt | head -1)
wc -l "$context_path"
tail -20 "$context_path"
```

---

### 2. Model Interaction with Context Files

#### 2.1 Reading offloaded bash output

**Prompt the model:**
```
> Please check the exit code and the last 20 lines of the previous bash command output
```

**Expected Model Behavior:**
1. Model should recognize the ContextRef format
2. Model should call `context_tail(id, lines=20)` or `context_list` first
3. Model should analyze the output and provide the exit code and last lines

**Verify in console:**
```
# Look for these log entries:
[ToolCallProcessor] Offloaded tool output: execute_command (15000 chars)
[AgentLoop] Calling tool: context_tail
```

---

#### 2.2 Searching in offloaded output

**Prompt the model:**
```
> Please search for "error" in the previous bash command output
```

**Expected Model Behavior:**
- Model should call `context_grep(id, "error")`
- Model should show matching lines with context

**Verify:**
```
# Check grep results in context file
grep -i "error" "$context_path" | head -10
```

---

#### 2.3 Reading specific pages of output

**Prompt the model:**
```
> Please read the first page of the bash command output in chunks of 8KB
```

**Expected Model Behavior:**
- Model should call `context_read(id, offset=0, limit=8192)`
- Model should display the content and possibly request next chunk

**Verify:**
```bash
# Verify the chunk size
head -c 8192 "$context_path" | wc -c
```

---

### 3. File Read Offload

#### 3.1 Create large test file
```bash
> write_file large_test.txt << 'EOF'
$(printf 'Line %.0s\n' {1..2000})
EOF
```

#### 3.2 Read the file
```bash
> read large_test.txt
```

**Expected Result:**
- Inline preview: first 800 characters
- ContextRef displayed
- Format: `[Tool output from read_file saved to context file](context:xxx) (15.5KB)`

---

### 4. Terminal Offload

#### 4.1 Create large terminal session
```bash
> terminal.create({ command: "ls -laR /usr", outputByteLimit: 2048 })
> terminal.waitForTerminalExit({ terminalId: "..." })
```

**Expected Result:**
- If output > 1KB, should be offloaded
- ContextRef displayed
- Format: `[Tool output from terminal_* saved to context file](context:xxx) (X.XKB)`

---

### 5. Error Handling

#### 5.1 Simulate offload error

This scenario is hard to trigger manually, but you can verify the fallback mechanism by checking console logs:

**Test:**
```bash
> find / -type f 2>/dev/null | head -n 10000 > large_file.txt
> cat large_file.txt
```

**Expected Behavior:**
- If offload fails, content should be truncated to 1KB
- Fallback message: `[Output truncated due to offload error]`
- Console warning: `[AgentBashHandler] Failed to offload output: ...`

---

## Debugging Tips

### Check Context File Storage

**Location:**
```bash
~/Library/Application\ Support/DeepChat/context/<conversationId>/
```

**Directory Structure:**
```
<contextId>/
├── artifacts/          # Tool outputs
│   ├── uuid1.txt      # Bash/terminal outputs
│   ├── uuid2.txt      # File read outputs
│   └── uuid3.json     # Other artifacts
├── history/           # Conversation history (if implemented)
├── catalog/           # Tool catalog (if implemented)
└── manifest.json      # Metadata about all context files
```

**Inspect Manifest:**
```bash
cat ~/Library/Application\ Support/DeepChat/context/<conversationId>/manifest.json | jq
```

**Sample Manifest:**
```json
{
  "version": 1,
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "kind": "artifact",
      "mimeType": "text/plain",
      "byteSize": 15360,
      "createdAt": 1704700800000,
      "hint": "bash command: find /usr -type f - 15KB",
      "path": "artifacts/550e8400-e29b-41d4-a716-446655440000.txt",
      "strategy": "eager"
    }
  ]
}
```

---

### Check Console Logs

**Key log patterns:**

**Offload successful:**
```
[ToolCallProcessor] Offloaded tool output: execute_command (15000 chars)
[AgentLoop] Tool call: context_list
[AgentLoop] Tool call: context_tail with params: {id: "...", lines: 200}
```

**Offload failed:**
```
[AgentBashHandler] Failed to offload output: ...
[ToolCallProcessor] Failed to offload tool output for read_file: ...
```

**Context file creation:**
```
[ContextStore] Created ref: abc123-def456
[ContextStore] Wrote content: /path/to/context/abc123-def456.txt (15360 bytes)
```

---

### Inspect Context Files

**List all context files:**
```bash
find ~/Library/Application\ Support/DeepChat/context/ -type f -name "*.txt" -o -name "*.json"
```

**Check specific context file:**
```bash
# Get file size and line count
wc -l -c ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/*.txt

# Preview first 20 lines
head -20 ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/*.txt

# Preview last 20 lines
tail -20 ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/*.txt

# Search for "error"
grep -i "error" ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/*.txt
```

---

### Context File Tools Testing

You can also test context file tools directly:

```bash
# 1. List all context files
> context_list()

# 2. Read a context file (first 8KB)
> context_read(id="...", offset=0, limit=8192)

# 3. Tail the last 200 lines
> context_tail(id="...", lines=200)

# 4. Grep for pattern
> context_grep(id="...", pattern="error", maxResults=50, caseSensitive=false)
```

---

## thresholds Configuration

| Scenario | Threshold | When Offloaded |
|----------|-----------|----------------|
| Bash command | 5,000 chars | > 5KB |
| Terminal | 2,048 bytes | > 2KB |
| Generic tools | 1,024 chars | > 1KB |
| File read | 1,024 chars | > 1KB |
| Inline preview | 800 chars | First 800 chars shown |

---

## Success Criteria

### Functional
- [ ] Small outputs (< threshold) displayed inline
- [ ] Large outputs (> threshold) offloaded to context files
- [ ] ContextRef displayed with correct format: `[Description saved to context file](context:id) (size)`
- [ ] Context files created in correct location
- [ ] Manifest contains correct metadata
- [ ] Model recognizes ContextRef and uses context tools
- [ ] `context_list`, `context_read`, `context_tail`, `context_grep` work correctly

### Technical
- [ ] No errors in console during offload
- [ ] Offload failures fallback to truncation
- [ ] Context files are properly cleaned up on session end (future)
- [ ] Performance is acceptable (offload < 100ms for most cases)

### User Experience
- [ ] Inline preview shows useful content
- [ ] ContextRef format is clear and actionable
- [ ] Model understands prompts about offloaded content
- [ ] Error messages are helpful when offload fails

---

## Common Issues

### Issue: "conversationId is required for offloading content"

**Cause:** Tool call doesn't have `conversationId` in the request

**Debug:**
```bash
# Check if conversationId is available in your session
# This should be handled automatically by the system
```

---

### Issue: ContextRef not appearing in tool response

**Causes:**
1. Offload threshold not reached
2. Offload failed (fallback used)
3. Content is binary (image, etc.)

**Debug:**
```bash
# Check console for offload logs
# Check if content size > threshold
# Verify conversationId is present
```

---

### Issue: Model doesn't use context tools

**Causes:**
1. System prompt not enhanced
2. Tools not available in current mode
3. Model doesn't recognize the ContextRef format

**Debug:**
```bash
# Check system prompt includes context files section
# Verify context tools are in tool definitions
# Check if model is using native function calling
```

---

## Performance Benchmarks

You can measure offload performance:

```bash
# Time a large bash command
time bash -c 'find / -type f 2>/dev/null | head -n 5000'

# Expected: < 100ms for offload
# Expected: < 1s total for command execution
```

---

## Next Steps

After testing all scenarios:

1. **Verify all test cases pass**
2. **Check console logs for errors**
3. **Measure performance**
4. **Test edge cases** (empty output, very large output, etc.)
5. **Document any issues found**
6. **Provide feedback on UX improvements**
