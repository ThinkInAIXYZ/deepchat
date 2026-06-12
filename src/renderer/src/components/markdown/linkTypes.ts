export type MarkdownLinkSource = 'chat' | 'artifact' | 'workspace'

export interface MarkdownLinkContext {
  source: MarkdownLinkSource
  sessionId?: string | null
  sourceFilePath?: string | null
}

export type MarkdownLinkTarget =
  | {
      kind: 'fragment'
      fragment: string
    }
  | {
      kind: 'web'
      url: string
    }
  | {
      kind: 'system'
      url: string
    }
  | {
      kind: 'local-file'
      href: string
    }
  | {
      kind: 'external'
      url: string
    }

const PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/

export function classifyMarkdownLink(rawHref: string): MarkdownLinkTarget {
  const href = rawHref.trim()

  if (href.startsWith('#')) {
    return {
      kind: 'fragment',
      fragment: href.slice(1)
    }
  }

  if (WINDOWS_ABSOLUTE_PATH_RE.test(href) || href.startsWith('/')) {
    return {
      kind: 'local-file',
      href
    }
  }

  if (!PROTOCOL_RE.test(href)) {
    return {
      kind: 'local-file',
      href
    }
  }

  try {
    const url = new URL(href)
    switch (url.protocol) {
      case 'http:':
      case 'https:':
        return {
          kind: 'web',
          url: href
        }
      case 'mailto:':
      case 'tel:':
        return {
          kind: 'system',
          url: href
        }
      case 'file:':
        return {
          kind: 'local-file',
          href
        }
      default:
        return {
          kind: 'external',
          url: href
        }
    }
  } catch {
    return {
      kind: 'local-file',
      href
    }
  }
}
