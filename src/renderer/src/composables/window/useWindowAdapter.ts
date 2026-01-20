import { usePresenter } from '@/composables/usePresenter'

export function useWindowAdapter() {
  const windowPresenter = usePresenter('windowPresenter')

  const previewFile = (filePath: string) => {
    return windowPresenter.previewFile(filePath)
  }

  const openSettingsTab = () => {
    const windowId = window.api.getWindowId()
    if (windowId != null) {
      windowPresenter.openOrFocusSettingsTab(windowId)
    }
  }

  return {
    previewFile,
    openSettingsTab
  }
}
