import { computed, ref, watch, type Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useWorkspaceAdapter } from '@/composables/workspace/useWorkspaceAdapter'
import type { WorkspaceFileNode } from '@shared/presenter'
import type { CategorizedData } from '../../editor/mention/suggestion'

export function useWorkspaceMention(options: {
  workspacePath: Ref<string | null>
  conversationId: Ref<string | null>
}) {
  const workspaceAdapter = useWorkspaceAdapter()
  const workspaceFileResults = ref<CategorizedData[]>([])

  const isEnabled = computed(() => {
    return !!options.workspacePath.value
  })

  const toDisplayPath = (filePath: string) => {
    const root = options.workspacePath.value
    if (!root) return filePath
    const trimmedRoot = root.replace(/[\\/]+$/, '')
    if (!filePath.startsWith(trimmedRoot)) return filePath
    const relative = filePath.slice(trimmedRoot.length).replace(/^[\\/]+/, '')
    return relative || filePath
  }

  const mapResults = (files: WorkspaceFileNode[]) =>
    files.map((file) => {
      const relativePath = toDisplayPath(file.path)
      return {
        id: file.path,
        label: relativePath || file.name,
        description: file.path,
        icon: file.isDirectory ? 'lucide:folder' : 'lucide:file',
        type: 'item' as const,
        category: 'workspace' as const
      }
    })

  const clearResults = () => {
    workspaceFileResults.value = []
  }

  const searchWorkspaceFiles = useDebounceFn(async (query: string) => {
    // Allow empty query to show some files when user just types "@"
    // Empty query means show a limited list of files
    if (!isEnabled.value || !options.workspacePath.value) {
      clearResults()
      return
    }

    const trimmed = query.trim()
    // If query is empty, use "**/*" to show some files (limited by searchFiles)
    // This is a standard glob pattern to match all files
    const searchQuery = trimmed || '**/*'

    try {
      await workspaceAdapter.registerWorkspace(options.workspacePath.value)
      const results =
        (await workspaceAdapter.searchFiles(options.workspacePath.value, searchQuery)) ?? []
      workspaceFileResults.value = mapResults(results)
    } catch (error) {
      console.error('[WorkspaceMention] Failed to search workspace files:', error)
      clearResults()
    }
  }, 300)

  watch(isEnabled, (enabled) => {
    if (!enabled) {
      clearResults()
    }
  })

  watch(
    () => options.workspacePath.value,
    () => {
      clearResults()
    }
  )

  watch(
    () => options.conversationId.value,
    () => {
      clearResults()
    }
  )

  return {
    searchWorkspaceFiles,
    workspaceFileResults,
    isEnabled
  }
}
