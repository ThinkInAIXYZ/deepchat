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

  it('coalesces observer updates and cancels scheduled work when clearing highlights', async () => {
    vi.useFakeTimers()
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
    const container = document.createElement('div')
    container.innerHTML = '<div data-message-id="m1"><p>alpha</p></div>'

    applyChatSearchHighlights(container, 'alpha')
    const row = container.querySelector<HTMLElement>('[data-message-id="m1"]')
    if (!row) throw new Error('Expected message row')

    row.querySelector('p')!.textContent = 'alpha one'
    row.querySelector('p')!.textContent = 'alpha two'
    await Promise.resolve()

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
    clearChatSearchHighlights(container)
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20)

    expect(container.querySelectorAll('mark[data-chat-search-match="true"]')).toHaveLength(0)
    expect(container.textContent).toBe('alpha two')
  })

  it('highlights newly mounted message rows without rescanning existing rows', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-id="m1"><p>alpha</p></div>
      <div data-message-id="m2"><p>alpha</p></div>
    `

    applyChatSearchHighlights(container, 'alpha')
    const existingRow = container.querySelector<HTMLElement>('[data-message-id="m1"]')
    expect(existingRow?.getAttribute('data-chat-search-highlighted-query')).toBe('alpha')

    const existingText = existingRow?.querySelector('p')?.firstChild
    if (!existingText) throw new Error('Expected existing row text')
    existingText.textContent = 'alpha updated without remounting'

    const nextRow = document.createElement('div')
    nextRow.dataset.messageId = 'm3'
    nextRow.innerHTML = '<p>alpha newly mounted</p>'
    container.appendChild(nextRow)

    applyChatSearchHighlights(container, 'alpha')
    await vi.advanceTimersByTimeAsync(20)

    expect(existingRow?.querySelectorAll('mark')).toHaveLength(1)
    expect(nextRow.querySelectorAll('mark')).toHaveLength(1)
  })

  it('refreshes a mounted row when its text changes without duplicating stale marks', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-id="m1"><p>alpha</p></div>
    `

    applyChatSearchHighlights(container, 'alpha')
    const row = container.querySelector<HTMLElement>('[data-message-id="m1"]')
    const paragraph = row?.querySelector('p')
    if (!paragraph) throw new Error('Expected message content')

    // Vue commonly patches the existing message subtree instead of remounting its row.
    paragraph.textContent = 'alpha updated with alpha'
    await vi.advanceTimersByTimeAsync(20)

    const marks = row.querySelectorAll('mark[data-chat-search-match="true"]')
    expect(marks).toHaveLength(2)
    expect(Array.from(marks, (mark) => mark.textContent)).toEqual(['alpha', 'alpha'])
    expect(row.textContent).toBe('alpha updated with alpha')

    await vi.advanceTimersByTimeAsync(20)
    expect(row.querySelectorAll('mark[data-chat-search-match="true"]')).toHaveLength(2)
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

  it('counts only content that the DOM highlighter can activate', () => {
    const results = collectChatSearchResults(
      [
        {
          id: 'm1',
          content: [
            { type: 'content', content: 'visible alpha' },
            { type: 'plan', content: 'hidden alpha' },
            {
              type: 'tool_call',
              tool_call: { name: 'search', params: '{"query":"alpha"}', response: 'alpha result' }
            }
          ]
        },
        { id: 'm2', content: { text: 'user alpha', persistenceOnly: 'alpha' } }
      ],
      ' alpha '
    )

    expect(results).toEqual([
      { messageId: 'm1', matchIndex: 0 },
      { messageId: 'm2', matchIndex: 0 }
    ])
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
      { messageId: 'm2', matchIndex: 0 }
    ])

    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-id="m2">
        <p>gamma alpha</p>
      </div>
      <div data-message-id="m3">
        <button>search alpha</button>
        <div aria-hidden="true">tool alpha result</div>
      </div>
    `
    applyChatSearchHighlights(container, 'alpha')

    expect(container.querySelectorAll('mark[data-chat-search-match="true"]')).toHaveLength(1)
    expect(setActiveChatSearchResult(container, results[0], { scroll: false })).toBeNull()
    const active = setActiveChatSearchResult(container, results[2], { scroll: false })

    expect(active?.textContent).toBe('alpha')
    expect(active?.dataset.chatSearchActive).toBe('true')
  })

  it('keeps rows with pending observer work highlighted across a same-query re-apply', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    container.innerHTML = '<div data-message-id="m1"><p>alpha</p></div>'

    applyChatSearchHighlights(container, 'alpha')
    const row = container.querySelector<HTMLElement>('[data-message-id="m1"]')
    const paragraph = row?.querySelector('p')
    if (!row || !paragraph) throw new Error('Expected message row')

    // In-place patch and same-query re-apply in the same task (e.g. streaming
    // update plus a virtual-window shift): rebuilding the observer must not
    // drop the row's still-undelivered mutation records.
    paragraph.textContent = 'alpha updated with alpha'
    applyChatSearchHighlights(container, 'alpha')
    await vi.advanceTimersByTimeAsync(40)

    const marks = row.querySelectorAll('mark[data-chat-search-match="true"]')
    expect(marks).toHaveLength(2)
    expect(row.textContent).toBe('alpha updated with alpha')
  })

  it('indexes user message text exactly as the rendered body exposes it', () => {
    const results = collectChatSearchResults(
      [
        {
          id: 'm1',
          content: {
            text: 'raw alpha',
            files: [],
            links: [],
            search: false,
            think: false,
            activeSkills: ['standalone alpha'],
            content: [
              { type: 'text', content: 'visible ' },
              { type: 'mention', category: 'prompts', id: 'alpha-prompt', content: 'raw mention' },
              { type: 'code', content: 'alpha code', language: 'text' }
            ]
          }
        },
        {
          id: 'm2',
          content: {
            text: 'before after',
            files: [],
            links: [],
            search: false,
            think: false,
            inlineItems: [{ type: 'skill', offset: 7, skillName: 'alpha-skill' }]
          }
        }
      ],
      'alpha'
    )

    expect(results).toEqual([
      { messageId: 'm1', matchIndex: 0 },
      { messageId: 'm1', matchIndex: 1 },
      { messageId: 'm2', matchIndex: 0 }
    ])
  })

  it('does not highlight text marked outside a message body as non-searchable', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-message-id="m1">
        <span data-chat-search-exclude="true">excluded alpha</span>
        <div data-message-content="true">visible alpha</div>
      </div>
    `

    const matches = applyChatSearchHighlights(container, 'alpha')

    expect(matches).toHaveLength(1)
    expect(matches[0]?.parentElement?.textContent).toBe('visible alpha')
  })

  it('does not double count user messages carrying both text and rendered blocks', () => {
    const results = collectChatSearchResults(
      [
        {
          id: 'm1',
          content: {
            text: 'user alpha',
            content: [{ type: 'text', content: 'user alpha' }]
          }
        },
        {
          id: 'm2',
          content: {
            text: 'irrelevant',
            content: [
              { type: 'text', content: 'see ' },
              { type: 'mention', category: 'prompts', id: 'alpha-prompt', content: 'raw' }
            ]
          }
        }
      ],
      'alpha'
    )

    expect(results).toEqual([
      { messageId: 'm1', matchIndex: 0 },
      { messageId: 'm2', matchIndex: 0 }
    ])
  })
})
