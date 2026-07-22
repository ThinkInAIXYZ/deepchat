import type { DisplayUserMessageContent } from '@/features/chat-page/model/displayMessage'
import {
  getVisibleMentionLabel,
  getVisibleUserContentBlocks
} from '@/features/chat-page/model/displayUserMessageText'

const HIGHLIGHT_SELECTOR = '[data-chat-search-match]'
const ACTIVE_HIGHLIGHT_SELECTOR = '[data-chat-search-active]'
const HIGHLIGHTED_QUERY_ATTRIBUTE = 'data-chat-search-highlighted-query'
const MESSAGE_ROW_SELECTOR = '[data-message-id]'
type HighlightObserverState = {
  observer: MutationObserver
  frame: number | null
  rowsToRefresh: Set<HTMLElement>
  isApplyingHighlights: boolean
}

const highlightedRowObservers = new WeakMap<ParentNode, HighlightObserverState>()

export type ChatSearchMatch = HTMLElement
export type ChatSearchResult = {
  messageId: string
  matchIndex: number
}

const isIgnoredElement = (element: HTMLElement | null): boolean =>
  Boolean(
    element?.closest(
      'input, textarea, select, button, [contenteditable="true"], [data-chat-search-exclude], [data-chat-search-match]'
    )
  )

const isElementVisible = (element: HTMLElement | null): boolean => {
  let currentElement = element

  while (currentElement) {
    if (currentElement.hidden || currentElement.getAttribute('aria-hidden') === 'true') {
      return false
    }

    const style = window.getComputedStyle(currentElement)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.contentVisibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false
    }

    currentElement = currentElement.parentElement
  }

  return true
}

const isInsideSearchableMessageContent = (element: HTMLElement): boolean => {
  const row = element.closest<HTMLElement>(MESSAGE_ROW_SELECTOR)
  if (!row) {
    return true
  }

  // Components in older/unit-test rows may omit the body marker. In real message
  // rows, it excludes author/timestamp chrome so data indexing and DOM marks stay
  // in the same order.
  return (
    !row.querySelector('[data-message-content]') ||
    Boolean(element.closest('[data-message-content]'))
  )
}

const collectSearchableTextNodes = (root: ParentNode): Text[] => {
  if (typeof document === 'undefined') {
    return []
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) {
        return NodeFilter.FILTER_REJECT
      }

      if (!node.nodeValue?.trim()) {
        return NodeFilter.FILTER_REJECT
      }

      const parentElement = node.parentElement
      if (
        !parentElement ||
        isIgnoredElement(parentElement) ||
        !isElementVisible(parentElement) ||
        !isInsideSearchableMessageContent(parentElement)
      ) {
        return NodeFilter.FILTER_REJECT
      }

      return NodeFilter.FILTER_ACCEPT
    }
  })

  const nodes: Text[] = []
  let currentNode = walker.nextNode()
  while (currentNode) {
    if (currentNode instanceof Text) {
      nodes.push(currentNode)
    }
    currentNode = walker.nextNode()
  }

  return nodes
}

const getRowsToHighlight = (
  root: ParentNode,
  query: string,
  isSameQuery: boolean
): ParentNode[] => {
  if (!isSameQuery) {
    return [root]
  }

  if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) {
    return []
  }

  const rows = Array.from(root.querySelectorAll<HTMLElement>(MESSAGE_ROW_SELECTOR))
  if (rows.length === 0) {
    return [root]
  }

  return rows.filter((row) => row.getAttribute(HIGHLIGHTED_QUERY_ATTRIBUTE) !== query)
}

const markRowsHighlighted = (roots: ParentNode[], query: string): void => {
  roots.forEach((root) => {
    if (root instanceof HTMLElement && root.matches(MESSAGE_ROW_SELECTOR)) {
      root.setAttribute(HIGHLIGHTED_QUERY_ATTRIBUTE, query)
      return
    }

    if (
      !(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)
    ) {
      return
    }

    root.querySelectorAll<HTMLElement>(MESSAGE_ROW_SELECTOR).forEach((row) => {
      row.setAttribute(HIGHLIGHTED_QUERY_ATTRIBUTE, query)
    })
  })
}

const clearHighlightedRowMarkers = (root: ParentNode): void => {
  if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) {
    return
  }

  root.querySelectorAll<HTMLElement>(`[${HIGHLIGHTED_QUERY_ATTRIBUTE}]`).forEach((row) => {
    row.removeAttribute(HIGHLIGHTED_QUERY_ATTRIBUTE)
  })
}

const stopHighlightObserver = (root: ParentNode): void => {
  const state = highlightedRowObservers.get(root)
  if (!state) return

  state.observer.disconnect()
  if (state.frame !== null) {
    window.cancelAnimationFrame(state.frame)
  }
  highlightedRowObservers.delete(root)
}

const getMessageRow = (node: Node): HTMLElement | null => {
  const element = node instanceof HTMLElement ? node : node.parentElement
  return element?.closest<HTMLElement>(MESSAGE_ROW_SELECTOR) ?? null
}

const clearHighlightsInRoot = (root: ParentNode): void => {
  root.querySelectorAll<HTMLElement>(HIGHLIGHT_SELECTOR).forEach((highlight) => {
    const parent = highlight.parentNode
    if (!parent) {
      return
    }

    parent.replaceChild(document.createTextNode(highlight.textContent ?? ''), highlight)
    parent.normalize()
  })
}

// A same-query re-apply tears the observer down before its pending refresh runs,
// yet those rows still carry the highlighted-query marker and would be skipped
// by every future same-query scan. Strip their marks and markers first so the
// caller's rescan rebuilds them.
const drainHighlightObserver = (root: ParentNode): void => {
  const state = highlightedRowObservers.get(root)
  if (!state) return

  const pendingRows = new Set(state.rowsToRefresh)
  state.observer.takeRecords().forEach((record) => {
    const row = getMessageRow(record.target)
    if (row) {
      pendingRows.add(row)
    }
  })
  stopHighlightObserver(root)
  pendingRows.forEach((row) => {
    clearHighlightsInRoot(row)
    row.removeAttribute(HIGHLIGHTED_QUERY_ATTRIBUTE)
  })
}

const highlightRow = (row: HTMLElement, query: string): void => {
  clearHighlightsInRoot(row)
  row.removeAttribute(HIGHLIGHTED_QUERY_ATTRIBUTE)

  collectSearchableTextNodes(row).forEach((node) => {
    const fragment = buildHighlightedFragment(node.nodeValue ?? '', query)
    if (fragment && node.parentNode) {
      node.parentNode.replaceChild(fragment, node)
    }
  })

  row.setAttribute(HIGHLIGHTED_QUERY_ATTRIBUTE, query)
}

const observeHighlightedRows = (root: ParentNode, query: string): void => {
  if (!(root instanceof HTMLElement) || typeof MutationObserver === 'undefined') {
    return
  }

  stopHighlightObserver(root)
  let state: HighlightObserverState
  const scheduleRefresh = () => {
    if (state.frame !== null) return

    state.frame = window.requestAnimationFrame(() => {
      state.frame = null
      if (state.isApplyingHighlights || getAppliedSearchQuery(root) !== query) {
        state.rowsToRefresh.clear()
        return
      }

      const rows = Array.from(state.rowsToRefresh)
      state.rowsToRefresh.clear()
      state.isApplyingHighlights = true
      try {
        rows.forEach((row) => highlightRow(row, query))
        // MutationObserver callbacks run after this task. Drain mutations made by our
        // own mark replacement before dropping the guard so they cannot enqueue work.
        observer.takeRecords()
      } finally {
        state.isApplyingHighlights = false
      }
    })
  }
  const observer = new MutationObserver((records) => {
    if (state.isApplyingHighlights || getAppliedSearchQuery(root) !== query) {
      return
    }

    records.forEach((record) => {
      const targetRow = getMessageRow(record.target)
      if (targetRow) {
        state.rowsToRefresh.add(targetRow)
      }

      record.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return
        if (node.matches(MESSAGE_ROW_SELECTOR)) {
          if (node.getAttribute(HIGHLIGHTED_QUERY_ATTRIBUTE) !== query) {
            state.rowsToRefresh.add(node)
          }
          return
        }
        node.querySelectorAll<HTMLElement>(MESSAGE_ROW_SELECTOR).forEach((row) => {
          if (row.getAttribute(HIGHLIGHTED_QUERY_ATTRIBUTE) !== query) {
            state.rowsToRefresh.add(row)
          }
        })
      })
    })

    if (state.rowsToRefresh.size > 0) {
      scheduleRefresh()
    }
  })

  state = {
    observer,
    frame: null,
    rowsToRefresh: new Set(),
    isApplyingHighlights: false
  }
  observer.observe(root, { childList: true, characterData: true, subtree: true })
  highlightedRowObservers.set(root, state)
}

const buildHighlightedFragment = (value: string, query: string): DocumentFragment | null => {
  const fragment = document.createDocumentFragment()
  const lowerValue = value.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let searchIndex = 0
  let matchIndex = lowerValue.indexOf(lowerQuery)
  let hasMatch = false

  while (matchIndex !== -1) {
    hasMatch = true

    if (matchIndex > searchIndex) {
      fragment.appendChild(document.createTextNode(value.slice(searchIndex, matchIndex)))
    }

    const highlight = document.createElement('mark')
    highlight.dataset.chatSearchMatch = 'true'
    highlight.className = 'chat-search-highlight'
    highlight.textContent = value.slice(matchIndex, matchIndex + query.length)
    fragment.appendChild(highlight)

    searchIndex = matchIndex + query.length
    matchIndex = lowerValue.indexOf(lowerQuery, searchIndex)
  }

  if (!hasMatch) {
    return null
  }

  if (searchIndex < value.length) {
    fragment.appendChild(document.createTextNode(value.slice(searchIndex)))
  }

  return fragment
}

const getSearchRootElement = (root: ParentNode | null | undefined): Element | null => {
  if (!root) return null
  if (root instanceof Element) return root
  if (root instanceof Document) return root.documentElement
  if (root instanceof DocumentFragment) {
    return root.querySelector('[data-chat-search-root]') ?? null
  }
  return null
}

const setAppliedSearchQuery = (root: ParentNode, query: string | null): void => {
  const element = getSearchRootElement(root)
  if (!element) return
  if (query === null || query === '') {
    element.removeAttribute('data-chat-search-query')
    return
  }
  element.setAttribute('data-chat-search-query', query)
}

const getAppliedSearchQuery = (root: ParentNode): string | null => {
  const element = getSearchRootElement(root)
  return element?.getAttribute('data-chat-search-query') ?? null
}

export const clearChatSearchHighlights = (root: ParentNode | null | undefined): void => {
  if (!root) {
    return
  }

  const highlights = root.querySelectorAll<HTMLElement>(HIGHLIGHT_SELECTOR)
  highlights.forEach((highlight) => {
    const parent = highlight.parentNode
    if (!parent) {
      return
    }

    parent.replaceChild(document.createTextNode(highlight.textContent ?? ''), highlight)
    parent.normalize()
  })

  root.querySelectorAll<HTMLElement>(ACTIVE_HIGHLIGHT_SELECTOR).forEach((highlight) => {
    highlight.removeAttribute('data-chat-search-active')
    highlight.classList.remove('chat-search-highlight--active')
  })

  clearHighlightedRowMarkers(root)
  stopHighlightObserver(root)
  setAppliedSearchQuery(root, null)
}

export const applyChatSearchHighlights = (
  root: ParentNode | null | undefined,
  query: string
): ChatSearchMatch[] => {
  if (!root) {
    return []
  }

  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    clearChatSearchHighlights(root)
    return []
  }

  // Same query: retain existing marks and walk only virtual-list rows that were
  // mounted since their last highlight pass. This avoids scanning the entire
  // visible message tree on every window shift.
  const appliedQuery = getAppliedSearchQuery(root)
  const isSameQuery = appliedQuery === normalizedQuery
  if (appliedQuery !== null && !isSameQuery) {
    clearChatSearchHighlights(root)
  } else if (isSameQuery) {
    drainHighlightObserver(root)
  }

  const rootsToHighlight = getRowsToHighlight(root, normalizedQuery, isSameQuery)
  rootsToHighlight.forEach((highlightRoot) => {
    const searchableNodes = collectSearchableTextNodes(highlightRoot)
    searchableNodes.forEach((node) => {
      const value = node.nodeValue ?? ''
      const fragment = buildHighlightedFragment(value, normalizedQuery)
      if (!fragment || !node.parentNode) {
        return
      }

      node.parentNode.replaceChild(fragment, node)
    })
  })

  markRowsHighlighted(rootsToHighlight, normalizedQuery)
  setAppliedSearchQuery(root, normalizedQuery)
  observeHighlightedRows(root, normalizedQuery)
  return Array.from(root.querySelectorAll<HTMLElement>(HIGHLIGHT_SELECTOR))
}

const countOccurrences = (value: string, query: string): number => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return 0

  const normalizedValue = value.toLowerCase()
  let count = 0
  let index = normalizedValue.indexOf(normalizedQuery)
  while (index !== -1) {
    count += 1
    index = normalizedValue.indexOf(normalizedQuery, index + normalizedQuery.length)
  }
  return count
}

const isDisplayUserMessageContent = (content: unknown): content is DisplayUserMessageContent => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return false
  }

  const value = content as Record<string, unknown>
  return typeof value.text === 'string'
}

const appendDisplayContentText = (content: unknown, output: string[]): void => {
  if (!content || typeof content !== 'object') return

  if (Array.isArray(content)) {
    content.forEach((block) => {
      if (!block || typeof block !== 'object') return
      const record = block as Record<string, unknown>
      const extra = record.extra as Record<string, unknown> | undefined
      // Tool-call labels live in ignored buttons and their details are collapsed and
      // aria-hidden by default, so indexing them would create non-activatable results.
      if (record.type === 'plan' || record.type === 'tool_call' || extra?.internalTool === true) {
        return
      }
      if (typeof record.content === 'string') {
        output.push(record.content)
      }
    })
    return
  }

  if (!isDisplayUserMessageContent(content)) {
    return
  }

  // Use the same block projection MessageItemUser renders. This deliberately
  // excludes standalone attachment/skill metadata, which is outside the
  // message body and marked as non-searchable for the DOM highlighter.
  const visibleBlocks = getVisibleUserContentBlocks(content)
  if (visibleBlocks.length === 0) {
    output.push(content.text)
    return
  }

  visibleBlocks.forEach((block) => {
    if (block.type === 'mention') {
      output.push(getVisibleMentionLabel(block))
    } else if (block.type === 'skill') {
      output.push(block.skillName)
    } else if (block.type === 'file') {
      output.push(block.fileName)
    } else {
      output.push(block.content)
    }
  })
}

export const collectChatSearchResults = (
  messages: Array<{ id: string; content: unknown }>,
  query: string
): ChatSearchResult[] => {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const results: ChatSearchResult[] = []
  for (const message of messages) {
    const chunks: string[] = []
    appendDisplayContentText(message.content, chunks)
    let matchIndex = 0
    for (const chunk of chunks) {
      const count = countOccurrences(chunk, normalizedQuery)
      for (let index = 0; index < count; index += 1) {
        results.push({ messageId: message.id, matchIndex })
        matchIndex += 1
      }
    }
  }
  return results
}

export const setActiveChatSearchResult = (
  root: ParentNode | null | undefined,
  target: ChatSearchResult | null,
  options: { scroll?: boolean; behavior?: ScrollBehavior } = {}
): ChatSearchMatch | null => {
  if (!root || !target) return null

  const matches = Array.from(root.querySelectorAll<HTMLElement>(HIGHLIGHT_SELECTOR))
  const seenByMessageId = new Map<string, number>()
  let activeMatch: ChatSearchMatch | null = null

  for (const match of matches) {
    const row = match.closest<HTMLElement>('[data-message-id]')
    const messageId = row?.dataset.messageId
    const indexInMessage = messageId ? (seenByMessageId.get(messageId) ?? 0) : -1
    if (messageId) {
      seenByMessageId.set(messageId, indexInMessage + 1)
    }

    const isActive = messageId === target.messageId && indexInMessage === target.matchIndex
    if (isActive) {
      match.dataset.chatSearchActive = 'true'
      match.classList.add('chat-search-highlight--active')
      activeMatch = match
    } else {
      match.removeAttribute('data-chat-search-active')
      match.classList.remove('chat-search-highlight--active')
    }
  }

  if (activeMatch && options.scroll !== false) {
    activeMatch.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: options.behavior ?? 'auto'
    })
  }

  return activeMatch
}

export const setActiveChatSearchMatch = (
  matches: ChatSearchMatch[],
  index: number,
  options: { scroll?: boolean; behavior?: ScrollBehavior } = {}
): ChatSearchMatch | null => {
  matches.forEach((match, matchIndex) => {
    if (matchIndex === index) {
      match.dataset.chatSearchActive = 'true'
      match.classList.add('chat-search-highlight--active')
    } else {
      match.removeAttribute('data-chat-search-active')
      match.classList.remove('chat-search-highlight--active')
    }
  })

  const activeMatch = matches[index] ?? null
  if (activeMatch && options.scroll !== false) {
    activeMatch.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: options.behavior ?? 'auto'
    })
  }

  return activeMatch
}
