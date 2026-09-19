export interface MarkdownLevelTwoSection {
  readonly title: string
  readonly markdown: string
  readonly body: string
}

export function indexMarkdownLevelTwoSections(
  markdown: string
): ReadonlyMap<string, MarkdownLevelTwoSection> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const sections = new Map<string, MarkdownLevelTwoSection>()
  const headingPattern = /^ {0,3}(#{1,2})\s+(.+?)\s*#*\s*$/u
  const fencePattern = /^ {0,3}(`{3,}|~{3,})/u
  let fence: { marker: '`' | '~'; length: number } | null = null
  let current: { title: string; start: number } | null = null

  const commit = (end: number): void => {
    if (!current) return
    const body = lines
      .slice(current.start + 1, end)
      .join('\n')
      .trim()
    const identity = current.title.toLowerCase()
    if (!sections.has(identity)) {
      sections.set(identity, {
        title: current.title,
        markdown: lines.slice(current.start, end).join('\n').trim(),
        body
      })
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (fence) {
      if (isClosingFence(line, fence)) fence = null
      continue
    }
    const fenceMatch = line.match(fencePattern)?.[1]
    if (fenceMatch) {
      const marker = fenceMatch[0] as '`' | '~'
      fence = { marker, length: fenceMatch.length }
      continue
    }

    const heading = line.match(headingPattern)
    if (!heading) continue
    commit(index)
    current = heading[1] === '##' ? { title: heading[2]!.trim(), start: index } : null
  }
  commit(lines.length)
  return sections
}

export function extractMarkdownLevelTwoSection(
  markdown: string,
  title: string
): MarkdownLevelTwoSection | null {
  return indexMarkdownLevelTwoSections(markdown).get(title.trim().toLowerCase()) ?? null
}

export function removeEnclosingMarkdownFence(value: string): string {
  const lines = value.replace(/\r\n/g, '\n').trim().split('\n')
  if (lines.length < 2) return value.trim()
  const opening = lines[0]!.match(/^ {0,3}(`{3,}|~{3,})[^`~]*$/u)?.[1]
  if (!opening) return value.trim()
  const fence = { marker: opening[0] as '`' | '~', length: opening.length }
  if (!isClosingFence(lines.at(-1) ?? '', fence)) return value.trim()
  return lines.slice(1, -1).join('\n').trim()
}

function isClosingFence(line: string, fence: { marker: '`' | '~'; length: number }): boolean {
  const candidate = line.replace(/^ {0,3}/u, '').trimEnd()
  return (
    candidate.length >= fence.length &&
    [...candidate].every((character) => character === fence.marker)
  )
}
