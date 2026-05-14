import type { MessageFile } from '@shared/types/agent-interface'

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
