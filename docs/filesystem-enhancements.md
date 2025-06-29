# Filesystem Service Enhancements

This document describes the enhanced text file functionality added to the filesystem MCP server.

## New Features

### 1. Text Content Search (grep_search)

Search for text patterns within file contents using regular expressions, similar to the Unix `grep` command.

**Features:**
- Regular expression pattern matching
- Recursive directory traversal
- File name filtering with glob patterns
- Case-sensitive/insensitive search
- Context lines before and after matches
- Line number display
- Result limiting to prevent overwhelming output

**Usage Example:**
```json
{
  "tool": "grep_search",
  "arguments": {
    "path": "/path/to/search",
    "pattern": "function\\s+\\w+\\(",
    "filePattern": "*.ts",
    "recursive": true,
    "caseSensitive": false,
    "includeLineNumbers": true,
    "contextLines": 2,
    "maxResults": 50
  }
}
```

**Use Cases:**
- Finding function definitions across a codebase
- Searching for specific error messages or log patterns
- Locating configuration values
- Code analysis and refactoring preparation

### 2. Text Pattern Replacement (text_replace)

Replace text patterns in files using regular expressions with support for dry-run mode and diff preview.

**Features:**
- Regular expression find and replace
- Global or first-match replacement
- Case-sensitive/insensitive matching
- Dry-run mode with git-style diff preview
- Automatic backup through diff display
- Error handling for invalid patterns

**Usage Example:**
```json
{
  "tool": "text_replace",
  "arguments": {
    "path": "/path/to/file.ts",
    "pattern": "oldFunctionName",
    "replacement": "newFunctionName",
    "global": true,
    "caseSensitive": true,
    "dryRun": true
  }
}
```

**Use Cases:**
- Bulk text replacements across files
- Code refactoring (renaming variables, functions)
- Configuration updates
- Documentation updates
- Version number updates

## Enhanced Existing Features

### Improved File Editing
- Better diff display formatting
- Enhanced error messages
- More robust pattern matching

### Better Error Handling
- Detailed error messages for invalid regex patterns
- Graceful handling of binary files
- Better permission error reporting

## Security Features

All new functionality maintains the existing security model:
- Path validation within allowed directories
- Symlink protection
- Permission checking
- Input sanitization

## Performance Considerations

- **grep_search**: Results are limited by `maxResults` parameter to prevent memory issues
- **text_replace**: Processes files in memory, suitable for text files up to several MB
- **Context lines**: Limited context prevents excessive memory usage
- **Recursive search**: Respects directory permissions and skips unreadable directories

## Error Handling

Both new tools provide comprehensive error handling:
- Invalid regex pattern detection
- File permission issues
- Path validation failures
- Memory constraints
- Network/disk I/O errors

## Integration with Existing Tools

The new tools complement existing functionality:
- Use `search_files` to find files by name, then `grep_search` to search content
- Use `grep_search` to find patterns, then `text_replace` to modify them
- Use `read_file` to examine files before using `text_replace`
- Use dry-run mode in `text_replace` before making actual changes

## Examples

### Finding and Replacing Function Names
```bash
# 1. Find all TypeScript files with a specific function
grep_search:
  path: "./src"
  pattern: "function oldName\\("
  filePattern: "*.ts"

# 2. Preview the replacement
text_replace:
  path: "./src/utils.ts"
  pattern: "function oldName\\("
  replacement: "function newName("
  dryRun: true

# 3. Apply the replacement
text_replace:
  path: "./src/utils.ts"
  pattern: "function oldName\\("
  replacement: "function newName("
  dryRun: false
```

### Searching for Configuration Values
```bash
grep_search:
  path: "./config"
  pattern: "API_KEY.*="
  filePattern: "*.json,*.yml,*.env"
  contextLines: 1
```

### Code Analysis
```bash
grep_search:
  path: "./src"
  pattern: "TODO|FIXME|HACK"
  filePattern: "*.ts,*.js"
  caseSensitive: false
  includeLineNumbers: true
```

## Best Practices

1. **Always use dry-run first** when using `text_replace` on important files
2. **Limit search scope** with appropriate `filePattern` to improve performance
3. **Test regex patterns** with small datasets first
4. **Use context lines** in `grep_search` to understand match context
5. **Set reasonable `maxResults`** to prevent overwhelming output
6. **Validate patterns** before running on production code

## Migration from Basic Tools

If you were previously using basic file operations, here's how to upgrade:

- **File content search**: Replace manual `read_file` + string search with `grep_search`
- **Text replacement**: Replace `read_file` + manual editing + `write_file` with `text_replace`
- **Code analysis**: Use `grep_search` instead of multiple `read_file` calls

These enhancements provide powerful text processing capabilities while maintaining the security and reliability of the original filesystem service.
