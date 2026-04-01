const HIGHLIGHT_SELECTOR = '[data-chat-search-match]'
const ACTIVE_HIGHLIGHT_SELECTOR = '[data-chat-search-active]'

export type ChatSearchMatch = HTMLElement

const isEditableElement = (element: HTMLElement | null): boolean =>
  Boolean(
    element?.closest(
      'input, textarea, select, button, [contenteditable="true"], [data-chat-search-match]'
    )
  )

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
      if (!parentElement || isEditableElement(parentElement)) {
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
      behavior: options.behavior ?? 'smooth'
    })
  }

  return activeMatch
}
