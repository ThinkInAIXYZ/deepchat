# Context Files Offload - Quick Reference

## What Was Implemented

✅ **Automatic offload** for large tool outputs
✅ **Context file storage** in `<userData>/context/`
✅ **Markdown ContextRef format**: `[Description saved to context file](context:id) (size)`
✅ **4 context tools**: `context_list`, `context_read`, `context_tail`, `context_grep`
✅ **System prompt guidance** (English) for models
✅ **Error handling**: truncate + console.warn on failures

---

## Implementation Summary

### Files Created/Modified

| File | Lines | Description |
|------|-------|-------------|
| `ContextOffloadManager.ts` | +115 | Offload logic |
| `toolCallProcessor.ts` | +80 | Universal offload check |
| `agentLoopHandler.ts` | +5 | Pass contextFilePresenter |
| `promptEnhancer.ts` | +19 | Add context files guidance |
| `agentBashHandler.ts` | +50 | Bash offload (5KB threshold) |
| `acpTerminalManager.ts` | -1 | Adjust threshold (2KB) |
| `index.ts` | +1 | Fix initialization order |

**Total**: ~268 lines changed

---

## Thresholds

| Scenario | Threshold | Inline Preview |
|----------|-----------|----------------|
| **Generic tools** | 1 KB | 800 chars |
| **Bash commands** | 5 KB | 800 chars |
| **Terminal** | 2 KB | Auto |
| **File reads** | 1 KB | Auto |

---

## How It Works

### Flow

```
Tool executes
  ↓
Tool returns content
  ↓
ToolCallProcessor checks if content > threshold
  ↓
  Yes → ContextOffloadManager.offload()
         → Create ContextRef
         → Write full content to file
         → Return inline preview + ContextRef markdown
  No  → Return original content
  ↓
Model receives: inline preview + `[Description saved to context file](context:id) (size)`
  ↓
Model uses context tools (context_list, context_read, context_tail, context_grep)
```

### ContextRef Format

```markdown
[Description saved to context file](context:uuid) (size)

# Examples:
[Full bash command output saved to context file](context:abc123) (15.5KB)
[Tool output from read_file saved to context file](context:xyz789) (10,234 chars)
```

---

## Storage Structure

```
~/Library/Application Support/DeepChat/context/<conversationId>/
├── artifacts/              # Tool outputs
│   ├── uuid1.txt
│   └── uuid2.txt
├── history/               # Conversation history (future)
├── catalog/               # Tool catalog (future)
└── manifest.json          # Metadata
```

---

## Key Features

### 1. Universal Offload
- Works for ALL tools: bash, terminal, file system, MCP, browser
- Single point: `ToolCallProcessor.checkAndOffloadToolOutput()`
- No per-tool offload logic needed

### 2. Markdown ContextRef
- Clear, actionable format
- Model-understandable (markdown link)
- Includes size and description

### 3. Context Tools
- `context_list`: Browse available files
- `context_read`: Read chunks (pagination)
- `context_tail`: Read last N lines (for errors)
- `context_grep`: Search with regex

### 4. Error Handling
- On offload failure: truncate to threshold + log warning
- On missing conversationId: skip offload
- Model still receives content (just truncated)

---

## Testing Quick Start

### 1. Start App
```bash
pnpm run dev
```

### 2. Test Scenarios

```bash
# Small output (< 5KB) - no offload
> echo "hello"

# Medium output (~4.8KB) - no offload
> printf 'a%.0s' {1..4800}

# Large output (> 5KB) - offload!
> find /usr -type f 2>/dev/null | head -n 600

# Model interaction
> Please check the exit code and last 20 lines of the previous command

# Search in output
> Please search for "error" in the previous output
```

### 3. Verify

```bash
# Check context files
ls ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/

# Check manifest
cat ~/Library/Application\ Support/DeepChat/context/<conversationId>/manifest.json | jq

# Inspect context file
context_path=$(ls ~/Library/Application\ Support/DeepChat/context/<conversationId>/artifacts/*.txt | head -1)
tail -20 "$context_path"
```

---

## Debugging

### Console Logs

**Success:**
```
[ToolCallProcessor] Offloaded tool output: execute_command (15000 chars)
[ContextStore] Created ref: abc123-def456
[ContextStore] Wrote content: /path/to/file.txt (15360 bytes)
```

**Error:**
```
[AgentBashHandler] Failed to offload output: ...
[ToolCallProcessor] Failed to offload tool output: ...
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No ContextRef | Content < threshold | Use larger output |
| No ContextRef | Offload failed | Check console logs |
| Model doesn't use tools | Tools not available | Check agent mode |

---

## Integration Points

### Modified Code

1. **AgentLoopHandler** (line 696-707)
   - Pass `contextFilePresenter` and `toolOffloadThreshold`

2. **ToolCallProcessor** (line 145, 482-531)
   - Check and offload after tool execution
   - Initialize `ContextOffloadManager`

3. **promptEnhancer.ts** (line 58-72)
   - Add context files guidance to system prompt

4. **AgentBashHandler** (line 17-19, 209-235, 273-306)
   - Lower threshold to 5KB
   - Collect full output
   - Offload via `ContextOffloadManager`

---

## Performance

### Benchmarks

| Operation | Expected |
|-----------|----------|
| Offload 10KB | < 50ms |
| Offload 1MB | < 200ms |
| context_tail (200 lines) | < 20ms |
| context_grep (simple pattern) | < 50ms |

### Memory

- Inline preview: 800 chars max
- Offload overhead: ~1KB per context file (metadata)
- Context files: Eager strategy (written immediately)

---

## Future Enhancements

- [ ] Lazy strategy for DB-stored data
- [ ] LRU cleanup of old context files
- [ ] UI integration (context browser)
- [ ] Manual offload of historical messages
- [ ] Configurable thresholds
- [ ] Compression for large context files

---

## Documentation

- **Spec**: `docs/specs/context-files/spec.md`
- **Plan**: `docs/specs/context-files/plan.md`
- **Test Guide**: `docs/specs/context-files/test-guide.md`
- **Quick Reference**: `docs/specs/context-files/quick-ref.md` (this file)

---

## Authors

**Implementation Date**: 2026-01-08
**Implementation Time**: ~6.5 days (Phases 1-3)
**Status**: ✅ Core implementation complete, ready for testing
