import type { MCPToolDefinition, PromptListEntry } from '@shared/presenter'

export interface AcpSessionCommand {
  name: string
  description: string
  input?: { hint: string } | null
}

export type SlashCategory = 'command' | 'skill' | 'prompt' | 'tool'

export interface SlashSuggestionItem {
  id: string
  category: SlashCategory
  label: string
  description?: string
  payload: AcpSessionCommand | PromptListEntry | MCPToolDefinition | { name: string }
}

export const MAX_FILTERED_SLASH_SUGGESTIONS = 20

const SLASH_CATEGORY_RANK: Record<SlashCategory, number> = {
  command: 0,
  skill: 1,
  prompt: 2,
  tool: 3
}

export type SlashActionDecision =
  | { kind: 'send-command'; command: string }
  | { kind: 'request-command-input'; command: AcpSessionCommand }
  | { kind: 'activate-skill'; skillName: string }
  | { kind: 'insert-tool'; text: string }
  | { kind: 'insert-prompt'; prompt: PromptListEntry }
  | { kind: 'request-prompt-args'; prompt: PromptListEntry }

const uniq = (values: string[]) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

export const buildCommandText = (name: string, input?: string): string => {
  const normalized = name.trim().replace(/^\/+/, '')
  const base = `/${normalized}`
  const content = input?.trim()
  return content ? `${base} ${content}` : base
}

const collectPromptSegments = (value: unknown, segments: string[], visited: Set<object>): void => {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text) {
      segments.push(text)
    }
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  if (visited.has(value as object)) {
    return
  }
  visited.add(value as object)

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPromptSegments(item, segments, visited)
    }
    return
  }

  const record = value as Record<string, unknown>

  if (Array.isArray(record.messages)) {
    for (const message of record.messages) {
      if (!message || typeof message !== 'object') continue
      const messageRecord = message as Record<string, unknown>
      collectPromptSegments(messageRecord.content, segments, visited)
    }
  }

  if ('content' in record) {
    collectPromptSegments(record.content, segments, visited)
  }

  if (typeof record.text === 'string') {
    const text = record.text.trim()
    if (text) {
      segments.push(text)
    }
  }
}

export const extractPromptTextSegments = (value: unknown): string[] => {
  const segments: string[] = []
  collectPromptSegments(value, segments, new Set())
  return uniq(segments)
}

export const flattenPromptResultToText = (value: unknown): string => {
  return extractPromptTextSegments(value).join('\n\n').trim()
}

export const sortSlashSuggestionItems = (items: SlashSuggestionItem[]): SlashSuggestionItem[] => {
  return [...items].sort((a, b) => {
    if (SLASH_CATEGORY_RANK[a.category] !== SLASH_CATEGORY_RANK[b.category]) {
      return SLASH_CATEGORY_RANK[a.category] - SLASH_CATEGORY_RANK[b.category]
    }
    return a.label.localeCompare(b.label)
  })
}

export const filterSlashSuggestionItems = (
  items: SlashSuggestionItem[],
  query: string,
  limit = MAX_FILTERED_SLASH_SUGGESTIONS
): SlashSuggestionItem[] => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return items
  }

  return items
    .filter((item) => {
      if (item.label.toLowerCase().includes(normalized)) return true
      return item.description?.toLowerCase().includes(normalized)
    })
    .slice(0, limit)
}

export const resolveSlashSelectionAction = (item: SlashSuggestionItem): SlashActionDecision => {
  if (item.category === 'command') {
    const command = item.payload as AcpSessionCommand
    if (command.input?.hint?.trim()) {
      return { kind: 'request-command-input', command }
    }
    return { kind: 'send-command', command: buildCommandText(command.name) }
  }

  if (item.category === 'skill') {
    return {
      kind: 'activate-skill',
      skillName: (item.payload as { name: string }).name
    }
  }

  if (item.category === 'tool') {
    const tool = item.payload as MCPToolDefinition
    const toolName = tool.function.name?.trim() || item.label.trim()
    return { kind: 'insert-tool', text: `@${toolName} ` }
  }

  const prompt = item.payload as PromptListEntry
  if (prompt.arguments && prompt.arguments.length > 0) {
    return { kind: 'request-prompt-args', prompt }
  }
  return { kind: 'insert-prompt', prompt }
}
