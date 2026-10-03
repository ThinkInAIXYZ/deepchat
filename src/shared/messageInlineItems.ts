import type { UserMessageInlineItem } from './types/agent-interface'

/** Metadata decorates text; stale spans must never replace unrelated user content. */
export function getValidInlineItems(
  text: string,
  items: readonly UserMessageInlineItem[] = []
): UserMessageInlineItem[] {
  let end = 0
  return items
    .filter(
      (item) => Number.isInteger(item.offset) && item.offset >= 0 && item.offset <= text.length
    )
    .toSorted((a, b) => a.offset - b.offset)
    .filter((item) => {
      if (item.offset < end) return false
      if (item.type !== 'file-reference') return true
      const token = `@${item.relativePath}`
      if (!item.relativePath || /[\r\n]/.test(item.relativePath)) return false
      const path = item.filePath.replace(/\\/g, '/')
      const relativePath = item.relativePath.replace(/\\/g, '/')
      if (path !== relativePath && !path.endsWith(`/${relativePath}`)) return false
      if (text.slice(item.offset, item.offset + token.length) !== token) return false
      end = item.offset + token.length
      return true
    })
}

/** Resolve all labels together, rather than scanning every peer for each reference. */
export function getReferencePathLabels(paths: readonly string[]): Map<string, string> {
  const segments = new Map(
    paths.map((path) => [path, path.replace(/\\/g, '/').split('/').filter(Boolean)])
  )
  const suffixCounts = new Map<string, number>()
  for (const parts of segments.values()) {
    for (let count = 1; count <= parts.length; count++) {
      const suffix = parts.slice(-count).join('/')
      suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1)
    }
  }
  return new Map(
    Array.from(segments, ([path, parts]) => {
      let count = Math.min(2, parts.length)
      while (count < parts.length && suffixCounts.get(parts.slice(-count).join('/'))! > 1) count++
      return [path, parts.slice(-count).join('/') || path]
    })
  )
}
