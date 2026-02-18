import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { UISession } from './session'

// --- Type Definitions ---

export interface UIProject {
  name: string
  path: string
}

// --- Store ---

export const useProjectStore = defineStore('project', () => {
  const devicePresenter = usePresenter('devicePresenter')

  // --- State ---
  const projects = ref<UIProject[]>([])
  const selectedProjectPath = ref<string | null>(null)
  const error = ref<string | null>(null)

  // --- Getters ---
  const selectedProject = computed(() =>
    projects.value.find((p) => p.path === selectedProjectPath.value)
  )
  const selectedProjectName = computed(() => selectedProject.value?.name ?? 'Select project')

  // --- Actions ---

  function deriveFromSessions(sessions: UISession[]): void {
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

  function selectProject(path: string): void {
    selectedProjectPath.value = path
  }

  async function openFolderPicker(): Promise<void> {
    try {
      const result = await devicePresenter.selectDirectory()
      if (result && !result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]
        const name = selectedPath.split('/').pop() ?? selectedPath
        // Add to list if not already present
        if (!projects.value.some((p) => p.path === selectedPath)) {
          projects.value.unshift({ name, path: selectedPath })
        }
        selectedProjectPath.value = selectedPath
      }
    } catch (e) {
      error.value = `Failed to open folder picker: ${e}`
    }
  }

  return {
    projects,
    selectedProjectPath,
    error,
    selectedProject,
    selectedProjectName,
    deriveFromSessions,
    selectProject,
    openFolderPicker
  }
})
