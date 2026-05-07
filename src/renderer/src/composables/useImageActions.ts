import { createFileClient } from '@api/FileClient'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/components/use-toast'

export type ImageActionSource = {
  source: string
  mimeType?: string
  suggestedName?: string
}

export function useImageActions() {
  const { t } = useI18n()
  const { toast } = useToast()
  const fileClient = createFileClient()

  const saveImage = async (image: ImageActionSource) => {
    try {
      const result = await fileClient.saveImage(image)
      if (result.canceled) {
        return
      }

      toast({
        title: t('image.saveSuccess'),
        description: result.path
      })
    } catch (error) {
      console.error('Failed to save image:', error)
      toast({
        title: t('image.saveFailed'),
        variant: 'destructive'
      })
    }
  }

  const copyImage = async (image: ImageActionSource) => {
    try {
      const result = await fileClient.copyImage(image)
      if (!result.copied) {
        throw new Error('Image was not copied')
      }

      toast({
        title: t('common.copyImageSuccess'),
        description: t('common.copyImageSuccessDesc')
      })
    } catch (error) {
      console.error('Failed to copy image:', error)
      toast({
        title: t('common.copyFailed'),
        description: t('common.copyFailedDesc'),
        variant: 'destructive'
      })
    }
  }

  return {
    saveImage,
    copyImage
  }
}
