import { ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/modelStore'
import { usePresenter } from '@/composables/usePresenter'
import { ModelType } from '@shared/model'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'

export type ModelInfo = { id: string; providerId: string }

export function useModelSelection() {
  const chatStore = useChatStore()
  const modelStore = useModelStore()
  const configPresenter = usePresenter('configPresenter')
  const chatMode = useChatMode()

  const selectedModelInfo = ref<ModelInfo | null>(null)
  const isUsingFallback = ref(false)
  const pendingModelInfo = ref<ModelInfo | null>(null)

  const findEnabledModel = (providerId: string, modelId: string) => {
    for (const provider of modelStore.enabledModels) {
      if (provider.providerId === providerId) {
        for (const model of provider.models) {
          if (model.id === modelId) {
            return { model, providerId: provider.providerId }
          }
        }
      }
    }
    return undefined
  }

  const pickFirstEnabledModel = () => {
    const found = modelStore.enabledModels
      .flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.providerId })))
      .find((m) => m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)
    return found
  }

  const pickFirstAcpModel = () => {
    const found = modelStore.enabledModels
      .flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.providerId })))
      .find(
        (m) =>
          m.providerId === 'acp' &&
          (m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)
      )
    return found
  }

  const pickFirstNonAcpModel = () => {
    const found = modelStore.enabledModels
      .flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.providerId })))
      .find(
        (m) =>
          m.providerId !== 'acp' &&
          (m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)
      )
    return found
  }

  const pickModelForMode = (mode: 'agent' | 'acp agent') => {
    return mode === 'acp agent' ? pickFirstAcpModel() : pickFirstNonAcpModel()
  }

  const matchesModelWithMode = (providerId: string | undefined, mode: 'agent' | 'acp agent') => {
    if (!providerId) return false
    if (mode === 'acp agent') return providerId === 'acp'
    return providerId !== 'acp'
  }

  const setModel = async (model: { id: string; providerId: string }) => {
    selectedModelInfo.value = { id: model.id, providerId: model.providerId }
    await chatStore.updateChatConfig({
      modelId: model.id,
      providerId: model.providerId
    })
  }

  const trySelectPreferredModel = async (
    preferredModel: { modelId: string; providerId: string },
    currentMode: 'agent' | 'acp agent'
  ): Promise<boolean> => {
    const match = findEnabledModel(preferredModel.providerId, preferredModel.modelId)
    if (match && matchesModelWithMode(preferredModel.providerId, currentMode)) {
      await setModel({ id: match.model.id, providerId: match.providerId })
      isUsingFallback.value = false
      return true
    }
    return false
  }

  const useFallbackModel = async (currentMode: 'agent' | 'acp agent') => {
    const fallback = pickModelForMode(currentMode) ?? pickFirstEnabledModel()
    if (fallback) {
      await setModel({ id: fallback.id, providerId: fallback.providerId })
      isUsingFallback.value = true
    }
  }

  const initializeModel = async () => {
    const currentMode = chatMode.currentMode.value

    const recentThread =
      chatStore.threads.length > 0
        ? chatStore.threads
            .flatMap((t) => t.dtThreads)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
        : null

    let preferredModel: { modelId: string; providerId: string } | null = null

    if (recentThread?.settings?.modelId && recentThread?.settings?.providerId) {
      preferredModel = {
        modelId: recentThread.settings.modelId,
        providerId: recentThread.settings.providerId
      }
    }

    if (!preferredModel) {
      try {
        const savedModel = await configPresenter.getSetting<{
          modelId: string
          providerId: string
        }>('preferredModel')
        preferredModel = savedModel || null
      } catch (error) {
        console.warn('Failed to get preferred model:', error)
      }
    }

    if (preferredModel?.modelId && preferredModel?.providerId) {
      const success = await trySelectPreferredModel(preferredModel, currentMode)
      if (success) {
        pendingModelInfo.value = null
        return
      }

      const providerReady = modelStore.isProviderReady(preferredModel.providerId)
      if (!providerReady) {
        pendingModelInfo.value = {
          id: preferredModel.modelId,
          providerId: preferredModel.providerId
        }
        await modelStore.awaitProviderInitialized(preferredModel.providerId)
        const retrySuccess = await trySelectPreferredModel(preferredModel, currentMode)
        if (retrySuccess) {
          pendingModelInfo.value = null
          return
        }
      }
    }

    await useFallbackModel(currentMode)
  }

  watch(
    () => modelStore.enabledModels,
    async () => {
      if (!selectedModelInfo.value?.id) {
        await initializeModel()
        return
      }

      const current = selectedModelInfo.value
      const stillExists = !!findEnabledModel(current.providerId, current.id)
      if (!stillExists) {
        await useFallbackModel(chatMode.currentMode.value)
      }
    },
    { immediate: true, deep: true }
  )

  watch(
    () => chatMode.currentMode.value,
    async (newMode, oldMode) => {
      if (newMode === oldMode) return

      const current = selectedModelInfo.value
      const isCurrentAcp = current?.providerId === 'acp'
      const shouldBeAcp = newMode === 'acp agent'

      if (isCurrentAcp === shouldBeAcp) return

      const targetModel = pickModelForMode(newMode) ?? pickFirstEnabledModel()
      if (targetModel) {
        await setModel({ id: targetModel.id, providerId: targetModel.providerId })
        await configPresenter.setSetting('preferredModel', {
          modelId: targetModel.id,
          providerId: targetModel.providerId
        })
      }
    },
    { immediate: false }
  )

  return {
    selectedModelInfo,
    isUsingFallback,
    pendingModelInfo,
    initializeModel,
    setModel,
    getCurrentModel: () => selectedModelInfo.value
  }
}
