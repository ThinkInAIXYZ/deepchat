import katex from 'katex'
import {
  getMarkdown,
  isHtmlTagBlocked,
  parseMarkdownToStructure,
  sanitizeHtmlAttrs,
  sanitizeHtmlContent,
  type ParsedNode
} from 'markstream-vue'
import { generatePart } from '@/composables/useArtifacts'
import { normalizeMarkstreamCodeFenceLanguages } from '@/lib/markstreamLanguage'
import type {
  DisplayAssistantMessageBlock,
  DisplayUserMessageContent
} from '@/features/chat-page/model/displayMessage'
import { getReferencePathLabels } from '@shared/messageInlineItems'
import {
  getVisibleMentionLabel,
  getVisibleUserContentBlocks
} from '@/features/chat-page/model/displayUserMessageText'

const HIGHLIGHT_SELECTOR = '[data-chat-search-match]'
const ACTIVE_HIGHLIGHT_SELECTOR = '[data-chat-search-active]'
const HIGHLIGHTED_QUERY_ATTRIBUTE = 'data-chat-search-highlighted-query'
const MESSAGE_ROW_SELECTOR = '[data-message-id]'
const MARKDOWN_BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, td, th, pre, dt, dd, [data-markstream-math], .admonition-title'
const MARKDOWN_CHROME_SELECTOR =
  '.code-header-main, .code-header-title, .code-header-caption, .code-diff-stats, .mermaid-block-header, .footnote-reference, .footnote-anchor, .math-inline__loading, .math-loading-overlay, .katex-mathml'
const continuationHighlights = new WeakSet<HTMLElement>()
const highlightParts = new WeakMap<HTMLElement, HTMLElement[]>()
type HighlightObserverState = {
  observer: MutationObserver
  frame: number | null
  rowsToRefresh: Set<HTMLElement>
  isApplyingHighlights: boolean
}

const highlightedRowObservers = new WeakMap<ParentNode, HighlightObserverState>()

// A match spanning inline elements is represented by its first mark.
export type ChatSearchMatch = HTMLElement
export type ChatSearchResult = {
  messageId: string
  matchIndex: number
}

const isIgnoredElement = (element: Element | null): boolean => {
  if (
    element?.closest(
      'input, textarea, select, [contenteditable="true"], [data-chat-search-exclude], [data-chat-search-match]'
    )
  )
    return true
  if (element?.closest('.markdown-renderer-root') && element.closest(MARKDOWN_CHROME_SELECTOR)) {
    return true
  }
  const button = element?.closest('button')
  // Only message labels opt in. Tool/action buttons and composer controls stay excluded.
  return Boolean(button && !button.contains(element?.closest('[data-chat-search-text]') ?? null))
}

const isElementVisible = (element: HTMLElement | null): boolean => {
  let currentElement = element

  while (currentElement) {
    // KaTeX hides the visual copy from assistive technology when it also renders
    // MathML. Search only the visual copy, not its duplicate accessible markup.
    if (
      currentElement.matches('details:not([open])') &&
      !currentElement.querySelector(':scope > summary')?.contains(element)
    ) {
      return false
    }
    const visibleKatex =
      currentElement.classList.contains('katex-html') &&
      currentElement.closest('[data-markstream-math]')
    if (
      currentElement.hidden ||
      (currentElement.getAttribute('aria-hidden') === 'true' && !visibleKatex)
    ) {
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

const collectSearchableTextNodes = (root: ParentNode): Array<Text | HTMLBRElement> => {
  if (typeof document === 'undefined') {
    return []
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof Text || node instanceof HTMLBRElement)) {
        return NodeFilter.FILTER_SKIP
      }

      const parentElement = node instanceof Text ? node.parentElement : node
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

  const nodes: Array<Text | HTMLBRElement> = []
  let currentNode = walker.nextNode()
  while (currentNode) {
    if (currentNode instanceof Text || currentNode instanceof HTMLBRElement) {
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

  highlightSearchableText(row, query)

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

type SearchRange = { start: number; end: number }

const findSearchRanges = (value: string, lowerQuery: string): SearchRange[] => {
  const lowerValue = value.toLowerCase()
  let index = lowerValue.indexOf(lowerQuery)
  if (index === -1) return []

  // toLowerCase() can expand a character (e.g. İ becomes i + combining dot).
  // Match folded text, but mark the original UTF-16 offsets.
  let offsets: SearchRange[] | undefined
  if (lowerValue.length !== value.length) {
    offsets = []
    let original = 0
    for (const character of value) {
      const span = { start: original, end: original + character.length }
      const foldedWidth = character.toLowerCase().length
      for (let unit = 0; unit < foldedWidth; unit += 1) {
        // Keep code-unit positions for unchanged-width characters.
        offsets.push(
          foldedWidth === character.length
            ? { start: original + unit, end: original + unit + 1 }
            : span
        )
      }
      original = span.end
    }
  }

  const ranges: SearchRange[] = []
  while (index !== -1) {
    const end = index + lowerQuery.length
    const startInOriginal = offsets?.[index]?.start ?? index
    const endInOriginal = offsets?.[end - 1]?.end ?? end
    if (startInOriginal >= (ranges.at(-1)?.end ?? 0)) {
      ranges.push({ start: startInOriginal, end: endInOriginal })
    }
    index = lowerValue.indexOf(lowerQuery, end)
  }
  return ranges
}

const highlightTextGroup = (nodes: Text[], lowerQuery: string): void => {
  const ranges = findSearchRanges(nodes.map((node) => node.data).join(''), lowerQuery)
  if (!ranges.length) return

  const parts: HTMLElement[][] = ranges.map(() => [])
  let rangeIndex = 0
  let nodeOffset = 0
  for (const node of nodes) {
    const endOffset = nodeOffset + node.data.length
    let fragment: DocumentFragment | undefined
    let offset = 0
    while (rangeIndex < ranges.length && ranges[rangeIndex].start < endOffset) {
      const range = ranges[rangeIndex]
      const start = Math.max(range.start - nodeOffset, 0)
      const end = Math.min(range.end - nodeOffset, node.data.length)
      if (start < end) {
        fragment ??= document.createDocumentFragment()
        if (offset < start) fragment.append(node.data.slice(offset, start))

        const mark = document.createElement('mark')
        mark.dataset.chatSearchMatch = 'true'
        mark.className = 'chat-search-highlight'
        mark.textContent = node.data.slice(start, end)
        parts[rangeIndex].push(mark)
        fragment.append(mark)
        offset = end
      }
      if (range.end > endOffset) break
      rangeIndex += 1
    }
    if (fragment) {
      if (offset < node.data.length) fragment.append(node.data.slice(offset))
      node.parentNode?.replaceChild(fragment, node)
    }
    nodeOffset = endOffset
  }

  for (const [first, ...rest] of parts) {
    if (first && rest.length) {
      highlightParts.set(first, rest)
      rest.forEach((mark) => continuationHighlights.add(mark))
    }
  }
}

const highlightSearchableText = (root: ParentNode, query: string): void => {
  const lowerQuery = query.toLowerCase()
  let group: Text[] = []
  let previousBlock: Element | null = null
  const flush = () => {
    if (group.length) highlightTextGroup(group, lowerQuery)
    group = []
  }

  for (const node of collectSearchableTextNodes(root)) {
    if (node instanceof HTMLBRElement) {
      flush()
      previousBlock = null
      continue
    }

    const parent = node.parentElement
    const block = parent?.closest('.markdown-renderer-root')
      ? parent.closest(MARKDOWN_BLOCK_SELECTOR)
      : null
    if (!block || block !== previousBlock) flush()
    if (node.data.trim() || (block && node.data.length)) group.push(node)
    previousBlock = block
  }
  flush()
}

const getSearchMatches = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(HIGHLIGHT_SELECTOR)).filter(
    (mark) => !continuationHighlights.has(mark)
  )

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
  rootsToHighlight.forEach((highlightRoot) =>
    highlightSearchableText(highlightRoot, normalizedQuery)
  )

  markRowsHighlighted(rootsToHighlight, normalizedQuery)
  setAppliedSearchQuery(root, normalizedQuery)
  observeHighlightedRows(root, normalizedQuery)
  return getSearchMatches(root)
}

let markdownParser: ReturnType<typeof getMarkdown> | undefined
// Search can rerun on each keystroke. Reuse a bounded set of recent projections.
const markdownSearchCache = new Map<string, string[]>()

const getMarkdownSearchChunks = (source: string, final: boolean): string[] => {
  const cacheKey = (final ? 'final:' : 'live:') + source
  const cached = markdownSearchCache.get(cacheKey)
  if (cached) return cached

  const chunks: string[] = []
  let inline = ''
  const flush = () => {
    if (inline) chunks.push(inline)
    inline = ''
  }

  const visitHtml = (html: string, block: boolean) => {
    // Use the renderer's safe policy and inspect a detached, inert fragment.
    // Never attach message HTML or use attribute values as searchable text.
    const template = document.createElement('template')
    template.innerHTML = sanitizeHtmlContent(html, 'safe')
    const walk = (parent: ParentNode, grouped: boolean) => {
      for (const node of Array.from(parent.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (grouped || node.textContent?.trim()) inline += node.textContent ?? ''
          if (!grouped) flush()
        } else if (node instanceof Element) {
          if (
            node.matches('[hidden], [aria-hidden="true"]') ||
            isIgnoredElement(node) ||
            node.matches(MARKDOWN_CHROME_SELECTOR)
          ) {
            continue
          }
          const boundary = node.matches(MARKDOWN_BLOCK_SELECTOR)
          if (boundary || node.tagName === 'BR') flush()
          const collapsed = node.tagName === 'DETAILS' && !node.hasAttribute('open')
          const body = collapsed ? node.querySelector(':scope > summary') : node
          if (body) walk(body, grouped || boundary)
          if (boundary) flush()
        }
      }
    }
    if (block) flush()
    walk(template.content, !block)
    if (block) flush()
  }

  const visit = (node: ParsedNode): void => {
    const {
      children,
      id,
      items,
      header,
      rows,
      cells,
      term,
      definition,
      content,
      code,
      name,
      text,
      kind,
      title,
      collapsible,
      open,
      loading,
      autoClosed,
      markup,
      tag,
      attrs
    } = node as {
      children?: ParsedNode[]
      id?: string
      items?: ParsedNode[]
      header?: ParsedNode
      rows?: ParsedNode[]
      cells?: ParsedNode[]
      term?: ParsedNode[]
      definition?: ParsedNode[]
      content?: string
      code?: string
      name?: string
      text?: string
      kind?: string
      title?: string
      collapsible?: boolean
      open?: boolean
      loading?: boolean
      autoClosed?: boolean
      markup?: string
      tag?: string
      attrs?: [string, string][]
    }

    switch (node.type) {
      case 'text':
        if (typeof content === 'string') inline += content
        return
      case 'emoji':
        if (typeof name === 'string') inline += name
        return
      case 'inline_code':
        inline += code ?? ''
        return
      case 'link':
        // Incomplete links render a literal label until the nested nodes are ready.
        if (!loading && children?.length) children.forEach(visit)
        else if (typeof text === 'string') inline += text
        return
      case 'reference':
        if (typeof id === 'string') inline += id
        return
      case 'image':
      case 'footnote_reference':
      case 'footnote_anchor':
        return
      case 'math_inline':
      case 'math_block': {
        flush()
        if (loading || typeof content !== 'string') return
        const template = document.createElement('template')
        // Index the visible glyphs. TeX commands and the hidden MathML
        // annotation are not visible text and cannot be highlighted.
        try {
          template.innerHTML = katex.renderToString(content, {
            displayMode: node.type === 'math_block' || markup === '$$',
            output: 'html',
            throwOnError: false,
            strict: 'ignore'
          })
          const mathText = template.content.textContent
          if (mathText) chunks.push(mathText)
        } catch {
          // Markstream falls back to literal source if KaTeX cannot render.
          if (node.raw) chunks.push(node.raw)
        }
        return
      }
      case 'html_inline':
      case 'html_block':
        if (node.type === 'html_inline' && loading && !autoClosed) inline += content ?? ''
        else if (
          node.type === 'html_block' &&
          tag &&
          children?.length &&
          !isHtmlTagBlocked(tag, 'safe')
        ) {
          const attributes = sanitizeHtmlAttrs(Object.fromEntries(attrs ?? []), 'safe', tag)
          if (Object.hasOwn(attributes, 'hidden') || attributes['aria-hidden'] === 'true') return
          flush()
          const visibleChildren =
            tag === 'details' && !Object.hasOwn(attributes, 'open')
              ? children
                  .filter((child) => child.type === 'html_block' && child.tag === 'summary')
                  .slice(0, 1)
              : children
          visibleChildren.forEach(visit)
          flush()
        } else if (typeof content === 'string') visitHtml(content, node.type === 'html_block')
        return
      case 'admonition': {
        flush()
        const label = kind || 'note'
        chunks.push(title?.trim() ? title : label.charAt(0).toUpperCase() + label.slice(1))
        if (!(collapsible && open === false)) children?.forEach(visit)
        flush()
        return
      }
      case 'definition_item':
        flush()
        term?.forEach(visit)
        flush()
        definition?.forEach(visit)
        flush()
        return
      case 'code_block':
        flush()
        if (code) chunks.push(code)
        return
      case 'hardbreak':
      case 'thematic_break':
        flush()
        return
    }

    // Walk structural child fields, including new containers. Never fall back
    // to raw source, URLs, attributes, or arbitrary custom component strings.
    const block = [
      'paragraph',
      'heading',
      'blockquote',
      'list_item',
      'table_cell',
      'footnote'
    ].includes(node.type)
    if (block) flush()
    if (node.type === 'heading' && !children?.length && typeof text === 'string') inline += text
    if (header) visit(header)
    for (const group of [children, items, rows, cells]) {
      if (Array.isArray(group)) group.forEach(visit)
    }
    if (block) flush()
  }

  markdownParser ??= getMarkdown('chat-search')
  parseMarkdownToStructure(normalizeMarkstreamCodeFenceLanguages(source), markdownParser, {
    final
  }).forEach(visit)
  flush()

  // Do not retain large streamed snapshots in the cache.
  if (source.length <= 16_384) {
    if (markdownSearchCache.size >= 200) {
      const oldest = markdownSearchCache.keys().next().value
      if (oldest !== undefined) markdownSearchCache.delete(oldest)
    }
    markdownSearchCache.set(cacheKey, chunks)
  }
  return chunks
}

const isDisplayUserMessageContent = (content: unknown): content is DisplayUserMessageContent => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return false
  }

  const value = content as Record<string, unknown>
  return typeof value.text === 'string'
}

const appendDisplayContentText = (content: unknown, output: string[], search = false): void => {
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
        if (search && record.type === 'content') {
          const { status, artifact } = record as DisplayAssistantMessageBlock
          if (artifact) return
          const streaming = status === 'pending' || status === 'loading'
          for (const part of generatePart(record.content, status)) {
            if (part.type === 'text') {
              output.push(...getMarkdownSearchChunks(part.content, !streaming && !part.loading))
            }
          }
        } else {
          output.push(record.content)
        }
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

  const referenceLabels = getReferencePathLabels(
    visibleBlocks.flatMap((block) => (block.type === 'file-reference' ? [block.relativePath] : []))
  )
  visibleBlocks.forEach((block) => {
    if (block.type === 'mention') {
      output.push(getVisibleMentionLabel(block))
    } else if (block.type === 'skill') {
      output.push(block.skillName)
    } else if (block.type === 'file') {
      output.push(block.fileName)
    } else if (block.type === 'file-reference') {
      output.push(referenceLabels.get(block.relativePath) ?? block.relativePath)
    } else if (block.type === 'session') {
      output.push(block.title)
    } else {
      output.push(block.content)
    }
  })
}

/**
 * Projects a display message's content to the same plain text the message list renders, skipping
 * plan, tool-call and internal blocks. Shared by chat search and the message map, which needs both a
 * message's text for its preview and its length for the width of its mark.
 */
export const extractDisplayContentText = (content: unknown): string => {
  const chunks: string[] = []
  appendDisplayContentText(content, chunks)
  return chunks.join(' ').replace(/\s+/g, ' ').trim()
}

export const collectChatSearchResults = (
  messages: Array<{ id: string; content: unknown }>,
  query: string
): ChatSearchResult[] => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  const results: ChatSearchResult[] = []
  for (const message of messages) {
    const chunks: string[] = []
    appendDisplayContentText(message.content, chunks, true)
    let matchIndex = 0
    for (const chunk of chunks) {
      const count = findSearchRanges(chunk, normalizedQuery).length
      for (let index = 0; index < count; index += 1) {
        results.push({ messageId: message.id, matchIndex })
        matchIndex += 1
      }
    }
  }
  return results
}

const setMatchActive = (match: HTMLElement, active: boolean): void => {
  for (const mark of [match, ...(highlightParts.get(match) ?? [])]) {
    if (active) {
      mark.dataset.chatSearchActive = 'true'
    } else {
      mark.removeAttribute('data-chat-search-active')
    }
    mark.classList.toggle('chat-search-highlight--active', active)
  }
}

export const setActiveChatSearchResult = (
  root: ParentNode | null | undefined,
  target: ChatSearchResult | null,
  options: { scroll?: boolean; behavior?: ScrollBehavior } = {}
): ChatSearchMatch | null => {
  if (!root || !target) return null

  const matches = getSearchMatches(root)
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
    setMatchActive(match, isActive)
    if (isActive) activeMatch = match
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
  matches.forEach((match, matchIndex) => setMatchActive(match, matchIndex === index))

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
