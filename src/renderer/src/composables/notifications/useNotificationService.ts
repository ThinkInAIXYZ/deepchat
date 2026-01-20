import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import { NOTIFICATION_EVENTS } from '@/events'

export type ErrorNotification = {
  id: string
  title: string
  message: string
  type: string
}

type DisplayError = (error: ErrorNotification, onClose: () => void) => () => void

type ErrorQueueOptions = {
  maxQueueSize?: number
  autoCloseMs?: number
}

export const createErrorQueue = (display: DisplayError, options?: ErrorQueueOptions) => {
  const maxQueueSize = options?.maxQueueSize ?? 5
  const autoCloseMs = options?.autoCloseMs ?? 3000
  const queue: ErrorNotification[] = []
  let current: ErrorNotification | null = null
  let timer: number | null = null
  let dismissCurrent: (() => void) | null = null

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const showNext = () => {
    if (current || queue.length === 0) return
    const next = queue.shift()
    if (!next) return
    current = next

    const closeCurrent = () => {
      if (!current || current.id !== next.id) return
      clearTimer()
      current = null
      dismissCurrent = null
      showNext()
    }

    dismissCurrent = display(next, closeCurrent)

    if (autoCloseMs > 0) {
      timer = window.setTimeout(() => {
        dismissCurrent?.()
        closeCurrent()
      }, autoCloseMs)
    }
  }

  const show = (error: ErrorNotification) => {
    if (current?.id === error.id || queue.some((item) => item.id === error.id)) {
      return
    }

    if (current) {
      if (queue.length >= maxQueueSize) {
        queue.shift()
      }
      queue.push(error)
      return
    }

    queue.push(error)
    showNext()
  }

  const clear = () => {
    clearTimer()
    queue.length = 0
    dismissCurrent?.()
    current = null
    dismissCurrent = null
  }

  return {
    show,
    clear
  }
}

type NotificationService = {
  showErrorToast: (error: ErrorNotification) => void
  bindErrorNotifications: () => () => void
  showSystemNotification: (payload: {
    id: string
    title: string
    body: string
    silent?: boolean
  }) => Promise<void>
}

let sharedQueue: ReturnType<typeof createErrorQueue> | null = null

export function useNotificationService(): NotificationService {
  const { toast } = useToast()
  const notificationPresenter = usePresenter('notificationPresenter')

  if (!sharedQueue) {
    sharedQueue = createErrorQueue((error, onClose) => {
      const { dismiss } = toast({
        title: error.title,
        description: error.message,
        variant: 'destructive',
        onOpenChange: (open) => {
          if (!open) onClose()
        }
      })
      return () => dismiss()
    })
  }

  const showErrorToast = (error: ErrorNotification) => {
    sharedQueue?.show(error)
  }

  const bindErrorNotifications = () => {
    if (!window?.electron?.ipcRenderer) return () => undefined

    const handler = (_event: unknown, error: ErrorNotification) => {
      showErrorToast(error)
    }

    window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.SHOW_ERROR, handler)

    return () => {
      window.electron.ipcRenderer.removeListener(NOTIFICATION_EVENTS.SHOW_ERROR, handler)
    }
  }

  const showSystemNotification = async (payload: {
    id: string
    title: string
    body: string
    silent?: boolean
  }) => {
    return notificationPresenter.showNotification(payload)
  }

  return {
    showErrorToast,
    bindErrorNotifications,
    showSystemNotification
  }
}
