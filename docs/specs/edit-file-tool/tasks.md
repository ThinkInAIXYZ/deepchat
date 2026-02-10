# edit_file Tool Implementation Tasks

## Task List

### Phase 1: Schema and Definition

- [ ] **Task 1.1**: Add `edit_file` schema to `fileSystemSchemas` in `agentToolManager.ts`
  - Location: `src/main/presenter/agentPresenter/acp/agentToolManager.ts` (line ~69-214)
  - Add after `text_replace` schema
  - Include: path, oldText, newText, base_directory fields
  - Add max length validation (10000 chars) for oldText/newText

- [ ] **Task 1.2**: Add `edit_file` tool definition to `getFileSystemToolDefinitions()`
  - Location: `src/main/presenter/agentPresenter/acp/agentToolManager.ts` (line ~411-630)
  - Add after `text_replace` definition
  - Description: "Make precise edits to files by replacing exact text strings"
  - Icon: 📁 (same as other filesystem tools)

- [ ] **Task 1.3**: Add `'edit_file'` to `isFileSystemTool()` method
  - Location: `src/main/presenter/agentPresenter/acp/agentToolManager.ts` (line ~655-671)
  - Add to filesystemTools array

### Phase 2: Routing and Parameter Normalization

- [ ] **Task 2.1**: Add parameter normalization for `edit_file` in `callFileSystemTool()`
  - Location: `src/main/presenter/agentPresenter/acp/agentToolManager.ts` (line ~673+)
  - After schema validation, before switch statement
  - Normalize: file_path → path, old_string → oldText, new_string → newText

- [ ] **Task 2.2**: Add `edit_file` case to switch statement in `callFileSystemTool()`
  - Location: `src/main/presenter/agentPresenter/acp/agentToolManager.ts` (line ~716-785)
  - Add after `text_replace` case
  - Include `assertWritePermission()` check
  - Call `fileSystemHandler.editFile()`

### Phase 3: Handler Implementation

- [ ] **Task 3.1**: Add `EditFileArgsSchema` to `agentFileSystemHandler.ts`
  - Location: `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`
  - Add after `TextReplaceArgsSchema` (~line 107)
  - Define: path, oldText, newText, base_directory

- [ ] **Task 3.2**: Implement `editFile()` method in `AgentFileSystemHandler`
  - Location: `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`
  - Add after `textReplace()` method
  - Steps:
    1. Parse and validate arguments
    2. Resolve and validate path
    3. Read file content
    4. Check if oldText exists
    5. Replace all occurrences using replaceAll()
    6. Write modified content
    7. Generate diff and return JSON response

### Phase 4: Quality Assurance

- [ ] **Task 4.1**: Run type checking
  ```bash
  pnpm run typecheck
  ```

- [ ] **Task 4.2**: Run linting
  ```bash
  pnpm run lint
  ```

- [ ] **Task 4.3**: Run formatting
  ```bash
  pnpm run format
  ```

- [ ] **Task 4.4**: Run tests
  ```bash
  pnpm test
  ```

## Verification Checklist

### Manual Testing

- [ ] Tool appears in agent tool list
- [ ] Tool accepts `path`, `oldText`, `newText` parameters
- [ ] Tool accepts `file_path`, `old_string`, `new_string` aliases
- [ ] Tool successfully replaces text in a file
- [ ] Tool replaces ALL occurrences when multiple matches exist
- [ ] Tool returns proper error when oldText not found
- [ ] Tool returns proper error when file not found
- [ ] Tool respects write permissions
- [ ] Tool respects path validation (outside allowed directories)

### Code Review Checklist

- [ ] Schema uses appropriate validation (max length, required fields)
- [ ] Parameter aliases are normalized before schema validation
- [ ] Error messages are user-friendly
- [ ] Response format matches other filesystem tools
- [ ] Code follows existing style conventions
- [ ] No unnecessary comments or dead code

## Commit Suggestion

```
feat(agent): add edit_file tool for precise text editing

Add new filesystem tool that enables AI agents to make precise
text-based edits using exact string matching.

Features:
- Exact text replacement with case-sensitive matching
- Support for parameter aliases (path/file_path, oldText/old_string, newText/new_string)
- Replace all occurrences of matching text
- JSON diff response with language detection
- Write permission enforcement

Files modified:
- src/main/presenter/agentPresenter/acp/agentToolManager.ts
- src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts
```
