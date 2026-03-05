# Project Store Spec

## Overview

Project Store manages the recent projects list for the NewThread page project selector dropdown. Kept intentionally simple.

## File Location

`src/renderer/src/stores/ui/project.ts`

## Type Definitions

```typescript
interface UIProject {
  name: string        // Folder name (last segment of path)
  path: string        // Full path
}
```

## Store Design

```typescript
export const useProjectStore = defineStore('project', () => {
  const filePresenter = usePresenter('filePresenter')

  // --- State ---
  const projects = ref<UIProject[]>([])
  const selectedProjectPath = ref<string | null>(null)
  const error = ref<string | null>(null)

  // --- Getters ---
  const selectedProject = computed(() =>
    projects.value.find(p => p.path === selectedProjectPath.value)
  )
  const selectedProjectName = computed(() =>
    selectedProject.value?.name ?? 'Select project'
  )

  // --- Actions ---
  function deriveFromSessions(sessions: UISession[]): void
  function selectProject(path: string): void
  async function openFolderPicker(): Promise<void>

  return {
    projects, selectedProjectPath, error,
    selectedProject, selectedProjectName,
    deriveFromSessions, selectProject, openFolderPicker
  }
})
```

## Actions

### `deriveFromSessions(sessions: UISession[]): void`

Extract unique project directories from the session list. Called by the Session Store after fetching sessions.

```typescript
function deriveFromSessions(sessions: UISession[]) {
  const seen = new Map<string, UIProject>()
  for (const s of sessions) {
    if (s.projectDir && !seen.has(s.projectDir)) {
      seen.set(s.projectDir, {
        name: s.projectDir.split('/').pop() ?? s.projectDir,
        path: s.projectDir
      })
    }
  }
  projects.value = Array.from(seen.values())

  // Auto-select first project if nothing selected
  if (!selectedProjectPath.value && projects.value.length > 0) {
    selectedProjectPath.value = projects.value[0].path
  }
}
```

### `selectProject(path: string): void`

```typescript
function selectProject(path: string) {
  selectedProjectPath.value = path
}
```

### `openFolderPicker(): Promise<void>`

Open native folder picker dialog to add a custom project.

```typescript
async function openFolderPicker() {
  try {
    const result = await filePresenter.selectDirectory()
    if (result) {
      const name = result.split('/').pop() ?? result
      // Add to list if not already present
      if (!projects.value.some(p => p.path === result)) {
        projects.value.unshift({ name, path: result })
      }
      selectedProjectPath.value = result
    }
  } catch (e) {
    error.value = `Failed to open folder picker: ${e}`
  }
}
```

## IPC Call Mapping

| Action | Presenter Call |
|--------|---------------|
| Open folder picker | `filePresenter.selectDirectory()` |

## Data Flow

```
sessionStore.fetchSessions()
  └── projectStore.deriveFromSessions(sessions)
        └── projects list updated
              └── NewThreadPage project dropdown reflects changes
```

## Test Points

1. `deriveFromSessions` extracts unique projects from sessions
2. `deriveFromSessions` auto-selects first project when none selected
3. `selectProject` updates selectedProjectPath
4. `openFolderPicker` adds new project and selects it
5. Duplicate paths are not added
