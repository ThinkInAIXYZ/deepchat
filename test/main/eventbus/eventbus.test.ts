import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFromId } = vi.hoisted(() => ({
  mockFromId: vi.fn()
}))

vi.mock('electron', () => ({
  webContents: {
    fromId: mockFromId
  }
}))

import { EventBus, SendTarget } from '../../../src/main/eventbus'
import type { IWindowPresenter } from '../../../src/shared/presenter'

describe('EventBus', () => {
  let eventBus: EventBus
  let mockWindowPresenter: IWindowPresenter

  beforeEach(() => {
    eventBus = new EventBus()
    mockFromId.mockReset()

    mockWindowPresenter = {
      sendToWindow: vi.fn(),
      sendToAllWindows: vi.fn(),
      sendToDefaultTab: vi.fn()
    } as Partial<IWindowPresenter> as IWindowPresenter
  })

  it('emits events to main process listeners', () => {
    const listener = vi.fn()
    eventBus.on('test:event', listener)

    eventBus.sendToMain('test:event', { ok: true })

    expect(listener).toHaveBeenCalledWith({ ok: true })
  })

  it('sends events to a specific window', () => {
    eventBus.setWindowPresenter(mockWindowPresenter)

    eventBus.sendToWindow('window:test', 123, { ok: true })

    expect(mockWindowPresenter.sendToWindow).toHaveBeenCalledWith(123, 'window:test', {
      ok: true
    })
  })

  it('warns when sending to window without presenter', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    eventBus.sendToWindow('window:test', 1, 'payload')

    expect(warnSpy).toHaveBeenCalledWith('WindowPresenter not available, cannot send to window')
    warnSpy.mockRestore()
  })

  it('sends renderer event to all windows by default', () => {
    eventBus.setWindowPresenter(mockWindowPresenter)

    eventBus.sendToRenderer('renderer:test', undefined, { ok: true })

    expect(mockWindowPresenter.sendToAllWindows).toHaveBeenCalledWith('renderer:test', { ok: true })
  })

  it('sends renderer event to default tab when target is DEFAULT_TAB', () => {
    eventBus.setWindowPresenter(mockWindowPresenter)

    eventBus.sendToRenderer('renderer:default', SendTarget.DEFAULT_TAB, { ok: true })

    expect(mockWindowPresenter.sendToDefaultTab).toHaveBeenCalledWith('renderer:default', true, {
      ok: true
    })
  })

  it('sends to both main and renderer via send()', () => {
    eventBus.setWindowPresenter(mockWindowPresenter)
    const listener = vi.fn()
    eventBus.on('both:test', listener)

    eventBus.send('both:test', SendTarget.ALL_WINDOWS, { ok: true })

    expect(listener).toHaveBeenCalledWith({ ok: true })
    expect(mockWindowPresenter.sendToAllWindows).toHaveBeenCalledWith('both:test', { ok: true })
  })

  it('sends to web contents when target exists', () => {
    const send = vi.fn()
    mockFromId.mockReturnValue({ send, isDestroyed: () => false })

    eventBus.sendToWebContents(10, 'wc:test', { ok: true })

    expect(mockFromId).toHaveBeenCalledWith(10)
    expect(send).toHaveBeenCalledWith('wc:test', { ok: true })
  })

  it('warns when web contents is missing or destroyed', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFromId.mockReturnValue(null)

    eventBus.sendToWebContents(999, 'wc:test', { ok: true })

    expect(warnSpy).toHaveBeenCalledWith(
      'WebContents 999 not found or destroyed, cannot send wc:test'
    )
    warnSpy.mockRestore()
  })

  it('broadcasts event to multiple web contents', () => {
    mockFromId.mockImplementation((id: number) => ({ send: vi.fn(), isDestroyed: () => false, id }))

    eventBus.broadcastToWebContents([1, 2, 3], 'wc:broadcast', { ok: true })

    expect(mockFromId).toHaveBeenCalledTimes(3)
    expect(mockFromId).toHaveBeenNthCalledWith(1, 1)
    expect(mockFromId).toHaveBeenNthCalledWith(2, 2)
    expect(mockFromId).toHaveBeenNthCalledWith(3, 3)
  })

  it('sends to active renderer in a window', () => {
    eventBus.setWindowPresenter(mockWindowPresenter)
    vi.mocked(mockWindowPresenter.sendToWindow).mockReturnValue(true)

    eventBus.sendToActiveTab(5, 'active:test', { ok: true })

    expect(mockWindowPresenter.sendToWindow).toHaveBeenCalledWith(5, 'active:test', { ok: true })
  })

  it('warns when active renderer is not found', () => {
    eventBus.setWindowPresenter(mockWindowPresenter)
    vi.mocked(mockWindowPresenter.sendToWindow).mockReturnValue(false)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    eventBus.sendToActiveTab(5, 'active:test', { ok: true })

    expect(warnSpy).toHaveBeenCalledWith('No active renderer found for window 5')
    warnSpy.mockRestore()
  })
})
