import { ref } from 'vue'

export type RecorderWindow = {
  MediaRecorder?: typeof MediaRecorder
  navigator?: Navigator
}

function getDefaultRecorderWindow(): RecorderWindow | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window as unknown as RecorderWindow
}

export function isMediaRecorderSupported(recorderWindow: RecorderWindow | undefined): boolean {
  return (
    typeof recorderWindow?.MediaRecorder !== 'undefined' &&
    typeof recorderWindow?.navigator?.mediaDevices?.getUserMedia === 'function'
  )
}

function resolvePreferredRecorderMimeType(
  recorderWindow: RecorderWindow | undefined
): string | null {
  const MediaRecorderCtor = recorderWindow?.MediaRecorder
  if (!MediaRecorderCtor?.isTypeSupported) {
    return null
  }

  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((candidate) => MediaRecorderCtor.isTypeSupported(candidate)) ?? null
}

export function useAudioRecorder(options: {
  onRecorded: (payload: { blob: Blob; mimeType: string }) => void
  onUnsupported?: () => void
  onError?: (code: string) => void
  recorderWindow?: RecorderWindow
}) {
  const recorderWindow = options.recorderWindow ?? getDefaultRecorderWindow()
  const isSupported = isMediaRecorderSupported(recorderWindow)
  const isRecording = ref(false)

  let mediaRecorder: MediaRecorder | null = null
  let mediaStream: MediaStream | null = null

  const stopTracks = () => {
    mediaStream?.getTracks().forEach((track) => track.stop())
    mediaStream = null
  }

  const cleanupRecorder = () => {
    mediaRecorder = null
    isRecording.value = false
    stopTracks()
  }

  const start = async (): Promise<boolean> => {
    if (!isSupported) {
      options.onUnsupported?.()
      return false
    }

    if (isRecording.value) {
      return true
    }

    try {
      mediaStream = await recorderWindow!.navigator!.mediaDevices!.getUserMedia({ audio: true })
      const preferredMimeType = resolvePreferredRecorderMimeType(recorderWindow)
      mediaRecorder = preferredMimeType
        ? new recorderWindow!.MediaRecorder!(mediaStream, { mimeType: preferredMimeType })
        : new recorderWindow!.MediaRecorder!(mediaStream)
      const chunks: BlobPart[] = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      mediaRecorder.onerror = () => {
        options.onError?.('recording-error')
        cleanupRecorder()
      }

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder?.mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type: mimeType })
        cleanupRecorder()

        if (blob.size > 0) {
          options.onRecorded({ blob, mimeType })
        }
      }

      mediaRecorder.start()
      isRecording.value = true
      return true
    } catch (error) {
      const code =
        error instanceof Error
          ? error.name
          : typeof error === 'object' && error && 'name' in error && typeof error.name === 'string'
            ? error.name
            : 'recording-start-failed'
      options.onError?.(code)
      cleanupRecorder()
      return false
    }
  }

  const stop = () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      cleanupRecorder()
      return
    }

    mediaRecorder.stop()
  }

  const toggle = async () => {
    if (isRecording.value) {
      stop()
      return false
    }

    return start()
  }

  const cleanup = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }
    cleanupRecorder()
  }

  return {
    isSupported,
    isRecording,
    start,
    stop,
    toggle,
    cleanup
  }
}
