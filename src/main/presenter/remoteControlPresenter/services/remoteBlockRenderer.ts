import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import type { RemoteRenderableBlock } from '../types'

const TOOL_ARGS_PREVIEW_LIMIT = 1_200
const TOOL_RESULT_PREVIEW_LIMIT = 1_600
const SEARCH_RESULT_LIMIT = 5
const SEARCH_SNIPPET_LIMIT = 220
const DEFAULT_REMOTE_STATUS_TEXT = 'Running...'
export const REMOTE_WAITING_STATUS_TEXT = 'Waiting for your response...'
const DEFAULT_REMOTE_ERROR_TEXT = 'The conversation ended with an error.'

const normalizeText = (value: string | undefined | null): string =>
  (value ?? '').replace(/\r\n/g, '\n').trim()

const summarizeText = (
  value: string | undefined | null,
  limit: number
): {
  preview: string
  truncated: boolean
  charCount: number
  lineCount: number
} => {
  const normalized = normalizeText(value)
  if (!normalized) {
    return {
      preview: '',
      truncated: false,
      charCount: 0,
      lineCount: 0
    }
  }

  return {
    preview:
      normalized.length > limit
        ? `${normalized.slice(0, limit).trimEnd()}\n...[truncated]`
        : normalized,
    truncated: normalized.length > limit,
    charCount: normalized.length,
    lineCount: normalized.split('\n').length
  }
}

const buildSection = (title: string, body: string): string => `${title}\n${body.trim()}`

const formatAnswerBlock = (content: string): string => buildSection('[Answer]', content)

const formatReasoningBlock = (content: string): string => buildSection('[Reasoning]', content)

const formatToolCallBlock = (
  block: AssistantMessageBlock
): {
  text: string
  truncated: boolean
} => {
  const toolName = normalizeText(block.tool_call?.name) || 'unknown_tool'
  const serverName = normalizeText(block.tool_call?.server_name)
  const argsSummary = summarizeText(block.tool_call?.params, TOOL_ARGS_PREVIEW_LIMIT)

  const lines = [`[Tool Call] ${toolName}`]
  if (serverName) {
    lines.push(`Server: ${serverName}`)
  }
  lines.push('Arguments:')
  lines.push(argsSummary.preview || '(none)')

  return {
    text: lines.join('\n'),
    truncated: argsSummary.truncated
  }
}

const formatToolResultBlock = (
  block: AssistantMessageBlock
): {
  text: string
  truncated: boolean
} => {
  const toolName = normalizeText(block.tool_call?.name) || 'unknown_tool'
  const status = block.status === 'error' ? 'error' : 'success'
  const serverName = normalizeText(block.tool_call?.server_name)
  const outputSummary = summarizeText(block.tool_call?.response, TOOL_RESULT_PREVIEW_LIMIT)

  const lines = [`[Tool Result] ${toolName}`, `Status: ${status}`]
  if (serverName) {
    lines.push(`Server: ${serverName}`)
  }
  lines.push(`Characters: ${outputSummary.charCount}`)
  lines.push(`Lines: ${outputSummary.lineCount}`)
  lines.push('Preview:')
  lines.push(outputSummary.preview || '(no output)')

  return {
    text: lines.join('\n'),
    truncated: outputSummary.truncated
  }
}

const formatSearchSnippet = (result: SearchResult): string => {
  const snippet = normalizeText(result.snippet || result.description || result.content)
  if (!snippet) {
    return ''
  }

  return snippet.length > SEARCH_SNIPPET_LIMIT
    ? `${snippet.slice(0, SEARCH_SNIPPET_LIMIT).trimEnd()}...`
    : snippet
}

const fallbackSearchResults = (block: AssistantMessageBlock): SearchResult[] => {
  const pages = Array.isArray(block.extra?.pages) ? block.extra.pages : []
  return pages
    .map((page, index) => {
      if (!page || typeof page !== 'object') {
        return null
      }

      const candidate = page as {
        url?: unknown
      }
      if (typeof candidate.url !== 'string' || !candidate.url.trim()) {
        return null
      }

      return {
        title: `Result ${index + 1}`,
        url: candidate.url.trim()
      } satisfies SearchResult
    })
    .filter((item): item is SearchResult => Boolean(item))
}

const formatSearchBlock = (
  block: AssistantMessageBlock,
  results: SearchResult[]
): {
  text: string
  truncated: boolean
} => {
  const normalizedResults = results.length > 0 ? results : fallbackSearchResults(block)
  const label =
    normalizeText(typeof block.extra?.label === 'string' ? block.extra.label : '') || 'search'
  const engine = normalizeText(typeof block.extra?.engine === 'string' ? block.extra.engine : '')
  const limited = normalizedResults.slice(0, SEARCH_RESULT_LIMIT)

  const lines = [`[Search] ${label}`]
  if (engine) {
    lines.push(`Engine: ${engine}`)
  }
  lines.push(`Results: ${normalizedResults.length}`)

  for (const [index, result] of limited.entries()) {
    const title = normalizeText(result.title) || `Result ${index + 1}`
    lines.push(`${index + 1}. ${title}`)
    lines.push(result.url)
    const snippet = formatSearchSnippet(result)
    if (snippet) {
      lines.push(snippet)
    }
  }

  if (normalizedResults.length === 0) {
    lines.push('No stored search results were found.')
  }

  if (normalizedResults.length > limited.length) {
    lines.push(`...[truncated ${normalizedResults.length - limited.length} more result(s)]`)
  }

  return {
    text: lines.join('\n'),
    truncated: normalizedResults.length > limited.length
  }
}

const estimateImageBytes = (data: string | undefined): number => {
  if (!data) {
    return 0
  }

  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}

const formatImageNoticeBlock = (block: AssistantMessageBlock): string => {
  const mimeType = normalizeText(block.image_data?.mimeType) || 'unknown'
  const bytes = estimateImageBytes(block.image_data?.data)

  return [
    '[Image Notice]',
    `MIME: ${mimeType}`,
    bytes > 0 ? `Approx size: ${bytes} bytes` : '',
    'Remote channel does not render binary images.'
  ]
    .filter(Boolean)
    .join('\n')
}

const formatErrorBlock = (content: string): string => buildSection('[Error]', content)

const isRenderableNarrativeBlock = (block: AssistantMessageBlock): boolean =>
  (block.type === 'content' || block.type === 'reasoning_content') &&
  block.status !== 'pending' &&
  normalizeText(block.content).length > 0

const extractTrailingPendingNarrativeBlocks = (
  blocks: AssistantMessageBlock[]
): AssistantMessageBlock[] => {
  const trailing: AssistantMessageBlock[] = []

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (
      block.status !== 'pending' ||
      (block.type !== 'content' && block.type !== 'reasoning_content')
    ) {
      break
    }
    trailing.unshift(block)
  }

  return trailing
}

export const buildRemoteDraftText = (blocks: AssistantMessageBlock[]): string =>
  extractTrailingPendingNarrativeBlocks(blocks)
    .map((block) => {
      const content = normalizeText(block.content)
      if (!content) {
        return ''
      }

      return block.type === 'reasoning_content'
        ? formatReasoningBlock(content)
        : formatAnswerBlock(content)
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()

export const buildRemoteStreamText = (blocks: AssistantMessageBlock[]): string =>
  blocks
    .filter((block) => block.type === 'content')
    .map((block) => normalizeText(block.content))
    .filter(Boolean)
    .join('\n\n')
    .trim()

const isToolCallArgsComplete = (block: AssistantMessageBlock): boolean =>
  block.status !== 'pending' || block.extra?.toolCallArgsComplete === true

const getLastMeaningfulBlock = (blocks: AssistantMessageBlock[]): AssistantMessageBlock | null => {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.type === 'action' && block.extra?.needsUserAction) {
      continue
    }

    if (block.type === 'content' || block.type === 'reasoning_content' || block.type === 'error') {
      if (normalizeText(block.content).length === 0) {
        continue
      }
      return block
    }

    return block
  }

  return null
}

export const buildRemoteStatusText = (
  blocks: AssistantMessageBlock[],
  pendingInteraction: boolean = false
): string => {
  if (pendingInteraction) {
    return REMOTE_WAITING_STATUS_TEXT
  }

  const latestBlock = getLastMeaningfulBlock(blocks)
  if (!latestBlock) {
    return DEFAULT_REMOTE_STATUS_TEXT
  }

  switch (latestBlock.type) {
    case 'reasoning_content':
      return 'Running: thinking...'
    case 'content':
      return 'Running: writing...'
    case 'tool_call': {
      const toolName = normalizeText(latestBlock.tool_call?.name) || 'tool'
      return latestBlock.status === 'pending' || latestBlock.status === 'loading'
        ? `Running: calling ${toolName}...`
        : 'Running: processing tool results...'
    }
    case 'search':
      return 'Running: reviewing search results...'
    case 'image':
      return 'Running: preparing image output...'
    case 'error':
      return DEFAULT_REMOTE_STATUS_TEXT
    case 'action':
      return REMOTE_WAITING_STATUS_TEXT
  }
}

export const buildRemoteFinalText = (
  blocks: AssistantMessageBlock[],
  options?: {
    preferTerminalError?: boolean
    fallbackErrorText?: string
    fallbackNoResponseText?: string
  }
): string => {
  if (options?.preferTerminalError) {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index]
      if (block.type !== 'error') {
        continue
      }

      const errorText = normalizeText(block.content)
      if (errorText) {
        return errorText
      }
    }
  }

  const answer = blocks
    .filter((block) => block.type === 'content' && block.status !== 'pending')
    .map((block) => normalizeText(block.content))
    .filter(Boolean)
    .join('\n\n')
    .trim()
  if (answer) {
    return answer
  }

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.type !== 'error') {
      continue
    }

    const errorText = normalizeText(block.content)
    if (errorText) {
      return errorText
    }
  }

  if (options?.fallbackErrorText) {
    return options.fallbackErrorText
  }

  if (options?.fallbackNoResponseText) {
    return options.fallbackNoResponseText
  }

  return DEFAULT_REMOTE_ERROR_TEXT
}

type BuildRemoteRenderableBlocksParams = {
  messageId: string
  blocks: AssistantMessageBlock[]
  loadSearchResults: (messageId: string, searchId?: string) => Promise<SearchResult[]>
}

export const buildRemoteRenderableBlocks = async (
  params: BuildRemoteRenderableBlocksParams
): Promise<RemoteRenderableBlock[]> => {
  const { messageId, blocks, loadSearchResults } = params
  const rendered: RemoteRenderableBlock[] = []

  for (const [index, block] of blocks.entries()) {
    if (block.type === 'content' && isRenderableNarrativeBlock(block)) {
      rendered.push({
        key: `${messageId}:${index}:answer`,
        kind: 'answer',
        text: formatAnswerBlock(normalizeText(block.content)),
        truncated: false,
        sourceMessageId: messageId
      })
      continue
    }

    if (block.type === 'reasoning_content' && isRenderableNarrativeBlock(block)) {
      rendered.push({
        key: `${messageId}:${index}:reasoning`,
        kind: 'reasoning',
        text: formatReasoningBlock(normalizeText(block.content)),
        truncated: false,
        sourceMessageId: messageId
      })
      continue
    }

    if (block.type === 'tool_call' && isToolCallArgsComplete(block)) {
      const toolCall = formatToolCallBlock(block)
      rendered.push({
        key: `${messageId}:${index}:toolCall`,
        kind: 'toolCall',
        text: toolCall.text,
        truncated: toolCall.truncated,
        sourceMessageId: messageId
      })

      if (block.status === 'success' || block.status === 'error') {
        const toolResult = formatToolResultBlock(block)
        rendered.push({
          key: `${messageId}:${index}:toolResult`,
          kind: 'toolResult',
          text: toolResult.text,
          truncated: toolResult.truncated,
          sourceMessageId: messageId
        })
      }
      continue
    }

    if (block.type === 'search' && block.status !== 'pending') {
      const searchId =
        normalizeText(typeof block.extra?.searchId === 'string' ? block.extra.searchId : '') ||
        normalizeText(block.id)
      const searchBlock = formatSearchBlock(
        block,
        await loadSearchResults(messageId, searchId || undefined)
      )
      rendered.push({
        key: `${messageId}:${index}:search`,
        kind: 'search',
        text: searchBlock.text,
        truncated: searchBlock.truncated,
        sourceMessageId: messageId
      })
      continue
    }

    if (block.type === 'image' && block.status !== 'pending') {
      rendered.push({
        key: `${messageId}:${index}:image`,
        kind: 'imageNotice',
        text: formatImageNoticeBlock(block),
        truncated: false,
        sourceMessageId: messageId
      })
      continue
    }

    if (block.type === 'error' && normalizeText(block.content)) {
      rendered.push({
        key: `${messageId}:${index}:error`,
        kind: 'error',
        text: formatErrorBlock(normalizeText(block.content)),
        truncated: false,
        sourceMessageId: messageId
      })
    }
  }

  return rendered
}

export const buildRemoteFullText = (renderBlocks: RemoteRenderableBlock[]): string =>
  renderBlocks
    .map((block) => normalizeText(block.text))
    .filter(Boolean)
    .join('\n\n')
    .trim()
