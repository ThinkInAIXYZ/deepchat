import { usePresenter } from '@/composables/usePresenter'

export function useWorkspaceAdapter() {
  const workspacePresenter = usePresenter('workspacePresenter')

  return {
    registerWorkspace: workspacePresenter.registerWorkspace,
    registerWorkdir: workspacePresenter.registerWorkdir,
    searchFiles: workspacePresenter.searchFiles
  }
}
