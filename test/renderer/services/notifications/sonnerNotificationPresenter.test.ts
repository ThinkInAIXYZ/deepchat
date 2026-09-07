import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ObservableNotificationRecord } from '@renderer-notifications'

const sonner = vi.hoisted(() => ({
  success: vi.fn(() => 'success-toast'),
  info: vi.fn(() => 'info-toast'),
  custom: vi.fn(() => 'managed-toast'),
  dismiss: vi.fn()
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: sonner.success,
    info: sonner.info,
    custom: sonner.custom,
    dismiss: sonner.dismiss
  }
}))

import { SonnerNotificationPresenter } from '@renderer-notifications/sonnerNotificationPresenter'

const createRecord = (kind: 'success' | 'info' | 'error' | 'actionable' | 'progress' = 'error') =>
  new ObservableNotificationRecord({
    logicalId: 'notification-1',
    code: 'test.notification',
    kind,
    title: 'Notification title',
    description: 'Notification description',
    occurrenceCount: 1,
    entityCount: 1,
    pendingCount: 0,
    createdAt: 0,
    lastSeenAt: 0
  })

describe('SonnerNotificationPresenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses native semantic content for simple feedback', () => {
    const presenter = new SonnerNotificationPresenter()
    const onClosed = vi.fn()

    presenter.present(
      createRecord('success'),
      { content: 'native', displayBudgetMs: 2_400, slot: 'transient' },
      { onClosed }
    )

    expect(sonner.success).toHaveBeenCalledOnce()
    expect(sonner.success).toHaveBeenCalledWith('Notification title', {
      description: 'Notification description',
      duration: 2_400,
      onDismiss: expect.any(Function),
      onAutoClose: expect.any(Function)
    })
    const options = sonner.success.mock.calls[0][1]
    options.onAutoClose()
    options.onDismiss()
    expect(onClosed).toHaveBeenCalledOnce()
    expect(onClosed).toHaveBeenCalledWith('auto')
  })

  it('creates managed content once and never updates Sonner during aggregation', () => {
    const presenter = new SonnerNotificationPresenter()
    const record = createRecord('error')
    const onClosed = vi.fn()

    presenter.present(
      record,
      { content: 'managed', displayBudgetMs: 8_000, slot: 'transient' },
      { onClosed }
    )
    record.patch({
      occurrenceCount: 2,
      title: 'Updated outside Sonner'
    })

    expect(sonner.custom).toHaveBeenCalledOnce()
    const options = sonner.custom.mock.calls[0][1]
    expect(options.componentProps.record).toBe(record)
    options.componentProps.onAction()
    options.onDismiss()
    expect(onClosed).toHaveBeenCalledOnce()
    expect(onClosed).toHaveBeenCalledWith('action')
  })

  it('dismisses one presentation without turning it into a close callback', () => {
    const presenter = new SonnerNotificationPresenter()
    const onClosed = vi.fn()
    const handle = presenter.present(
      createRecord('progress'),
      { content: 'managed', displayBudgetMs: Infinity, slot: 'persistent' },
      { onClosed }
    )

    handle.dismiss()
    handle.dismiss()
    expect(sonner.dismiss).toHaveBeenCalledOnce()
    expect(sonner.dismiss).toHaveBeenCalledWith('managed-toast')

    const options = sonner.custom.mock.calls[0][1]
    options.onDismiss()
    expect(onClosed).not.toHaveBeenCalled()
  })
})
