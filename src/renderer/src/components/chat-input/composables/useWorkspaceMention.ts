import { computed, ref, watch, type Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { usePresenter } from '@/composables/usePresenter'
import type { WorkspaceFileNode } from '@shared/presenter'
import type { CategorizedData } from '../../editor/mention/suggestion'

export function useWorkspaceMention(options: {
  workspacePath: Ref<string | null>
  chatMode: Ref<'agent' | 'acp agent'>
  conversationId: Ref<string | null>
}) {
  const workspacePresenter = usePresenter('workspacePresenter')
  const workspaceFileResults = ref<CategorizedData[]>([])
  const isRegistered = ref(false)
  const registeredPath = ref<string | null>(null)

  const isEnabled = computed(() => {
    const hasPath = !!options.workspacePath.value
    return hasPath
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

  const ensureWorkspaceRegistered = async () => {
    const path = options.workspacePath.value
    if (!path) return false

    if (isRegistered.value && registeredPath.value === path) {
      return true
    }

    try {
      if (options.chatMode.value === 'acp agent') {
        await workspacePresenter.registerWorkdir(path)
      } else {
        await workspacePresenter.registerWorkspace(path)
      }
      isRegistered.value = true
      registeredPath.value = path
      return true
    } catch (error) {
      console.error('[WorkspaceMention] Failed to register workspace:', error)
      return false
    }
  }

  const searchWorkspaceFiles = useDebounceFn(async (query: string) => {
    if (!isEnabled.value || !options.workspacePath.value) {
      clearResults()
      return
    }

    try {
      const registered = await ensureWorkspaceRegistered()
      if (!registered) {
        clearResults()
        return
      }

      const trimmed = query.trim()
      const searchQuery = trimmed || '**/*'

      const results =
        (await workspacePresenter.searchFiles(options.workspacePath.value, searchQuery)) ?? []
      workspaceFileResults.value = mapResults(results)
    } catch (error) {
      console.warn('[WorkspaceMention] Search failed, falling back to empty results:', error)
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
    (newPath) => {
      if (newPath !== registeredPath.value) {
        isRegistered.value = false
        registeredPath.value = null
      }
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
