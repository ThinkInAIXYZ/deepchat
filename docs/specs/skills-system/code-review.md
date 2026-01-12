# Skills System Code Review

## Overview

This document records issues and suggestions found during the code review of the Skills system implementation.

**Review Date**: 2026-01-09
**Reviewed Files**:
- `src/main/presenter/skillPresenter/index.ts`
- `src/main/presenter/skillPresenter/skillTools.ts`
- `src/shared/types/skill.ts`
- `src/renderer/settings/components/skills/SkillsSettings.vue`
- `src/renderer/settings/components/skills/SkillEditorSheet.vue`
- `src/renderer/settings/components/skills/SkillInstallDialog.vue`
- `src/renderer/settings/components/skills/SkillCard.vue`
- `src/renderer/settings/components/skills/SkillsHeader.vue`
- `src/renderer/settings/components/skills/SkillFolderTree.vue`
- `src/renderer/settings/components/skills/SkillFolderTreeNode.vue`
- `src/renderer/src/stores/skillsStore.ts`
- `src/main/presenter/agentPresenter/message/skillsPromptBuilder.ts`
- `src/main/presenter/agentPresenter/acp/agentToolManager.ts`
- `src/main/presenter/configPresenter/index.ts` (skills config)
- `src/main/presenter/sessionPresenter/types.ts` (activeSkills type)

---

## Issues

### Issue 1: Potential race condition in `getMetadataList()`

**Location**: `src/main/presenter/skillPresenter/index.ts:155-160`

**Severity**: Medium

**Description**: Multiple concurrent calls to `getMetadataList()` when cache is empty could trigger multiple `discoverSkills()` calls simultaneously.

```typescript
async getMetadataList(): Promise<SkillMetadata[]> {
  if (this.metadataCache.size === 0) {
    await this.discoverSkills()  // Race condition here
  }
  return Array.from(this.metadataCache.values())
}
```

**Recommendation**: Add a discovery lock or pending promise pattern:
```typescript
private discoveryPromise: Promise<SkillMetadata[]> | null = null

async getMetadataList(): Promise<SkillMetadata[]> {
  if (this.metadataCache.size === 0) {
    if (!this.discoveryPromise) {
      this.discoveryPromise = this.discoverSkills().finally(() => {
        this.discoveryPromise = null
      })
    }
    await this.discoveryPromise
  }
  return Array.from(this.metadataCache.values())
}
```

**Status**: [ ] Not Fixed

---

### Issue 2: Duplicate code in prompt generation

**Location**:
- `src/main/presenter/skillPresenter/index.ts:165-176`
- `src/main/presenter/agentPresenter/message/skillsPromptBuilder.ts:52-74`

**Severity**: Low

**Description**: The same prompt generation logic exists in two places, violating DRY principle.

**Recommendation**: Have `buildSkillsMetadataPrompt()` delegate to `skillPresenter.getMetadataPrompt()`:
```typescript
export async function buildSkillsMetadataPrompt(): Promise<string> {
  if (!isSkillsEnabled()) return ''
  const skillPresenter = presenter.skillPresenter as SkillPresenter
  return skillPresenter.getMetadataPrompt()
}
```

**Status**: [ ] Not Fixed

---

### Issue 3: Recursive folder tree has no depth limit

**Location**: `src/main/presenter/skillPresenter/index.ts:564-587`

**Severity**: Medium

**Description**: The `buildFolderTree()` method recurses without depth protection. This could cause stack overflow with deep directory structures or symlink loops.

```typescript
private buildFolderTree(dirPath: string): SkillFolderNode[] {
  // No depth limit - could recurse infinitely
  for (const entry of entries) {
    if (entry.isDirectory()) {
      nodes.push({
        children: this.buildFolderTree(fullPath)  // Unlimited recursion
      })
    }
  }
}
```

**Recommendation**: Add depth limit parameter:
```typescript
private buildFolderTree(dirPath: string, depth: number = 0, maxDepth: number = 5): SkillFolderNode[] {
  if (depth >= maxDepth) return []
  // ... rest of implementation with depth + 1 in recursive call
}
```

**Status**: [ ] Not Fixed

---

### Issue 4: URL download lacks timeout and size limit

**Location**: `src/main/presenter/skillPresenter/index.ts:487-494`

**Severity**: Medium

**Description**: The `downloadSkillZip()` function uses `fetch` without timeout or maximum file size check. A malicious or slow URL could hang the application or exhaust memory.

```typescript
private async downloadSkillZip(url: string, destPath: string): Promise<void> {
  const response = await fetch(url)  // No timeout
  const buffer = new Uint8Array(await response.arrayBuffer())  // No size limit
  fs.writeFileSync(destPath, Buffer.from(buffer))
}
```

**Recommendation**: Add AbortController with timeout and Content-Length validation:
```typescript
private async downloadSkillZip(url: string, destPath: string): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s timeout

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`)
    }

    const contentLength = response.headers.get('content-length')
    const maxSize = 50 * 1024 * 1024 // 50MB limit
    if (contentLength && parseInt(contentLength) > maxSize) {
      throw new Error('File too large')
    }

    const buffer = new Uint8Array(await response.arrayBuffer())
    fs.writeFileSync(destPath, Buffer.from(buffer))
  } finally {
    clearTimeout(timeoutId)
  }
}
```

**Status**: [ ] Not Fixed

---

### Issue 5: Missing validation for `allowedTools` array elements

**Location**: `src/main/presenter/skillPresenter/index.ts:144`

**Severity**: Low

**Description**: The code checks if `allowedTools` is an array but doesn't validate that elements are strings.

```typescript
allowedTools: Array.isArray(data.allowedTools) ? data.allowedTools : undefined
```

**Recommendation**: Filter to ensure only strings:
```typescript
allowedTools: Array.isArray(data.allowedTools)
  ? data.allowedTools.filter((t): t is string => typeof t === 'string')
  : undefined
```

**Status**: [ ] Not Fixed

---

### Issue 6: Error state not exposed in store

**Location**: `src/renderer/src/stores/skillsStore.ts:20-29`

**Severity**: Low

**Description**: The `error` ref is set on failure but the UI doesn't display it. Users won't know why skill loading failed.

**Recommendation**: Either:
1. Show error state in SkillsSettings.vue
2. Use toast notifications for load errors
3. Add retry mechanism

**Status**: [ ] Not Fixed

---

### Issue 7: Event listener cleanup pattern

**Location**: `src/renderer/settings/components/skills/SkillsSettings.vue:148-162`

**Severity**: Low

**Description**: Event listeners are added with inline function reference. If component remounts rapidly, listeners could accumulate.

**Recommendation**: Consider using a composable or ensuring the cleanup ref is properly nullified.

**Status**: [ ] Not Fixed

---

### Issue 8: YAML injection in skill editor

**Location**: `src/renderer/settings/components/skills/SkillEditorSheet.vue:179-201`

**Severity**: Medium

**Description**: The `buildSkillContent()` function directly interpolates user input into YAML frontmatter without escaping. If name or description contains special YAML characters (quotes, colons, newlines), the resulting file could be malformed or inject unintended fields.

```typescript
const buildSkillContent = (): string => {
  const frontmatter = ['---']
  frontmatter.push(`name: "${editName.value}"`)  // No escaping
  frontmatter.push(`description: "${editDescription.value}"`)  // No escaping
  // ...
}
```

**Recommendation**: Use a proper YAML serializer like `yaml` or `js-yaml`:
```typescript
import yaml from 'js-yaml'

const buildSkillContent = (): string => {
  const frontmatter = {
    name: editName.value,
    description: editDescription.value,
    ...(tools.length > 0 && { allowedTools: tools })
  }
  return `---\n${yaml.dump(frontmatter)}---\n\n${editContent.value}`
}
```

**Status**: [ ] Not Fixed

---

### Issue 9: Skill name change not handled

**Location**: `src/renderer/settings/components/skills/SkillEditorSheet.vue:203-233`

**Severity**: Medium

**Description**: The editor allows changing the skill `name` field, but the save operation uses the original `props.skill.name`. If a user changes the name, the skill file is updated but the directory name remains unchanged, causing a mismatch between directory name and skill name in frontmatter.

```typescript
const handleSave = async () => {
  if (!props.skill) return
  // ...
  const result = await skillsStore.updateSkillFile(props.skill.name, content)  // Uses old name
  // ...
}
```

**Recommendation**: Either:
1. Make the name field read-only in the editor
2. Implement rename logic that renames the directory when name changes
3. Add validation to prevent name changes

**Status**: [ ] Not Fixed

---

### Issue 10: Drag-and-drop handlers show error but don't work

**Location**: `src/renderer/settings/components/skills/SkillInstallDialog.vue:200-211, 238-247`

**Severity**: Low

**Description**: The UI has drag-and-drop visual feedback (border highlighting) but the actual handlers just show an error toast saying "drag not supported". This is confusing UX - the UI suggests drag is supported when it isn't.

```typescript
const handleFolderDrop = async (event: DragEvent) => {
  folderDragOver.value = false
  // ...
  toast({
    title: t('settings.skills.install.dragNotSupported'),
    variant: 'destructive'
  })
}
```

**Recommendation**: Either:
1. Remove the drag-over visual feedback if drag is not supported
2. Implement proper drag-and-drop via IPC (Electron can get file paths from drag events)

**Status**: [ ] Not Fixed

---

### Issue 11: Unused `filePresenter` import

**Location**: `src/renderer/settings/components/skills/SkillEditorSheet.vue:121`

**Severity**: Low

**Description**: The `filePresenter` is used to read skill file content, but the store already has methods to handle this. This creates an inconsistent pattern where some operations go through the store and others directly through presenters.

```typescript
const filePresenter = usePresenter('filePresenter')
// ...
const content = await filePresenter.readFile(skill.path)
```

**Recommendation**: Add a `getSkillContent(name)` method to the store or use the existing `skillPresenter.loadSkillContent()` consistently.

**Status**: [ ] Not Fixed

---

### Issue 12: Missing URL validation

**Location**: `src/renderer/settings/components/skills/SkillInstallDialog.vue:260-276`

**Severity**: Low

**Description**: The URL input accepts any string without validation. Invalid URLs will fail at the fetch stage, but early validation would provide better UX.

```typescript
const installFromUrl = async () => {
  if (!installUrl.value || installing.value) return  // No URL format validation
  await tryInstallFromUrl(installUrl.value)
}
```

**Recommendation**: Add URL format validation:
```typescript
const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}
```

**Status**: [ ] Not Fixed

---

### Issue 13: SkillFolderTreeNode always starts expanded

**Location**: `src/renderer/settings/components/skills/SkillFolderTreeNode.vue:42`

**Severity**: Low

**Description**: All directory nodes default to `expanded = true`. For skills with many nested directories, this could create a very long tree that's hard to navigate.

```typescript
const expanded = ref(true)  // Always expanded by default
```

**Recommendation**: Consider:
1. Only expand the first level by default
2. Accept an `initialExpanded` prop based on depth
3. Collapse all by default and let users expand as needed

**Status**: [ ] Not Fixed

---

### Issue 14: Symlink handling could cause infinite recursion

**Location**: `src/main/presenter/skillPresenter/index.ts:564-587, 766-781`

**Severity**: Medium

**Description**: Both `buildFolderTree()` and `copyDirectory()` use `entry.isDirectory()` which returns `true` for symlinks pointing to directories. If a symlink points back up the tree, this could cause infinite recursion and stack overflow.

```typescript
private buildFolderTree(dirPath: string): SkillFolderNode[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {  // Returns true for symlinks to dirs
      nodes.push({
        children: this.buildFolderTree(fullPath)  // Could infinitely recurse
      })
    }
  }
}
```

**Recommendation**: Check `entry.isSymbolicLink()` and either skip symlinks or resolve them with cycle detection:
```typescript
if (entry.isDirectory() && !entry.isSymbolicLink()) {
  // Safe to recurse
}
```

**Status**: [ ] Not Fixed

---

### Issue 15: No concurrent access protection for caches

**Location**: `src/main/presenter/skillPresenter/index.ts:32-33, 704-718`

**Severity**: Medium

**Description**: The `metadataCache` and `contentCache` are standard Maps with no synchronization. The file watcher's `change`/`add`/`unlink` handlers can modify caches while other async methods are reading them, causing potential data inconsistency.

```typescript
// Watcher handler modifies cache
this.watcher.on('change', async (filePath: string) => {
  this.contentCache.delete(skillName)  // Could interleave with...
})

// ...concurrent reads
async loadSkillContent(name: string): Promise<SkillContent | null> {
  if (this.contentCache.has(name)) {
    return this.contentCache.get(name)!  // May have just been deleted
  }
}
```

**Recommendation**: Use a mutex pattern or queue cache operations to ensure atomic access.

**Status**: [ ] Not Fixed

---

### Issue 16: File watcher doesn't handle errors

**Location**: `src/main/presenter/skillPresenter/index.ts:690-750`

**Severity**: Low

**Description**: The chokidar watcher has no `error` event handler. If the watcher fails (e.g., file system issues, too many open files), the application silently continues without hot-reload capability.

```typescript
this.watcher = watch(this.skillsDir, { ... })
this.watcher.on('change', ...)
this.watcher.on('add', ...)
this.watcher.on('unlink', ...)
// Missing: this.watcher.on('error', ...)
```

**Recommendation**: Add error handling:
```typescript
this.watcher.on('error', (error) => {
  console.error('[SkillPresenter] File watcher error:', error)
  // Optionally attempt to restart watcher
})
```

**Status**: [ ] Not Fixed

---

### Issue 17: Large skill content could exhaust memory

**Location**: `src/main/presenter/skillPresenter/index.ts:198-214`

**Severity**: Low

**Description**: `loadSkillContent()` reads entire SKILL.md files with no size limit. A malicious or accidentally large skill file could impact memory.

```typescript
const rawContent = fs.readFileSync(metadata.path, 'utf-8')  // No size check
```

**Recommendation**: Add file size check before reading:
```typescript
const stats = fs.statSync(metadata.path)
const maxSize = 1024 * 1024 // 1MB
if (stats.size > maxSize) {
  throw new Error(`Skill file too large: ${stats.size} bytes`)
}
```

**Status**: [ ] Not Fixed

---

### Issue 18: ZIP extraction loads entire file into memory

**Location**: `src/main/presenter/skillPresenter/index.ts:414-465`

**Severity**: Low

**Description**: The `extractZipToDirectory()` function loads the entire ZIP file into memory using `fs.readFileSync()` and `unzipSync()`. For large ZIP files, this could exhaust memory.

```typescript
const zipContent = new Uint8Array(fs.readFileSync(zipPath))  // Entire file in memory
const extracted = unzipSync(zipContent)  // Doubles memory usage during extraction
```

**Recommendation**: Use streaming extraction or add file size check before loading:
```typescript
const stats = fs.statSync(zipPath)
const maxZipSize = 50 * 1024 * 1024 // 50MB
if (stats.size > maxZipSize) {
  throw new Error('ZIP file too large')
}
```

**Status**: [ ] Not Fixed

---

### Issue 19: Uninstall doesn't notify active sessions

**Location**: `src/main/presenter/skillPresenter/index.ts:499-521`

**Severity**: Low

**Description**: When a skill is uninstalled, it's removed from the cache and the directory is deleted. However, conversations that have the skill active retain the invalid reference until `getActiveSkills()` is called and validates. There's no proactive cleanup across all conversations.

**Recommendation**: Either:
1. Emit an event that UI components can listen to for cleanup
2. Add a method to clean up stale active skills across all conversations after uninstall
3. Document that active skills are lazily validated

**Status**: [ ] Not Fixed

---

### Issue 20: buildFolderTree doesn't handle permission errors

**Location**: `src/main/presenter/skillPresenter/index.ts:564-587`

**Severity**: Low

**Description**: `buildFolderTree()` uses `fs.readdirSync()` without try-catch. If a directory within a skill folder is not readable (permission denied), the entire operation will throw an unhandled exception.

```typescript
private buildFolderTree(dirPath: string): SkillFolderNode[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })  // Can throw EACCES
  // ...
}
```

**Recommendation**: Wrap in try-catch and return partial results:
```typescript
private buildFolderTree(dirPath: string): SkillFolderNode[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    // ...
  } catch (error) {
    console.warn(`[SkillPresenter] Cannot read directory: ${dirPath}`, error)
    return []
  }
}
```

**Status**: [ ] Not Fixed

---

### Issue 21: No Content-Type validation for URL downloads

**Location**: `src/main/presenter/skillPresenter/index.ts:487-494`

**Severity**: Low

**Description**: `downloadSkillZip()` doesn't validate the `Content-Type` header from the response. Users could accidentally paste a non-ZIP URL (HTML page, image, etc.) which would fail at extraction with an unclear error message.

```typescript
private async downloadSkillZip(url: string, destPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) { throw new Error(...) }
  // No Content-Type check - could be HTML, image, etc.
  const buffer = new Uint8Array(await response.arrayBuffer())
  fs.writeFileSync(destPath, Buffer.from(buffer))
}
```

**Recommendation**: Validate Content-Type header:
```typescript
const contentType = response.headers.get('content-type')
if (!contentType?.includes('application/zip') &&
    !contentType?.includes('application/octet-stream') &&
    !contentType?.includes('application/x-zip')) {
  throw new Error(`Expected ZIP file but got: ${contentType}`)
}
```

**Status**: [ ] Not Fixed

---

### Issue 22: Config path change doesn't trigger re-initialization

**Location**: `src/main/presenter/skillPresenter/index.ts:37-41`

**Severity**: Low

**Description**: `skillsDir` is resolved once at construction time. If the user changes the skills path in config, the change won't take effect until the application restarts. The file watcher also won't be updated to watch the new directory.

```typescript
constructor(private readonly configPresenter: IConfigPresenter) {
  this.skillsDir = this.resolveSkillsDir()  // Set once, never updated
  this.ensureSkillsDir()
}
```

**Recommendation**: Either:
1. Document that path changes require restart
2. Add a `refreshSkillsDir()` method that re-resolves the path and restarts the watcher
3. Subscribe to config change events and reinitialize

**Status**: [ ] Not Fixed

---

### Issue 23: No limit on number of active skills

**Location**: `src/main/presenter/skillPresenter/index.ts:622-655`

**Severity**: Low

**Description**: There's no limit on how many skills can be activated for a conversation. Since each active skill's full content is injected into the system prompt, activating many skills could exceed token limits or significantly degrade response quality/speed.

**Recommendation**: Add a maximum active skills limit:
```typescript
const MAX_ACTIVE_SKILLS = 10

async setActiveSkills(conversationId: string, skills: string[]): Promise<void> {
  if (skills.length > MAX_ACTIVE_SKILLS) {
    throw new Error(`Cannot activate more than ${MAX_ACTIVE_SKILLS} skills`)
  }
  // ...
}
```

**Status**: [ ] Not Fixed

---

### Issue 24: Manual frontmatter parsing in editor has edge cases

**Location**: `src/renderer/settings/components/skills/SkillEditorSheet.vue:157-176`

**Severity**: Low

**Description**: The `parseSkillContent()` function manually parses YAML frontmatter instead of using `gray-matter`. This can fail with edge cases like multiple `---` markers in content, YAML documents with `---` ending markers, or malformed frontmatter.

```typescript
const parseSkillContent = (content: string): { body: string } => {
  const lines = content.split('\n')
  let inFrontmatter = false
  // Manual parsing - fragile
  for (let i = 0; i < lines.length; i++) {
    if (line === '---') { ... }
  }
}
```

**Recommendation**: Import and use `gray-matter` consistently for both backend and frontend parsing, or use a shared utility function.

**Status**: [ ] Not Fixed

---

### Issue 25: pendingInstallAction holds closure reference

**Location**: `src/renderer/settings/components/skills/SkillInstallDialog.vue:185, 293`

**Severity**: Low

**Description**: When a conflict dialog is shown, `pendingInstallAction` stores a closure that captures the install path/URL. If the user closes the main dialog without resolving the conflict, this closure stays in memory until the next install operation.

```typescript
const pendingInstallAction = ref<(() => Promise<void>) | null>(null)
// ...
pendingInstallAction.value = retryWithOverwrite  // Holds closure with captured variables
// Only cleared in handleConflictCancel or handleConflictOverwrite
```

**Recommendation**: Clear `pendingInstallAction` when the main dialog is closed:
```typescript
watch(isOpen, (open) => {
  if (!open) {
    pendingInstallAction.value = null
    conflictDialogOpen.value = false
  }
})
```

**Status**: [ ] Not Fixed

---

### Issue 26: destroy() doesn't reset initialization flag

**Location**: `src/main/presenter/skillPresenter/index.ts:786-790`

**Severity**: Low

**Description**: The `destroy()` method clears caches and stops the watcher but doesn't reset `this.initialized`. If `initialize()` is called again after `destroy()`, it will return early without reinitializing.

```typescript
destroy(): void {
  this.stopWatching()
  this.metadataCache.clear()
  this.contentCache.clear()
  // Missing: this.initialized = false
}
```

**Recommendation**: Reset the initialization flag:
```typescript
destroy(): void {
  this.stopWatching()
  this.metadataCache.clear()
  this.contentCache.clear()
  this.initialized = false
}
```

**Status**: [ ] Not Fixed

---

## Suggestions (Non-Critical)

### Suggestion 1: Type assertion in skillsPromptBuilder

**Location**: `src/main/presenter/agentPresenter/message/skillsPromptBuilder.ts:21,58,90`

**Description**: Repeated type assertion `presenter.skillPresenter as SkillPresenter` is needed because presenter type is `ISkillPresenter`.

**Recommendation**: Update presenter definition to use concrete type or extend interface.

---

### Suggestion 2: Backup cleanup strategy

**Location**: `src/main/presenter/skillPresenter/index.ts:401-412`

**Description**: `backupExistingSkill()` creates backups with timestamps but never cleans them up. Could accumulate over time.

**Recommendation**: Consider:
- Limiting number of backups per skill (e.g., keep last 3)
- Adding a cleanup method
- Documenting backup location for users

---

### Suggestion 3: Structured logging

**Description**: Console logs use `[SkillPresenter]` prefix which is good, but consider using a structured logging utility for consistency with rest of codebase.

---

### Suggestion 4: Initialize state tracking

**Location**: `src/main/presenter/skillPresenter/index.ts:71-78`

**Description**: The `initialized` flag is boolean. Consider tracking initialization state more granularly (pending/complete/error).

---

## Test Coverage Gaps

The following scenarios lack test coverage:

1. URL download timeout/error scenarios
2. Symlink handling in folder tree and copyDirectory
3. Concurrent `getMetadataList()` calls (race condition)
4. Very deep directory structures
5. Large skill file handling
6. Invalid frontmatter edge cases (e.g., `allowedTools: "string"` instead of array)
7. File watcher error scenarios
8. Permission denied errors in buildFolderTree
9. Cache concurrent access patterns
10. Config path change at runtime
11. Large ZIP file extraction
12. Content-Type validation for URL downloads

---

## Summary

| Severity | Count |
|----------|-------|
| High     | 0     |
| Medium   | 7     |
| Low      | 19    |

**Total Issues**: 26

The Skills system implementation is solid overall with good security practices (ZIP path traversal protection) and proper separation of concerns. The most critical issues to address are:

### Priority 1 - Security/Stability
1. **Issue 8 (YAML injection)** - Could cause malformed skill files or inject unintended YAML fields
2. **Issue 14 (Symlink handling)** - Could cause infinite recursion and crash the application
3. **Issue 4 (URL download safety)** - Could hang application or exhaust memory

### Priority 2 - Data Integrity
4. **Issue 9 (Name change not handled)** - Could cause mismatch between directory and skill name
5. **Issue 15 (Cache concurrent access)** - Could cause data inconsistency during hot-reload
6. **Issue 1 (Race condition)** - Multiple discoveries could corrupt cache state

### Priority 3 - Robustness
7. **Issue 3 (Folder tree depth)** - Could cause stack overflow with deep structures
8. **Issue 17/18 (Memory limits)** - Large files could exhaust memory
9. **Issue 20 (Permission errors)** - Unhandled exceptions in folder tree

The remaining issues are primarily defensive programming improvements, UX enhancements, and minor memory/cleanup concerns rather than critical bugs.
