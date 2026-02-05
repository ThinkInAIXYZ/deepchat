import { usePresenter } from '@/composables/usePresenter'

export function useFileAdapter() {
  const filePresenter = usePresenter('filePresenter')

  const getPathForFile = (file: File) => window.api.getPathForFile(file)

  return {
    getPathForFile,
    getMimeType: filePresenter.getMimeType,
    prepareFile: filePresenter.prepareFile,
    prepareDirectory: filePresenter.prepareDirectory,
    readFile: filePresenter.readFile,
    isDirectory: filePresenter.isDirectory,
    writeImageBase64: filePresenter.writeImageBase64,
    writeTemp: filePresenter.writeTemp
  }
}
