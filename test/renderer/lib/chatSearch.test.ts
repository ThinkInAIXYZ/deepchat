import { describe, expect, it, vi } from 'vitest'

import {
  applyChatSearchHighlights,
  clearChatSearchHighlights,
  setActiveChatSearchMatch
} from '@/lib/chatSearch'

describe('chatSearch', () => {
  it('highlights case-insensitive matches and activates the selected one', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-content="true">
        <p>Alpha beta ALPHA</p>
        <div><span>gamma</span></div>
        <input value="alpha" />
      </div>
    `

    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })

    const matches = applyChatSearchHighlights(container, 'alpha')
    expect(matches).toHaveLength(2)
    expect(container.querySelectorAll('mark[data-chat-search-match="true"]')).toHaveLength(2)

    setActiveChatSearchMatch(matches, 1, { scroll: true, behavior: 'auto' })
    expect(matches[1].dataset.chatSearchActive).toBe('true')
    expect(matches[0].dataset.chatSearchActive).toBeUndefined()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('restores the original text when highlights are cleared', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-content="true">
        <p>Hello world, hello DeepChat</p>
      </div>
    `

    applyChatSearchHighlights(container, 'hello')
    clearChatSearchHighlights(container)

    expect(container.querySelectorAll('mark[data-chat-search-match="true"]')).toHaveLength(0)
    expect(container.textContent?.replace(/\s+/g, ' ').trim()).toBe('Hello world, hello DeepChat')
  })
})
