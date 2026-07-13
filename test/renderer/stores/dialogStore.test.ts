import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const dialogEventHandlers = vi.hoisted(() => ({
  requested: undefined as ((payload: Record<string, any>) => Promise<void> | void) | undefined
}))

const dialogClientMock = vi.hoisted(() => ({
  handleDialogResponse: vi.fn().mockResolvedValue(undefined),
  handleDialogError: vi.fn().mockResolvedValue(undefined),
  onRequested: vi.fn((listener: (payload: Record<string, any>) => Promise<void> | void) => {
    dialogEventHandlers.requested = listener
    return () => undefined
  })
}))

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia')
  return actual
})

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return {
    ...actual,
    onMounted: (callback: () => void) => callback(),
    onUnmounted: vi.fn()
  }
})

vi.mock('@api/DialogClient', () => ({
  createDialogClient: vi.fn(() => dialogClientMock)
}))

import { useDialogStore } from '@/stores/dialog'

describe('useDialogStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    dialogEventHandlers.requested = undefined
  })

  it('opens and responds to typed dialog requested events', async () => {
    const store = useDialogStore()

    expect(dialogClientMock.onRequested).toHaveBeenCalledTimes(1)
    expect(typeof dialogEventHandlers.requested).toBe('function')

    await dialogEventHandlers.requested?.({
      id: 'dialog-1',
      title: 'Confirm action',
      description: 'Proceed?',
      i18n: false,
      buttons: [{ key: 'ok', label: 'OK', default: true }],
      timeout: 0,
      version: Date.now()
    })

    expect(store.showDialog).toBe(true)
    expect(store.dialogRequest?.id).toBe('dialog-1')
    expect(store.dialogRequest?.title).toBe('Confirm action')

    await store.handleResponse({
      id: 'dialog-1',
      button: 'ok'
    })

    expect(dialogClientMock.handleDialogResponse).toHaveBeenCalledWith({
      id: 'dialog-1',
      button: 'ok'
    })
    expect(store.showDialog).toBe(false)
    expect(store.dialogRequest).toBeNull()
  })
})
