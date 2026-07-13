import { mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import SelectedTextContextMenu from '@/components/message/SelectedTextContextMenu.vue'

const contextMenuMock = vi.hoisted(() => ({
  translateListener: undefined as
    | ((payload: { text: string; x?: number; y?: number }) => void)
    | undefined,
  askAiListener: undefined as ((payload: { text: string }) => void) | undefined,
  cleanupTranslate: vi.fn(),
  cleanupAskAi: vi.fn()
}))

vi.mock('@api/ContextMenuClient', () => ({
  createContextMenuClient: () => ({
    onTranslateRequested: vi.fn(
      (listener: (payload: { text: string; x?: number; y?: number }) => void) => {
        contextMenuMock.translateListener = listener
        return contextMenuMock.cleanupTranslate
      }
    ),
    onAskAiRequested: vi.fn((listener: (payload: { text: string }) => void) => {
      contextMenuMock.askAiListener = listener
      return contextMenuMock.cleanupAskAi
    })
  })
}))

describe('SelectedTextContextMenu', () => {
  beforeEach(() => {
    contextMenuMock.translateListener = undefined
    contextMenuMock.askAiListener = undefined
    contextMenuMock.cleanupTranslate.mockClear()
    contextMenuMock.cleanupAskAi.mockClear()
  })

  it('forwards typed translate requests as the existing window event', () => {
    const listener = vi.fn()
    window.addEventListener('context-menu-translate-text', listener)
    const wrapper = mount(SelectedTextContextMenu)

    contextMenuMock.translateListener?.({
      text: 'hello',
      x: 12,
      y: 34
    })

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual({
      text: 'hello',
      x: 12,
      y: 34
    })

    window.removeEventListener('context-menu-translate-text', listener)
    wrapper.unmount()
  })

  it('forwards typed ask-AI requests as the existing window event and cleans up listeners', () => {
    const listener = vi.fn()
    window.addEventListener('context-menu-ask-ai', listener)
    const wrapper = mount(SelectedTextContextMenu)

    contextMenuMock.askAiListener?.({
      text: 'explain this'
    })

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toBe('explain this')

    wrapper.unmount()

    expect(contextMenuMock.cleanupTranslate).toHaveBeenCalledTimes(1)
    expect(contextMenuMock.cleanupAskAi).toHaveBeenCalledTimes(1)
    window.removeEventListener('context-menu-ask-ai', listener)
  })
})
