import { ref } from 'vue'
import type { DialogRequest, DialogResponse } from '@shared/presenter'
import { useDialogAdapter } from '@/composables/dialog/useDialogAdapter'

export const useDialogStoreService = () => {
  const dialogAdapter = useDialogAdapter()
  const dialogRequest = ref<DialogRequest | null>(null)
  const showDialog = ref(false)
  const timeoutMilliseconds = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null
  let listenersBound = false

  const clearTimer = () => {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  const handleResponse = async (response: DialogResponse) => {
    try {
      clearTimer()
      if (!dialogRequest.value) {
        console.warn('No dialog request to respond')
        return
      }
      await dialogAdapter.handleDialogResponse(response)
    } catch (error) {
      console.error('[DialogStore] Error handling dialog response:', error)
    } finally {
      dialogRequest.value = null
      showDialog.value = false
    }
  }

  const handleError = async (id: string) => {
    try {
      clearTimer()
      await dialogAdapter.handleDialogError(id)
    } catch (error) {
      console.error('[DialogStore] Error handling dialog error:', error)
    } finally {
      dialogRequest.value = null
      showDialog.value = false
    }
  }

  const startCountdown = (timeout: number, defaultResponse: DialogResponse) => {
    timeoutMilliseconds.value = timeout
    clearTimer()
    timer = setInterval(() => {
      if (timeoutMilliseconds.value > 0) {
        timeoutMilliseconds.value -= 100
        return
      }
      clearTimer()
      void handleResponse(defaultResponse)
    }, 100)
  }

  const handleDialogRequest = async (event: DialogRequest) => {
    try {
      if (!event || !event.id || !event.title) {
        console.error('[DialogStore] Invalid dialog request:', event)
        return
      }

      if (dialogRequest.value) {
        try {
          await handleError(dialogRequest.value.id)
        } catch (error) {
          console.error('[DialogStore] Failed to clear previous dialog:', error)
        }
      }

      const { timeout, buttons } = event
      const defaultButton = buttons?.find((button) => button.default)
      if (timeout > 0 && buttons && defaultButton) {
        startCountdown(timeout, {
          id: event.id,
          button: defaultButton.key
        })
      }

      dialogRequest.value = event
      showDialog.value = true
    } catch (error) {
      console.error('[DialogStore] Error processing dialog request:', error)
    }
  }

  const bindEventListeners = () => {
    if (listenersBound) return () => undefined
    listenersBound = true
    const unsubscribe = dialogAdapter.onRequest(handleDialogRequest)

    return () => {
      clearTimer()
      unsubscribe()
      listenersBound = false
    }
  }

  return {
    timeoutMilliseconds,
    dialogRequest,
    showDialog,
    handleResponse,
    bindEventListeners
  }
}
