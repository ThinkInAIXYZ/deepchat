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
  - `glob`
  - `grep`
- Update prompts so agent search order is `glob -> grep -> read`.
- Remove model-facing and runtime-owned ripgrep search paths:
  - no `rg` fallback adapter
  - no `RuntimeHelper` ripgrep discovery
  - no bundled ripgrep PATH prepending
  - no `replaceWithRuntimeCommand('rg', ...)` mapping
  - no `tiny-runtime-injector --type ripgrep` install step
- Move workspace file picker search off ripgrep by using FFF glob search.
- Keep FFF native dependencies package-safe for macOS by unpacking `fff-node`, platform FFF
  libraries, `ffi-rs`, and platform `ffi-rs` native modules from ASAR so Electron's existing
  codesign/notarization flow can sign them as real files.
- Copy the target `@ff-labs/fff-bin-*` package during `afterPack` when pnpm/electron-builder does
  not copy the transitive optional package automatically.

## Non-Goals

- Blocking a user from manually typing an `rg` command in a shell.
- Removing unrelated content that merely contains the letters `rg`.
- Replacing unrelated shell tools such as Node, UV, or RTK runtime injection.

## Tool Schema

### `glob`

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

### `grep`

Input:

```json
{
  "query": "string",
  "pathScope": ["src/main"],
  "contextLines": 2,
  "maxResults": 50,
  "mode": "plain | regex | fuzzy"
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
- `grep` uses `FileFinder.grep` with smart case, auto-selects regex mode for regex-like queries,
  and accepts explicit `plain`, `regex`, or `fuzzy` mode.
- `grep` hydrates snippets from the matched file and line number so returned JSON includes full
  context lines instead of truncated native `lineContent` when the file is still readable.
- `globFiles` uses `FileFinder.glob` for workspace file picker use cases.
- FFF unavailable errors are returned as tool errors. They are not converted to shell commands.
- Tool metadata reports only `source: "fff"`.
- Packaged apps load FFF from `app.asar.unpacked`, not from virtual `app.asar` paths.

## Prompt Requirements

- Prompts must tell the model to search with `glob` first, then `grep`, then `read`.
- Prompts must forbid shell search commands for code/file search.
- Prompts must not recommend `rg`, shell `grep`, `find`, `fd`, or `ls` for search workflows.

## Acceptance Criteria

- Agent tool definitions include `glob` and `grep`.
- Agent search tool outputs are parseable JSON arrays with stable fields.
- Legacy skill/tool name mapping routes previous file-search aliases to FFF tools.
- Legacy persisted disabled-tool entries for retired default search tools are cleaned so old
  `grep` settings do not hide the new FFF-backed `grep` tool.
- `RuntimeHelper` no longer discovers ripgrep, prepends ripgrep to PATH, or maps `rg`.
- Runtime installer scripts no longer download bundled ripgrep.
- Workspace file search uses FFF glob search instead of `RipgrepSearcher`.
- Codebase contains no `FffRipgrepFallback`, `runRipgrepSearch`, or bundled ripgrep runtime path.
- macOS package configuration explicitly unpacks `fff-node`, `@ff-labs/fff-bin-*`, `ffi-rs`,
  and `@yuuang/ffi-rs-*` so `.node` and `.dylib` files are available to the existing signing
  flow and runtime loader.
- `afterPack` ensures the target platform FFF native library package exists beside `fff-node` in
  `app.asar.unpacked/node_modules`.
- Tests cover FFF JSON shape, tool manager integration, abort handling, workspace glob search, and
  prompt/tool mapping.
