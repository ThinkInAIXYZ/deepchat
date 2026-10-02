type AppDocument = 'main' | 'settings' | 'splash'

function documentUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.username || url.password) return null
    url.hash = ''
    url.search = ''
    return url.href
  } catch {
    return null
  }
}

/** Exact entry documents, not every file or every page on the development origin. */
export function createAppDocumentMatcher(
  rendererDirectoryUrl: string,
  developmentServerUrl?: string
): (url: string) => AppDocument | null {
  const documents = new Map<string, AppDocument>()
  const entries = [
    ['index.html', 'main'],
    ['settings/index.html', 'settings'],
    ['splash/index.html', 'splash']
  ] as const
  for (const [entry, kind] of entries) {
    documents.set(new URL(entry, rendererDirectoryUrl).href, kind)
  }

  if (developmentServerUrl) {
    const base = new URL(developmentServerUrl)
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      throw new Error('Invalid renderer development URL')
    }
    const mainUrl = documentUrl(base.href)
    if (!mainUrl) throw new Error('Invalid renderer development URL')
    documents.set(mainUrl, 'main')
    for (const [entry, kind] of entries) {
      documents.set(new URL(`/${entry}`, base).href, kind)
    }
    documents.set(new URL('/splash/', base).href, 'splash')
  }

  return (url) => documents.get(documentUrl(url) ?? '') ?? null
}
