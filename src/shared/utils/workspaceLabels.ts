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

    // Resolve each workspace at the first depth where its own suffix is unique among the
    // workspaces still colliding, so one deep collision cannot lengthen every label.
    const resolvedContexts: (string | null)[] = parentSegments.map(() => null)
    let unresolvedIndexes = bucket.map((_, index) => index)
    for (let depth = 1; depth <= maxDepth && unresolvedIndexes.length > 0; depth += 1) {
      const depthContexts = new Map<number, string>()
      const contextCounts = new Map<string, number>()
      for (const index of unresolvedIndexes) {
        const context = parentSegments[index].slice(-depth).join('/')
        depthContexts.set(index, context)
        contextCounts.set(context, (contextCounts.get(context) ?? 0) + 1)
      }
      unresolvedIndexes = unresolvedIndexes.filter((index) => {
        const context = depthContexts.get(index) ?? ''
        if (context.length === 0 || contextCounts.get(context) !== 1) {
          return true
        }
        resolvedContexts[index] = context
        return false
      })
    }

    const unresolvedParentlessCount = unresolvedIndexes.filter(
      (index) => parentSegments[index].length === 0
    ).length

    bucket.forEach((item, index) => {
      let context = resolvedContexts[index]
      if (context === null) {
        // Identical parent chains cannot be separated by a suffix; fall back to the full
        // normalized path so every rendered label stays unique. A single parentless
        // duplicate keeps its compact label instead.
        context =
          parentSegments[index].length === 0 && unresolvedParentlessCount === 1 ? '' : item.id
      }
      if (context) {
        overrides.set(item.id, `${item.label} · ${context}`)
      }
    })
  }

  return overrides
}
