import { computed, ref } from 'vue'
import { isMediaRecorderSupported, useAudioRecorder, type RecorderWindow } from './useAudioRecorder'

export type SpeechRecognitionErrorCode =
  | 'aborted'
  | 'audio-capture'
  | 'not-allowed'
  | 'transcription-failed'
  | 'transcription-timeout'
  | 'decode-failed'
  | string

export type SpeechRecognitionAudioPayload = {
  audioBase64: string
  mimeType: string
  filename: string
}

type AudioBufferLike = {
  numberOfChannels: number
  length: number
  sampleRate: number
  getChannelData: (channel: number) => Float32Array
}

type AudioContextLike = {
  decodeAudioData: (audioData: ArrayBuffer) => Promise<AudioBufferLike>
  close: () => Promise<void>
}

type AudioContextConstructor = new () => AudioContextLike

type SpeechRecognitionWindow = RecorderWindow & {
  AudioContext?: AudioContextConstructor
  webkitAudioContext?: AudioContextConstructor
}

const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 45000

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function createTranscriptionTimeoutError(): Error {
  return new Error('transcription-timeout')
}

export function resolveAudioContextConstructor(
  speechWindow: SpeechRecognitionWindow | undefined
): AudioContextConstructor | null {
  if (!speechWindow) {
    return null
  }

  return speechWindow.AudioContext ?? speechWindow.webkitAudioContext ?? null
}

export function isSpeechRecognitionSupported(
  speechWindow: SpeechRecognitionWindow | undefined
): boolean {
  return (
    isMediaRecorderSupported(speechWindow) && resolveAudioContextConstructor(speechWindow) !== null
  )
}

function getDefaultSpeechWindow(): SpeechRecognitionWindow | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window as unknown as SpeechRecognitionWindow
}

function normalizeRecorderErrorCode(code: string): SpeechRecognitionErrorCode {
  switch (code.toLowerCase()) {
    case 'notallowederror':
    case 'permissiondeniederror':
      return 'not-allowed'
    case 'notfounderror':
    case 'notreadableerror':
    case 'overconstrainederror':
    case 'securityerror':
      return 'audio-capture'
    default:
      return code
  }
}

function normalizeTranscriptionErrorCode(error: unknown): SpeechRecognitionErrorCode {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'aborted'
    }

    switch (error.message) {
      case 'decode-failed':
      case 'decode-unsupported':
      case 'base64-unsupported':
        return 'decode-failed'
      case 'transcription-timeout':
        return 'transcription-timeout'
      default:
        return 'transcription-failed'
    }
  }

  return 'transcription-failed'
}

function encodePcm16Sample(value: number): number {
  const normalized = Math.max(-1, Math.min(1, value))
  return normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff
}

function mixDownToMono(audioBuffer: AudioBufferLike): Float32Array {
  const mono = new Float32Array(audioBuffer.length)
  const channelCount = Math.max(1, audioBuffer.numberOfChannels)

  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel)
    for (let index = 0; index < audioBuffer.length; index += 1) {
      mono[index] += channelData[index] ?? 0
    }
  }

  for (let index = 0; index < mono.length; index += 1) {
    mono[index] /= channelCount
  }

  return mono
}

export function encodeAudioBufferAsWav(audioBuffer: AudioBufferLike): Blob {
  const mono = mixDownToMono(audioBuffer)
  const bytesPerSample = 2
  const dataLength = mono.length * bytesPerSample
  const wavBuffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(wavBuffer)
  let offset = 0

  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
    offset += value.length
  }

  writeString('RIFF')
  view.setUint32(offset, 36 + dataLength, true)
  offset += 4
  writeString('WAVE')
  writeString('fmt ')
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint32(offset, audioBuffer.sampleRate, true)
  offset += 4
  view.setUint32(offset, audioBuffer.sampleRate * bytesPerSample, true)
  offset += 4
  view.setUint16(offset, bytesPerSample, true)
  offset += 2
  view.setUint16(offset, 16, true)
  offset += 2
  writeString('data')
  view.setUint32(offset, dataLength, true)
  offset += 4

  for (let index = 0; index < mono.length; index += 1) {
    view.setInt16(offset, encodePcm16Sample(mono[index]), true)
    offset += bytesPerSample
  }

  return new Blob([wavBuffer], { type: 'audio/wav' })
}

async function convertAudioBlobToWav(
  blob: Blob,
  speechWindow: SpeechRecognitionWindow | undefined
): Promise<Blob> {
  const AudioContextCtor = resolveAudioContextConstructor(speechWindow)
  if (!AudioContextCtor) {
    throw new Error('decode-unsupported')
  }

  const audioContext = new AudioContextCtor()
  try {
    const arrayBuffer = await readBlobAsArrayBuffer(blob)
    const decoded = await audioContext.decodeAudioData(arrayBuffer)
    return encodeAudioBufferAsWav(decoded)
  } catch {
    throw new Error('decode-failed')
  } finally {
    await audioContext.close().catch(() => undefined)
  }
}

export function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  if (typeof btoa === 'function') {
    return btoa(binary)
  }

  throw new Error('base64-unsupported')
}

async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer()
  }

  return await new Response(blob).arrayBuffer()
}

async function awaitTranscriptionResult(
  transcriptionPromise: Promise<string>,
  options: {
    signal: AbortSignal
    timeoutMs: number
    onTimeout?: () => void
  }
): Promise<string> {
  if (options.signal.aborted) {
    throw createAbortError()
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let removeAbortListener: () => void = () => undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    const onAbort = () => reject(createAbortError())
    options.signal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => options.signal.removeEventListener('abort', onAbort)

    timeoutId = setTimeout(() => {
      reject(createTranscriptionTimeoutError())
      options.onTimeout?.()
    }, options.timeoutMs)
  })

  try {
    return await Promise.race([transcriptionPromise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    removeAbortListener()
  }
}

export function useSpeechRecognition(options: {
  getLanguage?: () => string
  onTranscript: (text: string) => void
  transcribe: (
    payload: SpeechRecognitionAudioPayload,
    options?: { signal?: AbortSignal }
  ) => Promise<string>
  onUnsupported?: () => void
  onError?: (code: SpeechRecognitionErrorCode) => void
  speechWindow?: SpeechRecognitionWindow
  transcriptionTimeoutMs?: number
}) {
  const speechWindow = options.speechWindow ?? getDefaultSpeechWindow()
  const isSupported = isSpeechRecognitionSupported(speechWindow)
  const isTranscribing = ref(false)
  const isDisposed = ref(false)
  let activeAbortController: AbortController | null = null

  const recorder = useAudioRecorder({
    recorderWindow: speechWindow,
    onRecorded: async ({ blob }) => {
      if (isDisposed.value) {
        return
      }

      const abortController = new AbortController()
      activeAbortController = abortController
      isTranscribing.value = true

      try {
        const wavBlob = await convertAudioBlobToWav(blob, speechWindow)
        const audioBase64 = arrayBufferToBase64(await readBlobAsArrayBuffer(wavBlob))
        if (abortController.signal.aborted) {
          return
        }

        const text = await awaitTranscriptionResult(
          options.transcribe(
            {
              audioBase64,
              mimeType: wavBlob.type || 'audio/wav',
              filename: `recording-${Date.now()}.wav`
            },
            { signal: abortController.signal }
          ),
          {
            signal: abortController.signal,
            timeoutMs: options.transcriptionTimeoutMs ?? DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
            onTimeout: () => abortController.abort()
          }
        )

        if (abortController.signal.aborted) {
          return
        }

        const transcript = text.trim()
        if (transcript) {
          options.onTranscript(transcript)
        }
      } catch (error) {
        const code = normalizeTranscriptionErrorCode(error)
        if (code !== 'aborted') {
          options.onError?.(code)
        }
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null
        }
        isTranscribing.value = false
      }
    },
    onUnsupported: options.onUnsupported,
    onError: (code) => {
      options.onError?.(normalizeRecorderErrorCode(code))
    }
  })
  const isListening = computed(() => recorder.isRecording.value)

  const start = async (): Promise<boolean> => {
    if (!isSupported) {
      options.onUnsupported?.()
      return false
    }

    if (recorder.isRecording.value || isTranscribing.value) {
      return false
    }

    return await recorder.start()
  }

  const stop = () => {
    if (recorder.isRecording.value) {
      recorder.stop()
      return
    }

    activeAbortController?.abort()
  }

  const toggle = async () => {
    if (recorder.isRecording.value || isTranscribing.value) {
      stop()
      return false
    }

    return await start()
  }

  const cleanup = () => {
    isDisposed.value = true
    activeAbortController?.abort()
    activeAbortController = null
    recorder.cleanup()
    isTranscribing.value = false
  }

  return {
    isSupported,
    isListening,
    isTranscribing,
    start,
    stop,
    toggle,
    cleanup
  }
}
