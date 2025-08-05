import { usePresenter } from '@/composables/usePresenter'
import { DIALOG_EVENTS } from '@/events'
import { DialogRequest, DialogResponse } from '@shared/presenter'
import { defineStore } from 'pinia'
import { onMounted, onUnmounted, ref } from 'vue'

export const useDialogStore = defineStore('dialog', () => {
  const dialogP = usePresenter('dialogPresenter')
  const dialogRequest = ref<DialogRequest | null>(null)
  const showDialog = ref(false)
  const timeoutMilliseconds = ref(0)
  let timer: NodeJS.Timeout | null = null

  // Clear the timer
  const clearTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  // Start countdown
  const startCountdown = (timeout: number, defaultResponse: DialogResponse) => {
    timeoutMilliseconds.value = timeout
    clearTimer()
    timer = setInterval(() => {
      if (timeoutMilliseconds.value > 0) {
        timeoutMilliseconds.value -= 100
      } else {
        clearTimer()
        handleResponse(defaultResponse)
      }
    }, 100)
  }

  // Listen for dialog request events
  const setupUpdateListener = () => {
    window.electron.ipcRenderer.on(DIALOG_EVENTS.REQUEST, async (_, event: DialogRequest) => {
      try {
        if (!event || !event.id || !event.title) {
          console.error('[DialogStore] Invalid dialog request:', event)
          return
        }

        // Clear previous dialog request if exists
        if (dialogRequest.value) {
          try {
            await handleError(dialogRequest.value.id)
          } catch (error) {
            console.error('[DialogStore] Failed to clear previous dialog:', error)
          }
        }

        // Start countdown if timeout is set and has default button
        const { timeout, buttons } = event
        const defaultButton = buttons.find((btn) => btn.default)
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
    })
  }

  // Remove dialog request listener
  const removeUpdateListener = () => {
    clearTimer()
    window.electron.ipcRenderer.removeAllListeners(DIALOG_EVENTS.REQUEST)
  }

  // Respond to dialog
  const handleResponse = async (response: DialogResponse) => {
    try {
      clearTimer()
      if (!dialogRequest.value) {
        console.warn('No dialog request to respond')
        return
      }
      await dialogP.handleDialogResponse(response)
    } catch (error) {
      console.error('[DialogStore] Error handling dialog response:', error)
    } finally {
      dialogRequest.value = null
      showDialog.value = false
    }
  }

  // Handle dialog error
  const handleError = async (id: string) => {
    try {
      clearTimer()
      await dialogP.handleDialogError(id)
    } catch (error) {
      console.error('[DialogStore] Error handling dialog error:', error)
    } finally {
      dialogRequest.value = null
      showDialog.value = false
    }
  }

  onMounted(setupUpdateListener)
  onUnmounted(removeUpdateListener)

  return {
    timeoutMilliseconds,
    dialogRequest,
    showDialog,
    handleResponse
  }
})
