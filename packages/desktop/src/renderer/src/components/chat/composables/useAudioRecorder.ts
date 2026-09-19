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
  const discardedRecorders = new WeakSet<MediaRecorder>()

  const stopTracks = (stream: MediaStream | null = mediaStream) => {
    stream?.getTracks().forEach((track) => track.stop())
    if (!stream || mediaStream === stream) {
      mediaStream = null
    }
  }

  const cleanupRecorder = (
    recorder: MediaRecorder | null = mediaRecorder,
    stream: MediaStream | null = mediaStream,
    options?: { discardRecording?: boolean }
  ) => {
    if (options?.discardRecording && recorder) {
      discardedRecorders.add(recorder)
    }
    if (!recorder || mediaRecorder === recorder) {
      mediaRecorder = null
      isRecording.value = false
    }
    stopTracks(stream)
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
      const stream = await recorderWindow!.navigator!.mediaDevices!.getUserMedia({ audio: true })
      mediaStream = stream
      const preferredMimeType = resolvePreferredRecorderMimeType(recorderWindow)
      const recorder = preferredMimeType
        ? new recorderWindow!.MediaRecorder!(stream, { mimeType: preferredMimeType })
        : new recorderWindow!.MediaRecorder!(stream)
      mediaRecorder = recorder
      const chunks: BlobPart[] = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      recorder.onerror = () => {
        options.onError?.('recording-error')
        cleanupRecorder(recorder, stream, { discardRecording: true })
      }

      recorder.onstop = () => {
        const shouldEmitRecorded = !discardedRecorders.has(recorder)
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type: mimeType })
        cleanupRecorder(recorder, stream)

        if (shouldEmitRecorded && blob.size > 0) {
          options.onRecorded({ blob, mimeType })
        }
      }

      recorder.start()
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
    const recorder = mediaRecorder
    const stream = mediaStream
    if (recorder && recorder.state !== 'inactive') {
      discardedRecorders.add(recorder)
      recorder.stop()
    }
    cleanupRecorder(recorder, stream, { discardRecording: true })
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
