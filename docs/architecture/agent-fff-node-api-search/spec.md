# Agent FFF Node API Search Spec

## Goal

Replace DeepChat agent/runtime file search with direct Node.js calls to `@ff-labs/fff-node`.
The implementation is FFF-only: DeepChat must not use bundled ripgrep as a fallback, must not
install bundled ripgrep, and must not inject bundled ripgrep into command execution environments.

## Scope

- Add DeepChat tool-layer wrappers:
  - `findFiles(query: string, options?: object)` returns `Array<{ path, score }>`
  - `grep(query: string, pathScope?: string[], contextLines?: number)` returns
    `Array<{ path, lineNumber, snippet, score }>`
- Expose model tools:
  - `fff_find_files`
  - `fff_grep`
- Update prompts so agent search order is `fff_find_files -> fff_grep -> read`.
- Remove model-facing and runtime-owned ripgrep search paths:
  - no `rg` fallback adapter
  - no `RuntimeHelper` ripgrep discovery
  - no bundled ripgrep PATH prepending
  - no `replaceWithRuntimeCommand('rg', ...)` mapping
  - no `tiny-runtime-injector --type ripgrep` install step
- Move workspace file picker search off ripgrep by using FFF glob search.

## Non-Goals

- Blocking a user from manually typing an `rg` command in a shell.
- Removing unrelated content that merely contains the letters `rg`.
- Replacing unrelated shell tools such as Node, UV, or RTK runtime injection.

## Tool Schema

### `fff_find_files`

Input:

```json
{
  "query": "string",
  "options": {
    "pathScope": ["string"],
    "maxResults": 50,
    "currentFile": "string"
  }
}
```

Output:

```json
[
  {
    "path": "src/main/example.ts",
    "score": 123
  }
]
```

### `fff_grep`

Input:

```json
{
  "query": "string",
  "pathScope": ["src/main"],
  "contextLines": 2,
  "maxResults": 50
}
```

Output:

```json
[
  {
    "path": "src/main/example.ts",
    "lineNumber": 42,
    "snippet": "const value = needle",
    "score": 123
  }
]
```

## Runtime Behavior

- `FffSearchService` owns cached `FileFinder` instances per workspace root.
- The service waits for FFF's initial scan and supports `AbortSignal` while waiting/searching.
- `findFiles` uses `FileFinder.fileSearch`.
- `grep` uses `FileFinder.grep` in plain mode with smart case.
- `globFiles` uses `FileFinder.glob` for workspace file picker use cases.
- FFF unavailable errors are returned as tool errors. They are not converted to shell commands.
- Tool metadata reports only `source: "fff"`.

## Prompt Requirements

- Prompts must tell the model to search with `fff_find_files` first, then `fff_grep`, then `read`.
- Prompts must forbid shell search commands for code/file search.
- Prompts must not recommend `rg`, `grep`, `find`, `fd`, or `ls` for search workflows.

## Acceptance Criteria

- Agent tool definitions include `fff_find_files` and `fff_grep`.
- Agent search tool outputs are parseable JSON arrays with stable fields.
- Legacy skill/tool name mapping routes previous file-search aliases to FFF tools.
- `RuntimeHelper` no longer discovers ripgrep, prepends ripgrep to PATH, or maps `rg`.
- Runtime installer scripts no longer download bundled ripgrep.
- Workspace file search uses FFF glob search instead of `RipgrepSearcher`.
- Codebase contains no `FffRipgrepFallback`, `runRipgrepSearch`, or bundled ripgrep runtime path.
- Tests cover FFF JSON shape, tool manager integration, abort handling, workspace glob search, and
  prompt/tool mapping.
