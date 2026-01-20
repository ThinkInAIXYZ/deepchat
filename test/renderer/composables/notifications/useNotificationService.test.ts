import { describe, it, expect } from 'vitest'
import {
  createErrorQueue,
  type ErrorNotification
} from '@/composables/notifications/useNotificationService'

describe('createErrorQueue', () => {
  it('queues errors and preserves order', () => {
    const order: string[] = []
    const closers = new Map<string, () => void>()

    const display = (error: ErrorNotification, onClose: () => void) => {
      order.push(`show:${error.id}`)
      closers.set(error.id, onClose)
      return () => {
        order.push(`dismiss:${error.id}`)
      }
    }

    const queue = createErrorQueue(display, { autoCloseMs: 0, maxQueueSize: 2 })

    queue.show({ id: 'a', title: 'A', message: 'A', type: 'error' })
    queue.show({ id: 'a', title: 'A', message: 'A', type: 'error' })
    queue.show({ id: 'b', title: 'B', message: 'B', type: 'error' })
    queue.show({ id: 'c', title: 'C', message: 'C', type: 'error' })

    closers.get('a')?.()
    closers.get('b')?.()

    expect(order).toEqual(['show:a', 'show:b', 'show:c'])
  })
})
