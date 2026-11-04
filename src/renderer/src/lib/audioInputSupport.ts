import type { MessageFile } from '@shared/types/agent-interface'
import type { CapabilitySnapshotQuery } from '@shared/types/model-capabilities'
import type { useModelStore } from '@/stores/modelStore'
import type { RendererNotificationNotifier } from '@renderer-notifications/rendererNotificationPort'

export async function prepareFilesForModel(
  files: MessageFile[],
  selection: { providerId: string; modelId: string } | null,
  options: {
    modelClient: {
      getCapabilities(query: CapabilitySnapshotQuery): Promise<{ supportsAudioInput: boolean }>
    }
    modelStore: Pick<ReturnType<typeof useModelStore>, 'findChatSelectableModel'>
    notify: RendererNotificationNotifier
    t: (key: string, params?: Record<string, unknown>) => string
  }
): Promise<MessageFile[]> {
  if (!selection || files.length === 0) return files
  try {
    const capabilities = await options.modelClient.getCapabilities(selection)
    if (capabilities.supportsAudioInput) return files
    const { acceptedFiles, rejectedAudioFiles } = filterUnsupportedAudioAttachments(files, false)
    if (rejectedAudioFiles.length > 0) {
      const modelLabel =
        options.modelStore.findChatSelectableModel(selection.providerId, selection.modelId)?.model
          .name ?? selection.modelId
      options.notify({
        kind: 'warning',
        code: 'chat.audio.unsupported',
        title: options.t('chat.input.audioInputUnsupportedTitle'),
        description: options.t('chat.input.audioInputUnsupportedDescription', {
          count: rejectedAudioFiles.length,
          model: modelLabel
        })
      })
    }
    return acceptedFiles
  } catch (error) {
    console.warn('[Composer] Failed to resolve audio input capability:', error)
    return files
  }
}

const AUDIO_FILE_EXTENSIONS = ['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.webm']

function hasAudioExtension(value: string | undefined): boolean {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return AUDIO_FILE_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

export function isAudioAttachment(file: MessageFile): boolean {
  if (typeof file.mimeType === 'string' && file.mimeType.toLowerCase().startsWith('audio/')) {
    return true
  }

  return hasAudioExtension(file.name) || hasAudioExtension(file.path)
}

export function filterUnsupportedAudioAttachments(
  files: MessageFile[],
  supportsAudioInput: boolean
): {
  acceptedFiles: MessageFile[]
  rejectedAudioFiles: MessageFile[]
} {
  if (supportsAudioInput) {
    return {
      acceptedFiles: [...files],
      rejectedAudioFiles: []
    }
  }

  const acceptedFiles: MessageFile[] = []
  const rejectedAudioFiles: MessageFile[] = []

  for (const file of files) {
    if (isAudioAttachment(file)) {
      rejectedAudioFiles.push(file)
      continue
    }

    acceptedFiles.push(file)
  }

  return {
    acceptedFiles,
    rejectedAudioFiles
  }
}
