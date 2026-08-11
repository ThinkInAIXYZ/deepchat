export interface WorkspaceLabelItem {
  /** Unique workspace identity — the normalized directory path. */
  id: string
  /** Compact basename-derived label currently displayed. */
  label: string
}

/**
 * Returns display-label overrides that keep duplicate workspace labels distinguishable by
 * appending the shortest parent-path suffix, e.g. two `app` groups become `app · team-a`
 * and `app · archive`. Labels that are already unique receive no override, so callers can
 * keep their compact form. Windows and POSIX separators are treated interchangeably; the
 * suffix always renders with `/`.
 */
export function disambiguateWorkspaceLabels(items: WorkspaceLabelItem[]): Map<string, string> {
  const overrides = new Map<string, string>()
  const buckets = new Map<string, WorkspaceLabelItem[]>()
  for (const item of items) {
    const bucket = buckets.get(item.label)
    if (bucket) {
      bucket.push(item)
    } else {
      buckets.set(item.label, [item])
    }
  }

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) {
      continue
    }

    const parentSegments = bucket.map((item) =>
      item.id
        .split(/[\\/]+/)
        .filter(Boolean)
        .slice(0, -1)
    )
    const maxDepth = Math.max(...parentSegments.map((segments) => segments.length))

    let contexts = parentSegments.map(() => '')
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      contexts = parentSegments.map((segments) => segments.slice(-depth).join('/'))
      if (new Set(contexts).size === bucket.length) {
        break
      }
    }

    const contextCounts = new Map<string, number>()
    for (const context of contexts) {
      contextCounts.set(context, (contextCounts.get(context) ?? 0) + 1)
    }

    bucket.forEach((item, index) => {
      const context = contexts[index]
      // Identical parent chains cannot be separated by a suffix; fall back to the full
      // normalized path so every rendered label stays unique.
      const uniqueContext = contextCounts.get(context) === 1 ? context : item.id
      if (uniqueContext) {
        overrides.set(item.id, `${item.label} · ${uniqueContext}`)
      }
    })
  }

  return overrides
}
