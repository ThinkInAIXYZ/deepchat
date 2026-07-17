import { computed, ref, watch, type Ref } from 'vue'
import {
  useSpeechRecognition,
  type SpeechRecognitionErrorCode
} from '@/components/chat/composables/useSpeechRecognition'

type ModelSelection = {
  providerId: string
  modelId: string
}

type ChatInputHandle = {
  insertRecognizedText?: (text: string) => void
}

type ModelClientLike = {
  getModelConfig: (
    modelId: string,
    providerId?: string
  ) => Promise<{ speechRecognition?: boolean | null }>
  transcribeAudio: (
    providerId: string,
    modelId: string,
    audioBase64: string,
    mimeType: string,
    filename?: string
  ) => Promise<string>
  onModelConfigChanged: (
    listener: (payload: { providerId?: string; modelId?: string }) => void
  ) => () => void
}

type ToastFn = (options: {
  title: string
  description?: string
  variant?: 'destructive'
}) => unknown

type UseVoiceInputOptions = {
  chatInputRef: Ref<ChatInputHandle | null>
  getActiveModelSelection: () => ModelSelection | null
  modelClient: ModelClientLike
  toast: ToastFn
  t: (key: string) => string
}

/**
 * Owns the voice-input capability state and its model-configuration race gate.
 * The page remains responsible for resolving the active model, while this
 * composable prevents stale config reads from changing the current input state.
 */
export function useVoiceInput(options: UseVoiceInputOptions) {
  const isVoiceInputEnabled = ref(false)
  let voiceInputConfigToken = 0

  const handleVoiceInputError = (code: SpeechRecognitionErrorCode) => {
    if (code === 'aborted') {
      return
    }

    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
      options.toast({
        title: options.t('chat.input.voiceRecognitionPermissionDeniedTitle'),
        description: options.t('chat.input.voiceRecognitionPermissionDeniedDescription'),
        variant: 'destructive'
      })
      return
    }

    options.toast({
      title: options.t('chat.input.voiceRecognitionErrorTitle'),
      description: options.t('chat.input.voiceRecognitionErrorDescription'),
      variant: 'destructive'
    })
  }

  const voiceInput = useSpeechRecognition({
    onTranscript: (text) => {
      options.chatInputRef.value?.insertRecognizedText?.(text)
    },
    transcribe: async ({ audioBase64, mimeType, filename }) => {
      const selection = options.getActiveModelSelection()
      if (!selection) {
        throw new Error('transcription-target-unavailable')
      }

      return await options.modelClient.transcribeAudio(
        selection.providerId,
        selection.modelId,
        audioBase64,
        mimeType,
        filename
      )
    },
    onUnsupported: () => {
      options.toast({
        title: options.t('chat.input.voiceRecognitionUnsupportedTitle'),
        description: options.t('chat.input.voiceRecognitionUnsupportedDescription'),
        variant: 'destructive'
      })
    },
    onError: handleVoiceInputError
  })
  const isVoiceInputListening = computed(() => voiceInput.isListening.value)
  const isVoiceInputTranscribing = computed(() => voiceInput.isTranscribing.value)

  async function refreshVoiceInputAvailability() {
    const selection = options.getActiveModelSelection()
    const token = ++voiceInputConfigToken

    if (!selection) {
      isVoiceInputEnabled.value = false
      voiceInput.stop()
      return
    }

    try {
      const modelConfig = await options.modelClient.getModelConfig(
        selection.modelId,
        selection.providerId
      )
      if (token !== voiceInputConfigToken) {
        return
      }

      isVoiceInputEnabled.value = modelConfig.speechRecognition === true
      if (!isVoiceInputEnabled.value) {
        voiceInput.stop()
      }
    } catch (error) {
      if (token !== voiceInputConfigToken) {
        return
      }

      console.warn('[ChatPage] Failed to resolve voice input setting:', error)
      isVoiceInputEnabled.value = false
      voiceInput.stop()
    }
  }

  watch(
    options.getActiveModelSelection,
    () => {
      void refreshVoiceInputAvailability()
    },
    { immediate: true }
  )

  const removeModelConfigChangedListener = options.modelClient.onModelConfigChanged((payload) => {
    const selection = options.getActiveModelSelection()
    if (!selection) {
      return
    }

    if (payload.providerId !== selection.providerId || payload.modelId !== selection.modelId) {
      return
    }

    void refreshVoiceInputAvailability()
  })

  const cleanup = () => {
    removeModelConfigChangedListener()
    voiceInput.cleanup()
  }

  return {
    isVoiceInputEnabled,
    isVoiceInputListening,
    isVoiceInputTranscribing,
    toggleVoiceInput: voiceInput.toggle,
    cleanup
  }
}
