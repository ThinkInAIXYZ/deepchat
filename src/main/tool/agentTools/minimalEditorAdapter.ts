export const STR_REPLACE_EDITOR_MAX_OUTPUT_CHARS = 16_000

const RESPONSE_CLIPPED =
  '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>'

export type ApplyPatchChunk = {
  changeContext?: string
  oldLines: string[]
  newLines: string[]
  endOfFile: boolean
}

export type ApplyPatchOperation =
  | { type: 'add'; path: string; content: string }
  | { type: 'delete'; path: string }
  | { type: 'update'; path: string; movePath?: string; chunks: ApplyPatchChunk[] }

function parsePath(line: string, marker: string, lineNumber: number): string {
  const path = line.slice(marker.length).trim()
  if (!path) throw new Error(`Invalid patch hunk on line ${lineNumber}: path cannot be empty.`)
  return path
}

function isFileMarker(line: string): boolean {
  return (
    line.startsWith('*** Add File: ') ||
    line.startsWith('*** Delete File: ') ||
    line.startsWith('*** Update File: ')
  )
}

function parseUpdateChunk(
  lines: string[],
  start: number
): { chunk: ApplyPatchChunk; next: number } {
  let cursor = start
  let changeContext: string | undefined
  if (lines[cursor] === '@@') {
    cursor += 1
  } else if (lines[cursor]?.startsWith('@@ ')) {
    changeContext = lines[cursor].slice(3)
    cursor += 1
  }

  const oldLines: string[] = []
  const newLines: string[] = []
  let endOfFile = false
  let consumed = false
  while (cursor < lines.length) {
    const line = lines[cursor]
    if (line === '*** End Patch' || isFileMarker(line) || line === '@@' || line.startsWith('@@ ')) {
      break
    }
    if (line === '*** End of File') {
      endOfFile = true
      cursor += 1
      while (lines[cursor] === '') cursor += 1
      break
    }
    const prefix = line[0]
    if (prefix !== ' ' && prefix !== '+' && prefix !== '-') {
      throw new Error(
        `Invalid patch hunk on line ${cursor + 1}: expected a context, addition, or deletion line.`
      )
    }
    const content = line.slice(1)
    if (prefix === ' ' || prefix === '-') oldLines.push(content)
    if (prefix === ' ' || prefix === '+') newLines.push(content)
    consumed = true
    cursor += 1
  }
  if (!consumed) {
    throw new Error(`Invalid patch hunk on line ${start + 1}: change is empty.`)
  }
  return {
    chunk: {
      ...(changeContext === undefined ? {} : { changeContext }),
      oldLines,
      newLines,
      endOfFile
    },
    next: cursor
  }
}

export function parseApplyPatch(patch: string): ApplyPatchOperation[] {
  const lines = patch.replace(/\r\n/g, '\n').trim().split('\n')
  if (lines[0]?.trim() !== '*** Begin Patch') {
    throw new Error("Invalid patch: The first line of the patch must be '*** Begin Patch'.")
  }
  if (lines.at(-1)?.trim() !== '*** End Patch') {
    throw new Error("Invalid patch: The last line of the patch must be '*** End Patch'.")
  }

  const operations: ApplyPatchOperation[] = []
  let cursor = 1
  while (cursor < lines.length - 1) {
    const line = lines[cursor]
    if (!line.trim()) {
      cursor += 1
      continue
    }
    if (line.startsWith('*** Add File: ')) {
      const path = parsePath(line, '*** Add File: ', cursor + 1)
      cursor += 1
      const content: string[] = []
      while (cursor < lines.length - 1 && !isFileMarker(lines[cursor])) {
        if (!lines[cursor].startsWith('+')) {
          throw new Error(
            `Invalid patch hunk on line ${cursor + 1}: add-file lines must start with '+'.`
          )
        }
        content.push(lines[cursor].slice(1))
        cursor += 1
      }
      if (content.length === 0) {
        throw new Error(`Invalid patch hunk: Add file hunk for path '${path}' is empty.`)
      }
      operations.push({ type: 'add', path, content: `${content.join('\n')}\n` })
      continue
    }
    if (line.startsWith('*** Delete File: ')) {
      operations.push({
        type: 'delete',
        path: parsePath(line, '*** Delete File: ', cursor + 1)
      })
      cursor += 1
      continue
    }
    if (line.startsWith('*** Update File: ')) {
      const path = parsePath(line, '*** Update File: ', cursor + 1)
      cursor += 1
      let movePath: string | undefined
      if (lines[cursor]?.startsWith('*** Move to: ')) {
        movePath = parsePath(lines[cursor], '*** Move to: ', cursor + 1)
        cursor += 1
      }
      const chunks: ApplyPatchChunk[] = []
      while (cursor < lines.length - 1 && !isFileMarker(lines[cursor])) {
        const parsed = parseUpdateChunk(lines, cursor)
        chunks.push(parsed.chunk)
        cursor = parsed.next
      }
      if (chunks.length === 0) {
        throw new Error(`Invalid patch hunk: Update file hunk for path '${path}' is empty.`)
      }
      operations.push({
        type: 'update',
        path,
        ...(movePath === undefined ? {} : { movePath }),
        chunks
      })
      continue
    }
    throw new Error(`Invalid patch hunk on line ${cursor + 1}: '${line}'.`)
  }
  if (operations.length === 0) throw new Error('No files were modified.')
  return operations
}

function normalizePunctuation(value: string): string {
  return value
    .trim()
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[\u00a0\u2002-\u200a\u202f\u205f\u3000]/g, ' ')
}

function findSequence(lines: string[], pattern: string[], start: number, eof: boolean): number {
  if (pattern.length === 0) return start
  if (pattern.length > lines.length) return -1
  const searchStart = eof ? lines.length - pattern.length : start
  const comparators = [
    (value: string) => value,
    (value: string) => value.trimEnd(),
    (value: string) => value.trim(),
    normalizePunctuation
  ]
  for (const normalize of comparators) {
    for (let index = searchStart; index <= lines.length - pattern.length; index += 1) {
      if (pattern.every((line, offset) => normalize(lines[index + offset]) === normalize(line))) {
        return index
      }
    }
  }
  return -1
}

export function applyUpdateChunks(
  content: string,
  path: string,
  chunks: readonly ApplyPatchChunk[]
): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  const replacements: Array<{ index: number; count: number; lines: string[]; order: number }> = []
  const appendedLines: string[] = []
  let lineIndex = 0
  let replacementOrder = 0

  for (const chunk of chunks) {
    if (chunk.changeContext !== undefined) {
      const contextIndex = findSequence(lines, [chunk.changeContext], lineIndex, false)
      if (contextIndex < 0) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${path}`)
      }
      lineIndex = contextIndex + 1
    }
    if (chunk.oldLines.length === 0) {
      if (chunk.changeContext === undefined) {
        appendedLines.push(...chunk.newLines)
      } else {
        replacements.push({
          index: lineIndex,
          count: 0,
          lines: chunk.newLines,
          order: replacementOrder++
        })
      }
      continue
    }
    const found = findSequence(lines, chunk.oldLines, lineIndex, chunk.endOfFile)
    if (found < 0) {
      throw new Error(`Failed to find expected lines in ${path}:\n${chunk.oldLines.join('\n')}`)
    }
    replacements.push({
      index: found,
      count: chunk.oldLines.length,
      lines: chunk.newLines,
      order: replacementOrder++
    })
    lineIndex = found + chunk.oldLines.length
  }

  for (const replacement of replacements.sort(
    (left, right) => right.index - left.index || right.order - left.order
  )) {
    lines.splice(replacement.index, replacement.count, ...replacement.lines)
  }
  lines.push(...appendedLines)
  if (lines.at(-1) !== '') lines.push('')
  return lines.join('\n')
}

export function collectApplyPatchPaths(operations: readonly ApplyPatchOperation[]): string[] {
  return operations.flatMap((operation) =>
    operation.type === 'update' && operation.movePath
      ? [operation.path, operation.movePath]
      : [operation.path]
  )
}

export function formatApplyPatchSummary(operations: readonly ApplyPatchOperation[]): string {
  const rows = ['Done!']
  for (const operation of operations) {
    const marker = operation.type === 'add' ? 'A' : operation.type === 'delete' ? 'D' : 'M'
    rows.push(`${marker} ${operation.path}`)
  }
  return rows.join('\n')
}

export function matchOffsets(content: string, search: string): number[] {
  const offsets: number[] = []
  let offset = 0
  while (true) {
    const match = content.indexOf(search, offset)
    if (match < 0) return offsets
    offsets.push(match)
    offset = match + search.length
  }
}

export function lineNumbersAt(content: string, offsets: readonly number[]): number[] {
  let line = 1
  let cursor = 0
  return offsets.map((offset) => {
    while (cursor < offset) {
      if (content[cursor] === '\n') line += 1
      cursor += 1
    }
    return line
  })
}

export function formatStrReplaceFileView(
  path: string,
  content: string,
  viewRange?: number[]
): string {
  const allLines = content.split('\n')
  let lines = allLines
  let initialLine = 1
  let finalLine: number | undefined
  let prompt = `Here's the content of ${path} with line numbers (which has a total of ${allLines.length} lines)`
  if (viewRange !== undefined) {
    if (viewRange.length !== 2 || !viewRange.every(Number.isInteger)) {
      throw new Error('Invalid `view_range`. It should be a list of two integers.')
    }
    ;[initialLine, finalLine] = viewRange as [number, number]
    if (initialLine < 1 || initialLine > allLines.length) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its first element \`${initialLine}\` should be within the range of lines of the file: [1, ${allLines.length}]`
      )
    }
    if (finalLine > allLines.length) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its second element \`${finalLine}\` should be smaller than the number of lines in the file: \`${allLines.length}\``
      )
    }
    if (finalLine !== -1 && finalLine < initialLine) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its second element \`${finalLine}\` should be larger or equal than its first \`${initialLine}\``
      )
    }
    lines =
      finalLine === -1
        ? allLines.slice(initialLine - 1)
        : allLines.slice(initialLine - 1, finalLine)
    prompt += ` with view_range=[${initialLine}, ${finalLine}]`
  }
  const numbered = lines
    .map((line, index) => `${String(initialLine + index).padStart(6, ' ')}  ${line}`)
    .join('\n')
  return truncateEditorOutput(`${prompt}:\n${numbered}\n`)
}

export function truncateEditorOutput(content: string): string {
  return content.length <= STR_REPLACE_EDITOR_MAX_OUTPUT_CHARS
    ? content
    : content.slice(0, STR_REPLACE_EDITOR_MAX_OUTPUT_CHARS) + RESPONSE_CLIPPED
}
