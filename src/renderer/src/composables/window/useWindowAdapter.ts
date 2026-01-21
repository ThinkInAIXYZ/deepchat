import { usePresenter } from '@/composables/usePresenter'

export function useWindowAdapter() {
  const windowPresenter = usePresenter('windowPresenter')

  const previewFile = (filePath: string) => {
    return windowPresenter.previewFile(filePath)
  }

  const openSettingsWindow = () => {
    windowPresenter.openOrFocusSettingsWindow()
  }

  return {
    previewFile,
    openSettingsWindow
  }
}
