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
2. Symlink handling in folder tree
3. Concurrent `getMetadataList()` calls (race condition)
4. Very deep directory structures
5. Large skill file handling
6. Invalid frontmatter edge cases (e.g., `allowedTools: "string"` instead of array)

---

## Summary

| Severity | Count |
|----------|-------|
| High     | 0     |
| Medium   | 5     |
| Low      | 8     |

**Total Issues**: 13

The Skills system implementation is solid overall with good security practices (ZIP path traversal protection) and proper separation of concerns. The most critical issues to address are:

1. **Issue 8 (YAML injection)** - Could cause malformed skill files
2. **Issue 9 (Name change not handled)** - Could cause mismatch between directory and skill name
3. **Issue 4 (URL download safety)** - Could hang application or exhaust memory

The remaining issues are primarily defensive programming improvements and UX enhancements rather than critical bugs.
