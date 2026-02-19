import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { Project } from '@shared/types/agent-interface'

// --- Type Definitions ---

export interface UIProject {
  name: string
  path: string
  icon: string | null
}

// --- Store ---

export const useProjectStore = defineStore('project', () => {
  const projectPresenter = usePresenter('projectPresenter')

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

  async function fetchProjects(): Promise<void> {
    try {
      const result: Project[] = await projectPresenter.getRecentProjects(20)
      projects.value = result.map((p) => ({
        name: p.name,
        path: p.path,
        icon: p.icon
      }))
    } catch (e) {
      error.value = `Failed to load projects: ${e}`
    }
  }

  function selectProject(path: string | null): void {
    selectedProjectPath.value = path
  }

  async function openFolderPicker(): Promise<void> {
    try {
      const selectedPath = await projectPresenter.selectDirectory()
      if (selectedPath) {
        const name = selectedPath.split('/').pop() ?? selectedPath
        if (!projects.value.some((p) => p.path === selectedPath)) {
          projects.value.unshift({ name, path: selectedPath, icon: null })
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
    fetchProjects,
    selectProject,
    openFolderPicker
  }
})
