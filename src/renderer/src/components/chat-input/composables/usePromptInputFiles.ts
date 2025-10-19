// === Vue Core ===
import { ref, type Ref } from 'vue'

// === Types ===
import type { MessageFile } from '@shared/chat'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'

// === Utils ===
import { calculateImageTokens, getClipboardImageInfo, imageFileToBase64 } from '@/lib/image'
import { approximateTokenSize } from 'tokenx'

/**
 * File item interface for prompt files
 */
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

/**
 * Composable for managing file operations in prompt input
 * Handles file selection, paste, drag-drop, and prompt files integration
 */
export function usePromptInputFiles(
  fileInput: Ref<HTMLInputElement | undefined>,
  emit: (event: 'file-upload', files: MessageFile[]) => void,
  t: (key: string, params?: any) => string
) {
  // === Presenters ===
  const filePresenter = usePresenter('filePresenter')

  // === Utils ===
  const { toast } = useToast()

  // === Local State ===
  const selectedFiles = ref<MessageFile[]>([])

  // === Internal Helper Functions ===
  /**
   * Process a single file and convert to MessageFile
   */
  const processFile = async (file: File, isImage: boolean = false): Promise<MessageFile | null> => {
    try {
      if (isImage || file.type.startsWith('image/')) {
        // Handle image files
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
      } else {
        // Handle other file types
        const path = window.api.getPathForFile(file)
        const mimeType = await filePresenter.getMimeType(path)
        return await filePresenter.prepareFile(path, mimeType)
      }
    } catch (error) {
      console.error('File processing failed:', error)
      return null
    }
  }

  /**
   * Process dropped file (may be directory)
   */
  const processDroppedFile = async (file: File): Promise<MessageFile | null> => {
    try {
      const path = window.api.getPathForFile(file)

      // Handle empty type (possibly directory)
      if (file.type === '') {
        const isDirectory = await filePresenter.isDirectory(path)
        if (isDirectory) {
          return await filePresenter.prepareDirectory(path)
        }
      }

      // Handle regular files
      const mimeType = await filePresenter.getMimeType(path)
      return await filePresenter.prepareFile(path, mimeType)
    } catch (error) {
      console.error('Dropped file processing failed:', error)
      return null
    }
  }

  // === Public Methods ===
  /**
   * Handle file selection from file input
   */
  const handleFileSelect = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files

    if (files && files.length > 0) {
      for (const file of files) {
        const fileInfo = await processFile(file)
        if (fileInfo) {
          selectedFiles.value.push(fileInfo)
        } else {
          console.error('File info is null:', file.name)
        }
      }

      if (selectedFiles.value.length > 0) {
        emit('file-upload', selectedFiles.value)
      }
    }

    // Reset the input
    if (e.target) {
      ;(e.target as HTMLInputElement).value = ''
    }
  }

  /**
   * Handle paste event with files
   */
  const handlePaste = async (e: ClipboardEvent, fromCapture = false) => {
    // Avoid double-processing only for bubble-phase handler
    if (!fromCapture && (e as any)?._deepchatHandled) return

    const files = e.clipboardData?.files
    if (files && files.length > 0) {
      for (const file of files) {
        const fileInfo = await processFile(file, file.type.startsWith('image/'))
        if (fileInfo) {
          selectedFiles.value.push(fileInfo)
        }
      }

      if (selectedFiles.value.length > 0) {
        emit('file-upload', selectedFiles.value)
      }
    }
  }

  /**
   * Handle drop event with files
   */
  const handleDrop = async (files: FileList) => {
    for (const file of files) {
      const fileInfo = await processDroppedFile(file)
      if (fileInfo) {
        selectedFiles.value.push(fileInfo)
      }
    }

    if (selectedFiles.value.length > 0) {
      emit('file-upload', selectedFiles.value)
    }
  }

  /**
   * Delete a file from the list
   */
  const deleteFile = (idx: number) => {
    selectedFiles.value.splice(idx, 1)
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  }

  /**
   * Clear all selected files
   */
  const clearFiles = () => {
    selectedFiles.value = []
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  }

  /**
   * Handle files from Prompt mention
   */
  const handlePromptFiles = async (files: PromptFileItem[]) => {
    if (!files || files.length === 0) return

    let addedCount = 0
    let errorCount = 0

    for (const fileItem of files) {
      try {
        // Check if file already exists (deduplicate by name)
        const exists = selectedFiles.value.some((f) => f.name === fileItem.name)
        if (exists) {
          continue
        }

        // Convert PromptFileItem -> MessageFile
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

        // If no content but has path, try to read file
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

    // Show feedback
    if (addedCount > 0) {
      toast({
        title: t('chat.input.promptFilesAdded'),
        description: t('chat.input.promptFilesAddedDesc', { count: addedCount }),
        variant: 'default'
      })
      emit('file-upload', selectedFiles.value)
    }

    if (errorCount > 0) {
      toast({
        title: t('chat.input.promptFilesError'),
        description: t('chat.input.promptFilesErrorDesc', { count: errorCount }),
        variant: 'destructive'
      })
    }
  }

  /**
   * Open file picker dialog
   */
  const openFilePicker = () => {
    fileInput.value?.click()
  }

  // === Return Public API ===
  return {
    // State
    selectedFiles,

    // Methods
    handleFileSelect,
    handlePaste,
    handleDrop,
    deleteFile,
    clearFiles,
    handlePromptFiles,
    openFilePicker
  }
}
