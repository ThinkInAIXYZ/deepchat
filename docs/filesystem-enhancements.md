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

### 3. Enhanced Glob Search (glob_search)

Advanced file pattern matching using glob patterns, inspired by Google Gemini CLI tools.

**Features:**
- Powerful glob pattern matching (e.g., `**/*.ts`, `src/**/*.js`)
- Intelligent sorting by modification time (newest first)
- Git-aware filtering with .gitignore support
- Performance optimized for large codebases
- Result limiting and validation
- Security-conscious path validation

**Usage Example:**
```json
{
  "tool": "glob_search",
  "arguments": {
    "pattern": "**/*.{ts,js}",
    "path": "./src",
    "caseSensitive": false,
    "respectGitIgnore": true,
    "sortByModified": true,
    "maxResults": 100
  }
}
```

**Use Cases:**
- Finding files by complex patterns
- Locating recently modified files
- Bulk file operations preparation
- Project structure analysis

### 4. Enhanced Directory Listing (list_directory)

Comprehensive directory listing with detailed information, sorting, and filtering options.

**Features:**
- Detailed file information (size, modification time, permissions)
- Multiple sorting options (name, size, modification time)
- Ignore patterns with glob support
- Git-aware filtering
- Directory-first sorting
- Human-readable file sizes

**Usage Example:**
```json
{
  "tool": "list_directory",
  "arguments": {
    "path": "/path/to/directory",
    "showDetails": true,
    "sortBy": "modified",
    "ignorePatterns": ["*.tmp", "node_modules"],
    "respectGitIgnore": true
  }
}
```

**Use Cases:**
- Detailed directory analysis
- Finding large files
- Identifying recently modified files
- Project cleanup and organization

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
- **glob_search**: Uses native glob library for optimal performance
- **list_directory**: Efficient stat operations with error handling
- **Context lines**: Limited context prevents excessive memory usage
- **Recursive search**: Respects directory permissions and skips unreadable directories

## Error Handling

All tools provide comprehensive error handling:
- Invalid regex pattern detection
- File permission issues
- Path validation failures
- Memory constraints
- Network/disk I/O errors

## Integration with Existing Tools

The new tools complement existing functionality:
- Use `search_files` to find files by name, then `grep_search` to search content
- Use `glob_search` for advanced pattern matching, then operate on results
- Use `grep_search` to find patterns, then `text_replace` to modify them
- Use `list_directory` with details to analyze directory contents
- Use dry-run mode in `text_replace` before making actual changes

## Examples

### Finding and Replacing Function Names
```bash
# 1. Find all TypeScript files with a specific function using glob
glob_search:
  pattern: "**/*.ts"
  path: "./src"

# 2. Search for the function in those files
grep_search:
  path: "./src"
  pattern: "function oldName\\("
  filePattern: "*.ts"

# 3. Preview the replacement
text_replace:
  path: "./src/utils.ts"
  pattern: "function oldName\\("
  replacement: "function newName("
  dryRun: true

# 4. Apply the replacement
text_replace:
  path: "./src/utils.ts"
  pattern: "function oldName\\("
  replacement: "function newName("
  dryRun: false
```

### Project Analysis Workflow
```bash
# 1. Get detailed directory listing
list_directory:
  path: "./src"
  showDetails: true
  sortBy: "size"

# 2. Find recently modified files
glob_search:
  pattern: "**/*"
  path: "./src"
  sortByModified: true
  maxResults: 20

# 3. Search for TODO items
grep_search:
  path: "./src"
  pattern: "TODO|FIXME|HACK"
  caseSensitive: false
  includeLineNumbers: true
```

### Configuration Management
```bash
# 1. Find all config files
glob_search:
  pattern: "**/*.{json,yml,yaml,env}"
  respectGitIgnore: true

# 2. Search for API keys
grep_search:
  path: "./config"
  pattern: "API_KEY.*="
  contextLines: 1

# 3. Update configuration values
text_replace:
  path: "./config/app.json"
  pattern: '"version":\\s*"[^"]*"'
  replacement: '"version": "2.0.0"'
  dryRun: true
```

## Best Practices

1. **Always use dry-run first** when using `text_replace` on important files
2. **Limit search scope** with appropriate patterns to improve performance
3. **Test regex patterns** with small datasets first
4. **Use context lines** in `grep_search` to understand match context
5. **Set reasonable `maxResults`** to prevent overwhelming output
6. **Leverage glob patterns** for efficient file discovery
7. **Use detailed listing** for directory analysis and cleanup
8. **Combine tools** for powerful workflows
9. **Validate patterns** before running on production code

## Migration from Basic Tools

If you were previously using basic file operations, here's how to upgrade:

- **File discovery**: Use `glob_search` instead of manual directory traversal
- **File content search**: Replace manual `read_file` + string search with `grep_search`
- **Text replacement**: Replace `read_file` + manual editing + `write_file` with `text_replace`
- **Directory analysis**: Use enhanced `list_directory` with details and sorting
- **Code analysis**: Combine `glob_search` and `grep_search` for comprehensive analysis

## Tool Comparison

| Feature | Basic Tools | Enhanced Tools |
|---------|-------------|----------------|
| File Search | `search_files` (simple patterns) | `glob_search` (advanced patterns, sorting) |
| Directory Listing | `list_directory` (basic) | `list_directory` (enhanced with details, sorting, filtering) |
| Content Search | Manual `read_file` + search | `grep_search` (regex, context, performance) |
| Text Editing | `edit_file` (line-based) | `text_replace` (pattern-based, dry-run) |
| Performance | Good for small projects | Optimized for large codebases |
| Features | Basic functionality | Advanced filtering, sorting, git-awareness |

These enhancements provide powerful text processing and file discovery capabilities while maintaining the security and reliability of the original filesystem service.
