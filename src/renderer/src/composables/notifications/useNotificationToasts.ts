import { useToast } from '@/components/use-toast'
import type { ErrorNotification } from './types'

type DisplayError = (error: ErrorNotification, onClose: () => void) => () => void

export type ErrorQueueOptions = {
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

let sharedQueue: ReturnType<typeof createErrorQueue> | null = null

export function useNotificationToasts() {
  const { toast } = useToast()

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

  const clearErrorToasts = () => {
    sharedQueue?.clear()
  }

  return {
    showErrorToast,
    clearErrorToasts
  }
}
