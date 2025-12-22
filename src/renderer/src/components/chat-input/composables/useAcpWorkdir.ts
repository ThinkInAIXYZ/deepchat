import { computed, ref, watch } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { Ref } from 'vue'
import { useChatStore } from '@/stores/chat'

type ActiveModelRef = Ref<{ id?: string; providerId?: string } | null>

interface UseAcpWorkdirOptions {
  activeModel: ActiveModelRef
  conversationId: Ref<string | null>
}

export function useAcpWorkdir(options: UseAcpWorkdirOptions) {
  const threadPresenter = usePresenter('threadPresenter')
  const devicePresenter = usePresenter('devicePresenter')
  const chatStore = useChatStore()

  const workdir = ref('')
  const isCustom = ref(false)
  const loading = ref(false)
  const pendingWorkdir = ref<string | null>(null)
  const lastWarmupKey = ref<string | null>(null)

  const hasConversation = computed(() => Boolean(options.conversationId.value))

  const isAcpModel = computed(
    () => options.activeModel.value?.providerId === 'acp' && !!options.activeModel.value?.id
  )

  const agentId = computed(() => options.activeModel.value?.id ?? '')
  const syncPreference = (value: string | null) => {
    if (!agentId.value) return
    chatStore.setAcpWorkdirPreference(agentId.value, value)
  }

  const hydrateFromPreference = () => {
    if (!agentId.value) return
    const stored = chatStore.chatConfig.acpWorkdirMap?.[agentId.value] ?? null
    if (stored) {
      workdir.value = stored
      isCustom.value = true
      pendingWorkdir.value = stored
    } else {
      pendingWorkdir.value = null
      resetToDefault()
    }
  }

  const resetToDefault = () => {
    workdir.value = ''
    isCustom.value = false
    lastWarmupKey.value = null
  }

  const warmupProcess = async (target: string | null) => {
    const trimmed = target?.trim()
    if (!trimmed || !isAcpModel.value || !agentId.value) {
      return
    }

    const warmupKey = `${agentId.value}::${trimmed}`
    if (lastWarmupKey.value === warmupKey) return
    lastWarmupKey.value = warmupKey

    try {
      await threadPresenter.warmupAcpProcess(agentId.value, trimmed)
    } catch (error) {
      console.warn('[useAcpWorkdir] Failed to warmup ACP process', error)
    }
  }

  const loadWorkdir = async () => {
    if (!isAcpModel.value) {
      pendingWorkdir.value = null
      resetToDefault()
      return
    }

    if (!options.conversationId.value || !agentId.value) {
      if (!pendingWorkdir.value) {
        hydrateFromPreference()
      }
      return
    }

    loading.value = true
    try {
      const result = await threadPresenter.getAcpWorkdir(
        options.conversationId.value,
        agentId.value
      )
      workdir.value = result?.path ?? ''
      isCustom.value = Boolean(result?.isCustom)
      pendingWorkdir.value = null
      syncPreference(workdir.value || null)
    } catch (error) {
      console.warn('[useAcpWorkdir] Failed to load workdir', error)
      resetToDefault()
      syncPreference(null)
    } finally {
      loading.value = false
    }
  }

  watch(
    [isAcpModel, options.conversationId, agentId],
    () => {
      void loadWorkdir()
    },
    { immediate: true }
  )

  const syncPendingWhenReady = async () => {
    if (!pendingWorkdir.value || !options.conversationId.value || !agentId.value) return
    loading.value = true
    try {
      await threadPresenter.setAcpWorkdir(
        options.conversationId.value,
        agentId.value,
        pendingWorkdir.value
      )
      workdir.value = pendingWorkdir.value
      isCustom.value = Boolean(pendingWorkdir.value)
      syncPreference(workdir.value || null)
      pendingWorkdir.value = null
      await warmupProcess(workdir.value)
    } catch (error) {
      console.warn('[useAcpWorkdir] Failed to apply pending workdir', error)
    } finally {
      loading.value = false
    }
  }

  watch(options.conversationId, () => {
    if (pendingWorkdir.value) {
      void syncPendingWhenReady()
    }
  })

  watch(agentId, () => {
    if (!hasConversation.value) {
      hydrateFromPreference()
    }
    lastWarmupKey.value = null
  })

  const selectWorkdir = async () => {
    if (loading.value || !isAcpModel.value || !agentId.value) {
      return
    }
    const result = await devicePresenter.selectDirectory()
    if (result.canceled || !result.filePaths?.length) return

    const selectedPath = result.filePaths[0]
    loading.value = true
    try {
      if (hasConversation.value && options.conversationId.value) {
        await threadPresenter.setAcpWorkdir(
          options.conversationId.value,
          agentId.value,
          selectedPath
        )
        workdir.value = selectedPath
        isCustom.value = true
      } else {
        pendingWorkdir.value = selectedPath
        workdir.value = selectedPath
        isCustom.value = true
      }
      syncPreference(selectedPath)
      await warmupProcess(selectedPath)
    } catch (error) {
      console.warn('[useAcpWorkdir] Failed to set workdir', error)
    } finally {
      loading.value = false
    }
  }

  const hasWorkdir = computed(() => isCustom.value || Boolean(pendingWorkdir.value))

  return {
    isAcpModel,
    workdir,
    hasWorkdir,
    selectWorkdir,
    loading
  }
}
