import { effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const speechRecognitionMock = vi.hoisted(() => vi.fn())

vi.mock('@/components/chat/composables/useSpeechRecognition', () => ({
  useSpeechRecognition: speechRecognitionMock
}))

import { useVoiceInput } from '@/features/chat-page/composables/useVoiceInput'

type ModelSelection = {
  providerId: string
  modelId: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

function createSpeechInput() {
  return {
    isListening: ref(false),
    isTranscribing: ref(false),
    stop: vi.fn(),
    toggle: vi.fn(),
    cleanup: vi.fn()
  }
}

function createModelClient() {
  let modelConfigChangedListener:
    | ((payload: { providerId?: string; modelId?: string }) => void)
    | null = null
  const unsubscribe = vi.fn(() => {
    modelConfigChangedListener = null
  })

  return {
    getModelConfig: vi.fn(),
    transcribeAudio: vi.fn(),
    onModelConfigChanged: vi.fn((listener) => {
      modelConfigChangedListener = listener
      return unsubscribe
    }),
    emitModelConfigChanged: (payload: { providerId?: string; modelId?: string }) => {
      modelConfigChangedListener?.(payload)
    },
    unsubscribe
  }
}

function createHarness(
  selection = ref<ModelSelection | null>({ providerId: 'acp', modelId: 'a' }),
  configureModelClient: (client: ReturnType<typeof createModelClient>) => void = (client) => {
    client.getModelConfig.mockResolvedValue({ speechRecognition: true })
  }
) {
  const speechInput = createSpeechInput()
  speechRecognitionMock.mockReturnValue(speechInput)

  const modelClient = createModelClient()
  configureModelClient(modelClient)
  const notify = vi.fn()
  const insertRecognizedText = vi.fn()
  const scope = effectScope()
  let voiceInput!: ReturnType<typeof useVoiceInput>

  scope.run(() => {
    voiceInput = useVoiceInput({
      chatInputRef: ref({ insertRecognizedText }),
      getActiveModelSelection: () => selection.value,
      modelClient,
      notify,
      t: (key) => key
    })
  })

  return {
    voiceInput,
    selection,
    speechInput,
    modelClient,
    notify,
    insertRecognizedText,
    stop: () => {
      voiceInput.cleanup()
      scope.stop()
    }
  }
}

describe('useVoiceInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes only the active model configuration and releases its resources', async () => {
    const harness = createHarness()
    harness.modelClient.getModelConfig.mockResolvedValue({ speechRecognition: true })

    await vi.waitFor(() => expect(harness.voiceInput.isVoiceInputEnabled.value).toBe(true))
    expect(harness.modelClient.getModelConfig).toHaveBeenCalledWith('a', 'acp')

    harness.modelClient.emitModelConfigChanged({ providerId: 'other', modelId: 'model' })
    await Promise.resolve()
    expect(harness.modelClient.getModelConfig).toHaveBeenCalledTimes(1)

    harness.modelClient.getModelConfig.mockResolvedValue({ speechRecognition: false })
    harness.modelClient.emitModelConfigChanged({ providerId: 'acp', modelId: 'a' })

    await vi.waitFor(() => expect(harness.voiceInput.isVoiceInputEnabled.value).toBe(false))
    expect(harness.speechInput.stop).toHaveBeenCalledTimes(1)

    harness.stop()
    expect(harness.modelClient.unsubscribe).toHaveBeenCalledTimes(1)
    expect(harness.speechInput.cleanup).toHaveBeenCalledTimes(1)
  })

  it('ignores stale model configuration responses after a selection change', async () => {
    const selection = ref<ModelSelection | null>({ providerId: 'acp', modelId: 'a' })
    const firstConfig = deferred<{ speechRecognition: boolean }>()
    const secondConfig = deferred<{ speechRecognition: boolean }>()
    const harness = createHarness(selection, (modelClient) => {
      modelClient.getModelConfig.mockImplementation((modelId: string) =>
        modelId === 'a' ? firstConfig.promise : secondConfig.promise
      )
    })

    await vi.waitFor(() => expect(harness.modelClient.getModelConfig).toHaveBeenCalledTimes(1))

    selection.value = { providerId: 'acp', modelId: 'b' }
    await vi.waitFor(() => expect(harness.modelClient.getModelConfig).toHaveBeenCalledTimes(2))

    secondConfig.resolve({ speechRecognition: true })
    await vi.waitFor(() => expect(harness.voiceInput.isVoiceInputEnabled.value).toBe(true))

    firstConfig.resolve({ speechRecognition: false })
    await Promise.resolve()

    expect(harness.voiceInput.isVoiceInputEnabled.value).toBe(true)
    expect(harness.speechInput.stop).not.toHaveBeenCalled()
    harness.stop()
  })

  it('adapts speech callbacks to the chat input, model client, and notifications', async () => {
    const harness = createHarness()
    harness.modelClient.getModelConfig.mockResolvedValue({ speechRecognition: true })

    await vi.waitFor(() => expect(speechRecognitionMock).toHaveBeenCalledTimes(1))
    const speechOptions = speechRecognitionMock.mock.calls[0]?.[0]

    speechOptions.onTranscript('recognized text')
    expect(harness.insertRecognizedText).toHaveBeenCalledWith('recognized text')

    await expect(
      speechOptions.transcribe({
        audioBase64: 'audio',
        mimeType: 'audio/wav',
        filename: 'recording.wav'
      })
    ).resolves.toBeUndefined()
    expect(harness.modelClient.transcribeAudio).toHaveBeenCalledWith(
      'acp',
      'a',
      'audio',
      'audio/wav',
      'recording.wav'
    )

    speechOptions.onError('not-allowed')
    expect(harness.notify).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.voice.permissionDenied',
      title: 'chat.input.voiceRecognitionPermissionDeniedTitle',
      description: 'chat.input.voiceRecognitionPermissionDeniedDescription'
    })

    speechOptions.onError('aborted')
    expect(harness.notify).toHaveBeenCalledTimes(1)

    speechOptions.onUnsupported()
    expect(harness.notify).toHaveBeenLastCalledWith({
      kind: 'warning',
      code: 'chat.voice.unsupported',
      title: 'chat.input.voiceRecognitionUnsupportedTitle',
      description: 'chat.input.voiceRecognitionUnsupportedDescription'
    })
    harness.stop()
  })
})
