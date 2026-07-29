import { createFileClient } from '@api/FileClient'
import { useI18n } from 'vue-i18n'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

export type ImageActionSource = {
  source: string
  mimeType?: string
  suggestedName?: string
}

export function useImageActions() {
  const { t } = useI18n()
  const fileClient = createFileClient()

  const saveImage = async (image: ImageActionSource) => {
    try {
      const result = await fileClient.saveImage(image)
      if (result.canceled) {
        return
      }

      notifyRenderer({
        kind: 'success',
        code: 'image.saved',
        title: t('image.saveSuccess'),
        description: result.path
      })
    } catch (error) {
      console.error('Failed to save image:', error)
      notifyRenderer({
        kind: 'error',
        code: 'image.saveFailed',
        title: t('image.saveFailed')
      })
    }
  }

  const copyImage = async (image: ImageActionSource) => {
    try {
      const result = await fileClient.copyImage(image)
      if (!result.copied) {
        throw new Error('Image was not copied')
      }

      notifyRenderer({
        kind: 'success',
        code: 'image.copied',
        title: t('common.copyImageSuccess'),
        description: t('common.copyImageSuccessDesc')
      })
    } catch (error) {
      console.error('Failed to copy image:', error)
      notifyRenderer({
        kind: 'error',
        code: 'image.copyFailed',
        title: t('common.copyFailed'),
        description: t('common.copyFailedDesc')
      })
    }
  }

  return {
    saveImage,
    copyImage
  }
}
