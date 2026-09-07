import { computed } from 'vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'

export interface ProcessedPart {
  type: 'text' | 'thinking' | 'artifact' | 'tool_call'
  content: string
  loading?: boolean
  artifact?: {
    identifier: string
    title: string
    type:
      | 'application/vnd.ant.code'
      | 'text/markdown'
      | 'text/html'
      | 'image/svg+xml'
      | 'application/vnd.ant.mermaid'
      | 'application/vnd.ant.react'
    language?: string
  }
  tool_call?: {
    status: 'calling' | 'response' | 'end' | 'error'
    name?: string
    error?: string
  }
}

export interface ParsedArtifactPart {
  identifier: string
  title: string
  type:
    | 'application/vnd.ant.code'
    | 'text/markdown'
    | 'text/html'
    | 'image/svg+xml'
    | 'application/vnd.ant.mermaid'
    | 'application/vnd.ant.react'
  language?: string
  content: string
  loading: boolean
}

// 定义可接受的artifact类型
type ArtifactType =
  | 'application/vnd.ant.code'
  | 'text/markdown'
  | 'text/html'
  | 'image/svg+xml'
  | 'application/vnd.ant.mermaid'
  | 'application/vnd.ant.react'
type ArtifactSourceBlock = Pick<DisplayAssistantMessageBlock, 'content' | 'status'>

export const useBlockContent = (props: { block: ArtifactSourceBlock }) => {
  const blockContent = computed(() =>
    typeof props.block.content === 'string' ? props.block.content : ''
  )
  const processedContent = computed<ProcessedPart[]>(() =>
    blockContent.value
      ? generatePart(blockContent.value, props.block.status)
      : [{ type: 'text', content: '' }]
  )

  return {
    processedContent
  }
}

export function extractArtifactsFromContent(
  content: string,
  status: DisplayAssistantMessageBlock['status']
): ParsedArtifactPart[] {
  return generatePart(content, status)
    .filter(
      (
        part
      ): part is ProcessedPart & {
        type: 'artifact'
        artifact: NonNullable<ProcessedPart['artifact']>
      } => {
        return part.type === 'artifact' && Boolean(part.artifact)
      }
    )
    .map((part) => ({
      identifier: part.artifact.identifier,
      title: part.artifact.title,
      type: part.artifact.type,
      language: part.artifact.language,
      content: part.content,
      loading: Boolean(part.loading)
    }))
}

// Precompiled once — never construct RegExp inside the scan loop.
const ATTRIBUTE_REGEX = /(\w+)="([^"]*)"/g
const THINKING_CLOSED_RE = /<antThinking>(.*?)<\/antThinking>/s
const THINKING_UNCLOSED_RE = /<antThinking>([^<]*)/s
const ARTIFACT_CLOSED_RE = /<antArtifact\s+([^>]*)>([\s\S]*?)<\/antArtifact>/s
const ARTIFACT_UNCLOSED_RE =
  /<antArtifact\s+(?=.*\btype="([^"]+)")(?=.*\bidentifier="([^"]+)")(?=.*\btitle="([^"]+)")(?:\s+language="([^"]+)")?\s*(?:[^>]*?)>([\s\S]*)/s
const TOOL_CALL_OPEN_RE = /<tool_call(?:\s+([^>]*))?>/
const TOOL_RESPONSE_OPEN_RE = /<tool_response(?:\s+([^>]*))?>/
const TOOL_CALL_END_OPEN_RE = /<tool_call_end(?:\s+([^>]*))?>/
const TOOL_CALL_ERROR_OPEN_RE = /<tool_call_error(?:\s+([^>]*))?>/
const MAX_TOOL_CALLS_OPEN_RE = /<maximum_tool_calls_reached(?:\s+([^>]*))?>/
// Longer tool_* names first so tool_call does not steal tool_call_end / error.
const NEXT_TAG_RE =
  /<(antThinking|antArtifact|tool_call_error|tool_call_end|tool_response|tool_call|maximum_tool_calls_reached)\b/g
const TOOL_RELATED_OPEN_RES = [
  TOOL_RESPONSE_OPEN_RE,
  TOOL_CALL_END_OPEN_RE,
  TOOL_CALL_ERROR_OPEN_RE,
  TOOL_CALL_OPEN_RE,
  MAX_TOOL_CALLS_OPEN_RE
] as const
const LOADING_SKIP_TAGS = new Set([
  'tool_call',
  'tool_response',
  'tool_call_end',
  'tool_call_error',
  'maximum_tool_calls_reached'
])

type TagKind =
  | 'thinking'
  | 'artifact'
  | 'tool_call'
  | 'tool_response'
  | 'tool_call_end'
  | 'tool_call_error'
  | 'maximum_tool_calls_reached'

type ParsedTagMatch = {
  index: number
  kind: TagKind
  match: RegExpExecArray
  unclosed?: boolean
}

/** Map NEXT_TAG_RE capture groups (literal tag names) onto internal kinds. */
function tagKindFromProbe(raw: string): TagKind | null {
  switch (raw) {
    case 'antThinking':
      return 'thinking'
    case 'antArtifact':
      return 'artifact'
    case 'tool_call':
    case 'tool_response':
    case 'tool_call_end':
    case 'tool_call_error':
    case 'maximum_tool_calls_reached':
      return raw
    default:
      return null
  }
}

// Last-parse memo: streaming recomputes with the same string many times per frame.
let lastGeneratePartContent: string | null = null
let lastGeneratePartStatus: DisplayAssistantMessageBlock['status'] | null = null
let lastGeneratePartResult: ProcessedPart[] | null = null

// 辅助函数：解析标签属性
function parseAttributes(attributesStr?: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  if (!attributesStr) return attributes

  ATTRIBUTE_REGEX.lastIndex = 0
  let attrMatch: RegExpExecArray | null
  while ((attrMatch = ATTRIBUTE_REGEX.exec(attributesStr)) !== null) {
    const [, name, value] = attrMatch
    attributes[name] = value
  }
  return attributes
}

function matchFrom(regex: RegExp, content: string, from: number): RegExpExecArray | null {
  const slice = content.slice(from)
  const match = regex.exec(slice)
  if (!match) return null
  match.index += from
  return match
}

function findNextToolRelatedTagIndex(content: string, from: number): number {
  let nextIndex = content.length
  for (const regex of TOOL_RELATED_OPEN_RES) {
    const match = matchFrom(regex, content, from)
    if (match && match.index < nextIndex) {
      nextIndex = match.index
    }
  }
  return nextIndex
}

function findEarliestTag(
  content: string,
  from: number,
  status: DisplayAssistantMessageBlock['status']
): ParsedTagMatch | null {
  NEXT_TAG_RE.lastIndex = from
  let probe: RegExpExecArray | null
  while ((probe = NEXT_TAG_RE.exec(content)) !== null) {
    const kind = tagKindFromProbe(probe[1])
    if (!kind) {
      continue
    }
    if (status === 'loading' && LOADING_SKIP_TAGS.has(kind)) {
      continue
    }

    if (kind === 'thinking') {
      const closed = matchFrom(THINKING_CLOSED_RE, content, probe.index)
      if (closed && closed.index === probe.index) {
        return { index: probe.index, kind, match: closed }
      }
      const unclosed = matchFrom(THINKING_UNCLOSED_RE, content, probe.index)
      if (unclosed && unclosed.index === probe.index) {
        return { index: probe.index, kind, match: unclosed, unclosed: true }
      }
      continue
    }

    if (kind === 'artifact') {
      const closed = matchFrom(ARTIFACT_CLOSED_RE, content, probe.index)
      if (closed && closed.index === probe.index) {
        return { index: probe.index, kind, match: closed }
      }
      const unclosed = matchFrom(ARTIFACT_UNCLOSED_RE, content, probe.index)
      if (unclosed && unclosed.index === probe.index) {
        return { index: probe.index, kind, match: unclosed, unclosed: true }
      }
      continue
    }

    if (kind === 'tool_call') {
      const match = matchFrom(TOOL_CALL_OPEN_RE, content, probe.index)
      if (match && match.index === probe.index) {
        return { index: probe.index, kind, match }
      }
      continue
    }

    if (kind === 'tool_response') {
      const match = matchFrom(TOOL_RESPONSE_OPEN_RE, content, probe.index)
      if (match && match.index === probe.index) {
        return { index: probe.index, kind, match }
      }
      continue
    }

    if (kind === 'tool_call_end') {
      const match = matchFrom(TOOL_CALL_END_OPEN_RE, content, probe.index)
      if (match && match.index === probe.index) {
        return { index: probe.index, kind, match }
      }
      continue
    }

    if (kind === 'tool_call_error') {
      const match = matchFrom(TOOL_CALL_ERROR_OPEN_RE, content, probe.index)
      if (match && match.index === probe.index) {
        return { index: probe.index, kind, match }
      }
      continue
    }

    if (kind === 'maximum_tool_calls_reached') {
      const match = matchFrom(MAX_TOOL_CALLS_OPEN_RE, content, probe.index)
      if (match && match.index === probe.index) {
        return { index: probe.index, kind, match }
      }
    }
  }

  return null
}

function buildThinkingPart(match: RegExpExecArray): ProcessedPart {
  return {
    type: 'thinking',
    content: match[1].trim(),
    loading: false
  }
}

function buildClosedArtifactPart(match: RegExpExecArray): ProcessedPart {
  const attributes = parseAttributes(match[1])
  return {
    type: 'artifact',
    content: match[2].trim(),
    loading: false,
    artifact: {
      identifier: attributes.identifier || '',
      title: attributes.title || '',
      type: (attributes.type || 'text/markdown') as ArtifactType,
      language: attributes.language
    }
  }
}

function buildUnclosedArtifactPart(match: RegExpExecArray): ProcessedPart {
  const openingTag = match[0].substring(0, match[0].indexOf('>') + 1)
  const typeMatch = openingTag.match(/type="([^"]+)"/)
  const identifierMatch = openingTag.match(/identifier="([^"]+)"/)
  const titleMatch = openingTag.match(/title="([^"]+)"/)
  const languageMatch = openingTag.match(/language="([^"]+)"/)
  const body = match[5] ? match[5].trim() : ''

  return {
    type: 'artifact',
    content: body,
    loading: true,
    artifact: {
      identifier: identifierMatch ? identifierMatch[1] : '',
      title: titleMatch ? titleMatch[1] : '',
      type: typeMatch ? (typeMatch[1] as ArtifactType) : 'text/markdown',
      language: languageMatch ? languageMatch[1] : undefined
    }
  }
}

/** Exported for unit tests — production callers use useBlockContent / extractArtifactsFromContent. */
export function generatePart(
  content: string,
  status: DisplayAssistantMessageBlock['status']
): ProcessedPart[] {
  if (
    lastGeneratePartResult &&
    lastGeneratePartContent === content &&
    lastGeneratePartStatus === status
  ) {
    return lastGeneratePartResult
  }

  const parts: ProcessedPart[] = []
  let currentPosition = 0
  let currentToolCallIndex = -1

  while (currentPosition < content.length) {
    const earliestMatch = findEarliestTag(content, currentPosition, status)

    if (!earliestMatch) {
      const remainingText = content.substring(currentPosition).trim()
      if (remainingText) {
        parts.push({
          type: 'text',
          content: remainingText
        })
      }
      break
    }

    if (earliestMatch.index > currentPosition) {
      const text = content.substring(currentPosition, earliestMatch.index).trim()
      if (text) {
        parts.push({
          type: 'text',
          content: text
        })
      }
    }

    const { kind, match } = earliestMatch

    if (kind === 'tool_call') {
      const tagEndIndex = content.indexOf('>', earliestMatch.index) + 1
      const nextToolTagIndex = findNextToolRelatedTagIndex(content, tagEndIndex)
      const toolCallContent = content.substring(tagEndIndex, nextToolTagIndex).trim()
      const attributes = parseAttributes(match[1])
      parts.push({
        type: 'tool_call',
        content: toolCallContent,
        loading: true,
        tool_call: {
          status: 'calling',
          name: attributes?.name,
          error: attributes?.error
        }
      })
      currentToolCallIndex = parts.length - 1
      currentPosition = nextToolTagIndex
    } else if (kind === 'tool_response') {
      if (currentToolCallIndex !== -1 && parts[currentToolCallIndex].type === 'tool_call') {
        const tagEndIndex = content.indexOf('>', earliestMatch.index) + 1
        const nextToolTagIndex = findNextToolRelatedTagIndex(content, tagEndIndex)
        const responseContent = content.substring(tagEndIndex, nextToolTagIndex).trim()

        parts[currentToolCallIndex].content += '\n' + responseContent
        parts[currentToolCallIndex].tool_call!.status = 'response'

        const attributes = parseAttributes(match[1])
        if (attributes.name) {
          parts[currentToolCallIndex].tool_call!.name = attributes.name
        }
        if (attributes.error) {
          parts[currentToolCallIndex].tool_call!.error = attributes.error
        }

        currentPosition = nextToolTagIndex
      } else {
        currentPosition = content.indexOf('>', earliestMatch.index) + 1
      }
    } else if (kind === 'tool_call_end') {
      if (
        currentToolCallIndex !== -1 &&
        parts[currentToolCallIndex].type === 'tool_call' &&
        parts[currentToolCallIndex].tool_call!.status !== 'end'
      ) {
        parts[currentToolCallIndex].loading = false
        parts[currentToolCallIndex].tool_call!.status = 'end'

        const attributes = parseAttributes(match[1])
        if (attributes.name) {
          parts[currentToolCallIndex].tool_call!.name = attributes.name
        }
        if (attributes.error) {
          parts[currentToolCallIndex].tool_call!.error = attributes.error
        }
      } else {
        const attributes = parseAttributes(match[1])
        parts.push({
          type: 'tool_call',
          content: '',
          loading: false,
          tool_call: {
            status: 'end',
            name: attributes?.name,
            error: attributes?.error
          }
        })
        currentToolCallIndex = parts.length - 1
      }
      currentPosition = content.indexOf('>', earliestMatch.index) + 1
    } else if (kind === 'tool_call_error') {
      if (
        currentToolCallIndex !== -1 &&
        parts[currentToolCallIndex].type === 'tool_call' &&
        parts[currentToolCallIndex].tool_call!.status !== 'end'
      ) {
        parts[currentToolCallIndex].loading = false
        parts[currentToolCallIndex].tool_call!.status = 'error'

        const attributes = parseAttributes(match[1])
        if (attributes.name) {
          parts[currentToolCallIndex].tool_call!.name = attributes.name
        }
        if (attributes.error) {
          parts[currentToolCallIndex].tool_call!.error = attributes.error
        }
      } else {
        const attributes = parseAttributes(match[1])
        parts.push({
          type: 'tool_call',
          content: '',
          loading: false,
          tool_call: {
            status: 'error',
            name: attributes?.name,
            error: attributes?.error
          }
        })
        currentToolCallIndex = parts.length - 1
      }
      currentPosition = content.indexOf('>', earliestMatch.index) + 1
    } else if (kind === 'maximum_tool_calls_reached') {
      parts.push({
        type: 'text',
        content: 'Maximum tool calls reached'
      })
      currentPosition = content.indexOf('>', earliestMatch.index) + 1
    } else if (kind === 'thinking') {
      parts.push(buildThinkingPart(match))
      currentPosition = earliestMatch.index + match[0].length
    } else if (kind === 'artifact') {
      if (earliestMatch.unclosed) {
        parts.push(buildUnclosedArtifactPart(match))
        currentPosition = content.length
      } else {
        parts.push(buildClosedArtifactPart(match))
        currentPosition = earliestMatch.index + match[0].length
      }
    } else {
      currentPosition = earliestMatch.index + 1
    }
  }

  const result =
    parts.length === 0
      ? [
          {
            type: 'text' as const,
            content
          }
        ]
      : parts

  lastGeneratePartContent = content
  lastGeneratePartStatus = status
  lastGeneratePartResult = result
  return result
}
