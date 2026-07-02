const HIGHLIGHT_SELECTOR = '[data-chat-search-match]'
const ACTIVE_HIGHLIGHT_SELECTOR = '[data-chat-search-active]'

export type ChatSearchMatch = HTMLElement
export type ChatSearchResult = {
  messageId: string
  matchIndex: number
}

const isIgnoredElement = (element: HTMLElement | null): boolean =>
  Boolean(
    element?.closest(
      'input, textarea, select, button, [contenteditable="true"], [data-chat-search-match]'
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
      if (!parentElement || isIgnoredElement(parentElement) || !isElementVisible(parentElement)) {
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
  })
}

export const applyChatSearchHighlights = (
  root: ParentNode | null | undefined,
  query: string
): ChatSearchMatch[] => {
  if (!root) {
    return []
  }

  clearChatSearchHighlights(root)

  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return []
  }

  const searchableNodes = collectSearchableTextNodes(root)
  searchableNodes.forEach((node) => {
    const value = node.nodeValue ?? ''
    const fragment = buildHighlightedFragment(value, normalizedQuery)
    if (!fragment || !node.parentNode) {
      return
    }

    node.parentNode.replaceChild(fragment, node)
  })

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

const collectUnknownText = (value: unknown, output: string[]): void => {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => collectUnknownText(item, output))
    return
  }

  const record = value as Record<string, unknown>
  for (const key of [
    'text',
    'content',
    'name',
    'params',
    'response',
    'server_name',
    'server_description',
    'tool_call'
  ]) {
    collectUnknownText(record[key], output)
  }
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
    collectUnknownText(message.content, chunks)
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
