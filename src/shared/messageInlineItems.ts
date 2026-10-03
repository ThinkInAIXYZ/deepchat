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

/** Keep the shortest distinguishing suffix, including a parent directory when available. */
export function getReferencePathLabel(path: string, peers: readonly string[] = []): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  let count = Math.min(2, parts.length)
  const otherPaths = peers.filter((peer) => peer !== path).map((peer) => peer.replace(/\\/g, '/'))
  while (
    count < parts.length &&
    otherPaths.some(
      (peer) =>
        peer === parts.slice(-count).join('/') || peer.endsWith(`/${parts.slice(-count).join('/')}`)
    )
  )
    count++
  return parts.slice(-count).join('/') || path
}
