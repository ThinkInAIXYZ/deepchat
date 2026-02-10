# edit_file Tool Implementation Plan

## Architecture Overview

The `edit_file` tool will be integrated into the existing agent filesystem tool infrastructure, following the established three-layer architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Tool Definition (agentToolManager.ts)            │
│  - Zod schema for parameter validation                      │
│  - Tool metadata (name, description, parameters)            │
│  - Registration in filesystem tool registry                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Tool Routing (agentToolManager.ts)               │
│  - Parameter normalization (alias handling)                 │
│  - Permission checks (assertWritePermission)               │
│  - Dispatch to filesystem handler                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: File Operation (agentFileSystemHandler.ts)       │
│  - Path validation and resolution                           │
│  - File content reading                                     │
│  - Exact text replacement                                   │
│  - Diff generation and response formatting                  │
└─────────────────────────────────────────────────────────────┘
```

## Design Decisions

### 1. Parameter Alias Handling

**Decision**: Normalize parameter names at the routing layer (agentToolManager.callFileSystemTool) rather than in Zod schema.

**Rationale**:
- Zod does not natively support parameter aliases
- Normalizing early allows schema to use canonical names
- Keeps handler implementation clean

**Implementation**:
```typescript
// Normalize parameter aliases before schema validation
if (toolName === 'edit_file') {
  args = {
    path: args.path ?? args.file_path,
    oldText: args.oldText ?? args.old_string,
    newText: args.newText ?? args.new_string,
    base_directory: args.base_directory,
    ...args
  }
}
```

### 2. Text Matching Strategy

**Decision**: Case-sensitive exact string matching, replace ALL occurrences.

**Rationale**:
- Consistent with `edit_text` tool's `edit_lines` operation
- Simple mental model for LLMs: "find this exact text, replace with that"
- Replacing all occurrences prevents partial updates which could leave code in inconsistent state

### 3. Response Format

**Decision**: JSON response with diff preview, matching existing filesystem tools.

**Structure**:
```typescript
interface EditFileSuccessResponse {
  success: true
  originalCode: string    // Truncated for large files
  updatedCode: string     // Truncated for large files
  language: string        // Detected from file extension
  replacements: number    // Number of replacements made
}

interface EditFileErrorResponse {
  success: false
  error: string
}
```

## File Changes

### Modified Files

| File | Purpose | Lines Added/Modified |
|------|---------|----------------------|
| `src/main/presenter/agentPresenter/acp/agentToolManager.ts` | Schema, definition, routing | ~80 lines |
| `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts` | Handler implementation | ~50 lines |

### No New Files Required

The implementation integrates into existing infrastructure without creating new files.

## Implementation Details

### Schema Definition (agentToolManager.ts)

```typescript
edit_file: z.object({
  path: z.string().describe('Path to the file to edit'),
  oldText: z
    .string()
    .max(10000)
    .describe('The exact text to find and replace (case-sensitive)'),
  newText: z.string().max(10000).describe('The replacement text'),
  base_directory: z
    .string()
    .optional()
    .describe('Base directory for resolving relative paths')
})
```

### Tool Definition

```typescript
{
  type: 'function',
  function: {
    name: 'edit_file',
    description:
      'Make precise edits to files by replacing exact text strings. Use this for simple text replacements when you know the exact content to replace. For regex or complex operations, use edit_text instead.',
    parameters: zodToJsonSchema(schemas.edit_file)
  },
  server: {
    name: 'agent-filesystem',
    icons: '📁',
    description: 'Agent FileSystem tools'
  }
}
```

### Handler Implementation (agentFileSystemHandler.ts)

```typescript
async editFile(args: unknown, baseDirectory?: string): Promise<string> {
  const parsed = EditFileArgsSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments: ${parsed.error}`)
  }

  const { path: filePath, oldText, newText } = parsed.data
  const validPath = await this.validatePath(filePath, baseDirectory)

  const content = await fs.readFile(validPath, 'utf-8')

  if (!content.includes(oldText)) {
    throw new Error(`Cannot find the specified text to replace. The exact text was not found in the file.`)
  }

  let replacementCount = 0
  const modifiedContent = content.replaceAll(oldText, () => {
    replacementCount++
    return newText
  })

  await fs.writeFile(validPath, modifiedContent, 'utf-8')

  const { originalCode, updatedCode } = this.buildTruncatedDiff(content, modifiedContent, 3)
  const language = getLanguageFromFilename(validPath)

  return JSON.stringify({
    success: true,
    originalCode,
    updatedCode,
    language,
    replacements: replacementCount
  })
}
```

## Test Strategy

### Unit Tests (test/main/presenter/agentPresenter/acp/)

Create `agentFileSystemHandler.editFile.test.ts`:

- **Happy Path**: Replace single occurrence, replace multiple occurrences
- **Error Cases**: File not found, oldText not found, path outside allowed directories
- **Edge Cases**: Empty oldText, empty newText, large text content

### Integration Tests

- Verify tool registration and routing
- Verify permission system integration
- Verify response format consistency

## Security Considerations

- Path traversal prevention via existing `validatePath()` method
- Write permission enforcement via `assertWritePermission()`
- Allowed directory restriction via `isPathAllowed()` check
- Maximum text length limits (10,000 chars for oldText/newText)

## Migration & Compatibility

- No breaking changes to existing tools
- New tool is additive only
- No database or configuration migrations required
- No impact on existing agent workflows

## Rollback Plan

If issues are discovered:
1. Remove tool from `isFileSystemTool()` list to disable
2. Remove tool definition from `getFileSystemToolDefinitions()`
3. No data changes to revert (file changes are atomic writes)

## Performance Considerations

- File reads are limited by available memory
- `replaceAll()` is O(n*m) where n=content length, m=pattern length
- For very large files (>1MB), consider warning or limiting
- Diff truncation limits output size for large changes

## Success Metrics

- Tool is available in agent tool list
- Tool accepts all parameter variants (camelCase and snake_case)
- Tool successfully edits files with exact text matching
- Tool returns proper error messages for invalid inputs
- All tests pass
- Lint and typecheck pass
