import { describe, expect, it, vi } from 'vitest'

import {
  applyChatSearchHighlights,
  collectChatSearchResults,
  clearChatSearchHighlights,
  setActiveChatSearchResult,
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
    expect(container.getAttribute('data-chat-search-query')).toBeNull()
  })

  it('does not clear existing marks when re-applying the same query', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-id="m1" data-message-content="true">
        <p>Alpha beta</p>
      </div>
    `

    applyChatSearchHighlights(container, 'alpha')
    const firstMarks = container.querySelectorAll('mark[data-chat-search-match="true"]')
    expect(firstMarks).toHaveLength(1)
    const firstMarkNode = firstMarks[0]

    // Simulate a newly mounted virtual-list row while the query is unchanged.
    const nextRow = document.createElement('div')
    nextRow.dataset.messageId = 'm2'
    nextRow.dataset.messageContent = 'true'
    nextRow.innerHTML = '<p>more alpha text</p>'
    container.appendChild(nextRow)

    applyChatSearchHighlights(container, 'alpha')

    const marks = container.querySelectorAll('mark[data-chat-search-match="true"]')
    expect(marks).toHaveLength(2)
    // Existing mark node is kept (no clear+rebuild flicker on that subtree).
    expect(container.contains(firstMarkNode)).toBe(true)
    expect(container.getAttribute('data-chat-search-query')).toBe('alpha')
  })

  it('rebuilds marks when the query changes', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-content="true">
        <p>Alpha beta gamma</p>
      </div>
    `

    applyChatSearchHighlights(container, 'alpha')
    expect(container.querySelectorAll('mark[data-chat-search-match="true"]')).toHaveLength(1)

    applyChatSearchHighlights(container, 'beta')
    const marks = container.querySelectorAll('mark[data-chat-search-match="true"]')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.textContent).toBe('beta')
    expect(container.getAttribute('data-chat-search-query')).toBe('beta')
  })

  it('ignores matches inside hidden message content', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-content="true">
        <p>hi</p>
        <p>Hi there!</p>
        <div style="display: none;">
          <p>thinking hi</p>
        </div>
      </div>
    `

    const matches = applyChatSearchHighlights(container, 'hi')

    expect(matches).toHaveLength(2)
    expect(matches.map((match) => match.textContent)).toEqual(['hi', 'Hi'])
    expect(container.querySelectorAll('mark[data-chat-search-match="true"]')).toHaveLength(2)
  })

  it('counts message matches from data and activates the matching rendered row only', () => {
    const results = collectChatSearchResults(
      [
        { id: 'm1', content: { text: 'alpha beta alpha' } },
        {
          id: 'm2',
          content: [{ type: 'content', content: 'gamma alpha' }]
        },
        {
          id: 'm3',
          content: [
            {
              type: 'tool_call',
              tool_call: {
                name: 'search',
                params: '{"query":"alpha"}',
                response: 'tool alpha result'
              }
            }
          ]
        }
      ],
      'alpha'
    )
    expect(results).toEqual([
      { messageId: 'm1', matchIndex: 0 },
      { messageId: 'm1', matchIndex: 1 },
      { messageId: 'm2', matchIndex: 0 },
      { messageId: 'm3', matchIndex: 0 },
      { messageId: 'm3', matchIndex: 1 }
    ])

    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-id="m2">
        <p>gamma alpha</p>
      </div>
    `
    applyChatSearchHighlights(container, 'alpha')

    expect(setActiveChatSearchResult(container, results[0], { scroll: false })).toBeNull()
    const active = setActiveChatSearchResult(container, results[2], { scroll: false })

    expect(active?.textContent).toBe('alpha')
    expect(active?.dataset.chatSearchActive).toBe('true')
  })
})
