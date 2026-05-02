# edit_file Tool Specification

## Overview

Add a new `edit_file` tool to the agent filesystem tools that enables AI agents to make precise text-based edits to files. This tool provides a simplified interface for exact string replacement, complementing the existing `edit_text` tool which supports regex and line-based operations.

## User Stories

### Primary User Story

As an AI agent interacting with DeepChat, I want to edit specific portions of a file using exact text matching so that I can make precise modifications without worrying about regex escaping or complex operations.

### Use Cases

1. **Simple Text Replacement** - Replace a specific function implementation with an updated version
2. **Configuration Updates** - Modify specific configuration values in config files
3. **Bug Fixes** - Replace buggy code snippets with corrected versions
4. **Refactoring** - Update variable names or function calls across files

## Acceptance Criteria

### Functional Requirements

- [ ] Tool accepts `path` (or `file_path`) parameter for target file
- [ ] Tool accepts `oldText` (or `old_string`) parameter for text to find
- [ ] Tool accepts `newText` (or `new_string`) parameter for replacement text
- [ ] Tool optionally accepts `base_directory` for resolving relative paths
- [ ] Tool performs exact string matching (case-sensitive)
- [ ] Tool replaces ALL occurrences of oldText when multiple matches exist
- [ ] Tool returns a JSON response with diff preview (original vs updated)
- [ ] Tool returns clear error message when oldText is not found
- [ ] Tool requires write permission before modifying files
- [ ] Tool validates paths are within allowed directories

### Non-Functional Requirements

- [ ] Tool follows existing filesystem tool patterns (schema, handler, registration)
- [ ] Tool response format is consistent with other filesystem tools
- [ ] Error messages are user-friendly and actionable
- [ ] Tool is registered under `agent-filesystem` server namespace

## Non-Goals

- Support for regex patterns (use `edit_text` or `text_replace` instead)
- Support for partial/line-based matching (use `edit_text` with `edit_lines` instead)
- Support for dry-run mode (can be added in future if needed)
- Support for multiple file editing in single call
- Support for backup creation (handled at system level if needed)

## Constraints

- Maximum text length for `oldText` and `newText` should be reasonable (suggest 10,000 chars)
- Path resolution follows existing `base_directory` pattern
- Must integrate with existing permission system for write operations

## Open Questions

None. All clarifications resolved:

- **Parameter naming**: Support both camelCase (`path`, `oldText`, `newText`) and snake_case (`file_path`, `old_string`, `new_string`) variants for LLM compatibility
- **Multiple matches**: Replace all occurrences (not just first) to match common editing expectations
- **Case sensitivity**: Exact matching is case-sensitive (consistent with `edit_text` behavior)

## UI/UX Considerations

- Tool icon should match other filesystem tools (📁)
- Tool description: "Make precise edits to files by replacing exact text strings"
- Error display should highlight what text was not found

## Related Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `write_file` | Overwrite entire file | Creating new files or full rewrites |
| `edit_text` | Pattern/line-based editing | Regex replacement or complex edits |
| `text_replace` | Regex-based replacement | Pattern-based text replacement |
| `edit_file` | Exact string replacement | Simple, precise text modifications |
