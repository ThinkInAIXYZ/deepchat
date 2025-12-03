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

  const hasConversation = computed(() => Boolean(options.conversationId.value))

  const isAcpModel = computed(
    () => options.activeModel.value?.providerId === 'acp' && !!options.activeModel.value?.id
  )

  const agentId = computed(() => options.activeModel.value?.id ?? '')
  const syncPreference = (value: string | null) => {
    if (!agentId.value) return
    chatStore.setAcpWorkdirPreference(agentId.value, value)
  }

  const resetToDefault = () => {
    workdir.value = ''
    isCustom.value = false
  }

  const loadWorkdir = async () => {
    if (!isAcpModel.value) {
      pendingWorkdir.value = null
      resetToDefault()
      return
    }

    if (!options.conversationId.value || !agentId.value) {
      if (!pendingWorkdir.value) {
        resetToDefault()
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
      pendingWorkdir.value = null
      resetToDefault()
    }
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
