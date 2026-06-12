import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  encodeAudioBufferAsWav,
  isSpeechRecognitionSupported,
  useSpeechRecognition
} from '@/components/chat/composables/useSpeechRecognition'
import { useAudioRecorder } from '@/components/chat/composables/useAudioRecorder'

class FakeMediaRecorder {
  static isTypeSupported = vi.fn((mimeType: string) =>
    ['audio/webm;codecs=opus', 'audio/webm'].includes(mimeType)
  )

  mimeType = 'audio/webm'
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onerror: (() => void) | null = null
  onstop: (() => void) | null = null

  constructor(
    _stream: MediaStream,
    options?: {
      mimeType?: string
    }
  ) {
    if (options?.mimeType) {
      this.mimeType = options.mimeType
    }
  }

  start = vi.fn(() => {
    this.state = 'recording'
  })

  stop = vi.fn(() => {
    this.state = 'inactive'
    this.ondataavailable?.({
      data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType })
    })
    this.onstop?.()
  })

  abort = vi.fn(() => {
    this.state = 'inactive'
  })
}

class FakeAudioContext {
  decodeAudioData = vi.fn(async () => ({
    numberOfChannels: 1,
    length: 4,
    sampleRate: 16000,
    getChannelData: () => new Float32Array([0, -0.5, 0.5, 1])
  }))

  close = vi.fn(async () => undefined)
}

class DeferredStopMediaRecorder {
  static isTypeSupported = vi.fn(() => false)
  static instances: DeferredStopMediaRecorder[] = []

  mimeType = 'audio/webm'
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onerror: (() => void) | null = null
  onstop: (() => void) | null = null

  constructor() {
    DeferredStopMediaRecorder.instances.push(this)
  }

  start = vi.fn(() => {
    this.state = 'recording'
  })

  stop = vi.fn(() => {
    this.state = 'inactive'
  })

  emitStop() {
    this.ondataavailable?.({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType })
    })
    this.onstop?.()
  }
}

describe('useSpeechRecognition', () => {
  afterEach(() => {
    vi.useRealTimers()
    DeferredStopMediaRecorder.instances = []
  })

  it('detects browser speech recognition support', () => {
    expect(isSpeechRecognitionSupported(undefined)).toBe(false)
    expect(
      isSpeechRecognitionSupported({
        MediaRecorder: FakeMediaRecorder as any,
        navigator: {
          mediaDevices: {
            getUserMedia: vi.fn()
          }
        } as any,
        AudioContext: FakeAudioContext as any
      })
    ).toBe(true)
  })

  it('encodes decoded audio as wav', async () => {
    const wavBlob = encodeAudioBufferAsWav({
      numberOfChannels: 1,
      length: 2,
      sampleRate: 16000,
      getChannelData: () => new Float32Array([0, 1])
    })

    expect(wavBlob.type).toBe('audio/wav')
    expect(wavBlob.size).toBe(48)
  })

  it('records, transcribes, and emits transcript text after stop', async () => {
    const transcripts: string[] = []
    let resolveTranscription: ((value: string) => void) | null = null
    const transcriptionPromise = new Promise<string>((resolve) => {
      resolveTranscription = resolve
    })
    const transcribe = vi.fn(async ({ mimeType, filename, audioBase64 }) => {
      expect(mimeType).toBe('audio/wav')
      expect(filename).toMatch(/^recording-\d+\.wav$/)
      expect(audioBase64.length).toBeGreaterThan(0)
      return await transcriptionPromise
    })

    const recognition = useSpeechRecognition({
      speechWindow: {
        MediaRecorder: FakeMediaRecorder as any,
        navigator: {
          mediaDevices: {
            getUserMedia: vi.fn(async () => ({
              getTracks: () => [{ stop: vi.fn() }]
            }))
          }
        } as any,
        AudioContext: FakeAudioContext as any
      },
      onTranscript: (text) => transcripts.push(text),
      transcribe
    })

    expect(await recognition.start()).toBe(true)
    expect(recognition.isListening.value).toBe(true)
    expect(recognition.isTranscribing.value).toBe(false)

    recognition.stop()

    await vi.waitFor(() => {
      expect(transcribe).toHaveBeenCalledTimes(1)
    })

    expect(recognition.isListening.value).toBe(false)
    expect(recognition.isTranscribing.value).toBe(true)

    resolveTranscription?.('你好，世界')

    await vi.waitFor(() => {
      expect(recognition.isTranscribing.value).toBe(false)
    })
    expect(transcripts).toEqual(['你好，世界'])
  })

  it('normalizes microphone permission errors', async () => {
    const onError = vi.fn()
    const recognition = useSpeechRecognition({
      speechWindow: {
        MediaRecorder: FakeMediaRecorder as any,
        navigator: {
          mediaDevices: {
            getUserMedia: vi.fn(async () => {
              throw new DOMException('Permission denied', 'NotAllowedError')
            })
          }
        } as any,
        AudioContext: FakeAudioContext as any
      },
      onTranscript: vi.fn(),
      transcribe: vi.fn(),
      onError
    })

    expect(await recognition.start()).toBe(false)
    expect(onError).toHaveBeenCalledWith('not-allowed')
  })

  it('times out stalled transcription, reports error, and clears loading', async () => {
    vi.useFakeTimers()

    const onError = vi.fn()
    const transcribe = vi.fn(() => new Promise<string>(() => undefined))
    const recognition = useSpeechRecognition({
      speechWindow: {
        MediaRecorder: FakeMediaRecorder as any,
        navigator: {
          mediaDevices: {
            getUserMedia: vi.fn(async () => ({
              getTracks: () => [{ stop: vi.fn() }]
            }))
          }
        } as any,
        AudioContext: FakeAudioContext as any
      },
      onTranscript: vi.fn(),
      transcribe,
      onError,
      transcriptionTimeoutMs: 10
    })

    expect(await recognition.start()).toBe(true)

    recognition.stop()

    await vi.waitFor(() => {
      expect(transcribe).toHaveBeenCalledTimes(1)
    })

    expect(recognition.isTranscribing.value).toBe(true)

    await vi.advanceTimersByTimeAsync(10)

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('transcription-timeout')
      expect(recognition.isTranscribing.value).toBe(false)
    })
  })

  it('reports unsupported environments', async () => {
    const onUnsupported = vi.fn()
    const recognition = useSpeechRecognition({
      speechWindow: {},
      onTranscript: vi.fn(),
      transcribe: vi.fn(),
      onUnsupported
    })

    expect(await recognition.start()).toBe(false)
    expect(onUnsupported).toHaveBeenCalledTimes(1)
  })
})

describe('useAudioRecorder', () => {
  it('does not emit recorded audio after cleanup disposes the active recorder', async () => {
    const onRecorded = vi.fn()
    const stopTrack = vi.fn()
    const recorder = useAudioRecorder({
      recorderWindow: {
        MediaRecorder: DeferredStopMediaRecorder as any,
        navigator: {
          mediaDevices: {
            getUserMedia: vi.fn(async () => ({
              getTracks: () => [{ stop: stopTrack }]
            }))
          }
        } as any
      },
      onRecorded
    })

    expect(await recorder.start()).toBe(true)
    recorder.cleanup()

    DeferredStopMediaRecorder.instances[0].emitStop()

    expect(onRecorded).not.toHaveBeenCalled()
    expect(stopTrack).toHaveBeenCalled()
  })
})
