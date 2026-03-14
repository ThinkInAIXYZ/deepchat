import { ref, type Ref } from 'vue'
import type { MessageFile } from '@shared/types/agent-interface'
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import { calculateImageTokens, getClipboardImageInfo, imageFileToBase64 } from '@/lib/image'
import { approximateTokenSize } from 'tokenx'

export interface PromptFileItem {
  id: string
  name: string
  type: string
  size: number
  path: string
  description?: string
  content?: string
  createdAt: number
}

export function useChatInputFiles(
  fileInput: Ref<HTMLInputElement | undefined>,
  emit: (event: 'file-upload', files: MessageFile[]) => void,
  t: (key: string, params?: any) => string
) {
  const filePresenter = usePresenter('filePresenter')
  const { toast } = useToast()
  const selectedFiles = ref<MessageFile[]>([])

  const processFile = async (file: File, isImage: boolean = false): Promise<MessageFile | null> => {
    try {
      if (isImage || file.type.startsWith('image/')) {
        const base64 = (await imageFileToBase64(file)) as string
        const imageInfo = await getClipboardImageInfo(file)

        const tempFilePath = await filePresenter.writeImageBase64({
          name: file.name ?? 'image',
          content: base64
        })

        return {
          name: file.name ?? 'image',
          content: base64,
          mimeType: file.type,
          metadata: {
            fileName: file.name ?? 'image',
            fileSize: file.size,
            fileDescription: file.type,
            fileCreated: new Date(),
            fileModified: new Date()
          },
          token: calculateImageTokens(imageInfo.width, imageInfo.height),
          path: tempFilePath,
          thumbnail: imageInfo.compressedBase64
        }
      }

      const path = window.api.getPathForFile(file)
      const mimeType = await filePresenter.getMimeType(path)
      return await filePresenter.prepareFile(path, mimeType)
    } catch (error) {
      console.error('File processing failed:', error)
      return null
    }
  }

  const processDroppedFile = async (file: File): Promise<MessageFile | null> => {
    try {
      const path = window.api.getPathForFile(file)

      if (file.type === '') {
        const isDirectory = await filePresenter.isDirectory(path)
        if (isDirectory) {
          return await filePresenter.prepareDirectory(path)
        }
      }

      const mimeType = await filePresenter.getMimeType(path)
      return await filePresenter.prepareFile(path, mimeType)
    } catch (error) {
      console.error('Dropped file processing failed:', error)
      return null
    }
  }

  const emitFiles = () => emit('file-upload', selectedFiles.value)

  const handleFileSelect = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files

    if (files && files.length > 0) {
      for (const file of files) {
        const fileInfo = await processFile(file)
        if (fileInfo) {
          selectedFiles.value.push(fileInfo)
        }
      }

      if (selectedFiles.value.length > 0) {
        emitFiles()
      }
    }

    if (e.target) {
      ;(e.target as HTMLInputElement).value = ''
    }
  }

  const handlePaste = async (e: ClipboardEvent, fromCapture = false) => {
    if (!fromCapture && (e as any)?._deepchatHandled) return
    ;(e as any)._deepchatHandled = true

    const files = e.clipboardData?.files
    if (files && files.length > 0) {
      for (const file of files) {
        const fileInfo = await processFile(file, file.type.startsWith('image/'))
        if (fileInfo) {
          selectedFiles.value.push(fileInfo)
        }
      }

      if (selectedFiles.value.length > 0) {
        emitFiles()
      }
    }
  }

  const handleDrop = async (files: FileList) => {
    for (const file of files) {
      const fileInfo = await processDroppedFile(file)
      if (fileInfo) {
        selectedFiles.value.push(fileInfo)
      }
    }

    if (selectedFiles.value.length > 0) {
      emitFiles()
    }
  }

  const deleteFile = (idx: number) => {
    selectedFiles.value.splice(idx, 1)
    emitFiles()
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  }

  const clearFiles = () => {
    selectedFiles.value = []
    emitFiles()
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  }

  const handlePromptFiles = async (files: PromptFileItem[]) => {
    if (!files || files.length === 0) return

    let addedCount = 0
    let errorCount = 0

    for (const fileItem of files) {
      try {
        const exists = selectedFiles.value.some((f) => f.name === fileItem.name)
        if (exists) {
          continue
        }

        const messageFile: MessageFile = {
          name: fileItem.name,
          content: fileItem.content || '',
          mimeType: fileItem.type || 'application/octet-stream',
          metadata: {
            fileName: fileItem.name,
            fileSize: fileItem.size || 0,
            fileDescription: fileItem.description || '',
            fileCreated: new Date(fileItem.createdAt || Date.now()),
            fileModified: new Date(fileItem.createdAt || Date.now())
          },
          token: approximateTokenSize(fileItem.content || ''),
          path: fileItem.path || fileItem.name
        }

        if (!messageFile.content && fileItem.path) {
          try {
            const fileContent = await filePresenter.readFile(fileItem.path)
            messageFile.content = fileContent
            messageFile.token = approximateTokenSize(fileContent)
          } catch (error) {
            console.warn(`Failed to read file content: ${fileItem.path}`, error)
          }
        }

        selectedFiles.value.push(messageFile)
        addedCount++
      } catch (error) {
        console.error('Failed to process prompt file:', fileItem, error)
        errorCount++
      }
    }

    if (addedCount > 0) {
      toast({
        title: t('chat.input.promptFilesAdded'),
        description: t('chat.input.promptFilesAddedDesc', { count: addedCount }),
        variant: 'default'
      })
      emitFiles()
    }

    if (errorCount > 0) {
      toast({
        title: t('chat.input.promptFilesError'),
        description: t('chat.input.promptFilesErrorDesc', { count: errorCount }),
        variant: 'destructive'
      })
    }
  }

  const openFilePicker = () => {
    fileInput.value?.click()
  }

  return {
    selectedFiles,
    handleFileSelect,
    handlePaste,
    handleDrop,
    deleteFile,
    clearFiles,
    handlePromptFiles,
    openFilePicker
  }
}
