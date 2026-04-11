import type { ChatMessage } from '@shared/presenter'
import { generateId } from 'ai'
import { jsonrepair } from 'jsonrepair'

export interface ParsedLegacyToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export function serializeChatMessageContent(content: ChatMessage['content']): string {
  if (content == null) {
    return ''
  }

  if (typeof content === 'string') {
    return content
  }

  return content
    .map((part) => {
      if (part.type === 'text') {
        return part.text
      }

      if (part.type === 'image_url') {
        return part.image_url.url
      }

      return JSON.stringify(part)
    })
    .join('\n')
}

export function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    try {
      return JSON.parse(jsonrepair(value))
    } catch {
      return undefined
    }
  }
}

export function parseLegacyFunctionCalls(
  response: string,
  fallbackIdPrefix = 'tool-call'
): ParsedLegacyToolCall[] {
  const functionCallMatches = response.match(/<function_call>([\s\S]*?)<\/function_call>/g)
  if (!functionCallMatches) {
    return []
  }

  return functionCallMatches
    .map((match, index) => {
      const content = match.replace(/<\/?function_call>/g, '').trim()
      if (!content) {
        return null
      }

      const parsed = tryParseJson(content)
      if (!parsed || typeof parsed !== 'object') {
        return null
      }

      const record = parsed as Record<string, unknown>
      let functionName: string | undefined
      let functionArgs: unknown

      if (record.function_call && typeof record.function_call === 'object') {
        const call = record.function_call as Record<string, unknown>
        functionName = typeof call.name === 'string' ? call.name : undefined
        functionArgs = call.arguments
      } else if (typeof record.name === 'string' && record.arguments !== undefined) {
        functionName = record.name
        functionArgs = record.arguments
      } else if (record.function && typeof record.function === 'object') {
        const call = record.function as Record<string, unknown>
        functionName = typeof call.name === 'string' ? call.name : undefined
        functionArgs = call.arguments
      } else {
        const keys = Object.keys(record)
        if (keys.length === 1) {
          const inner = record[keys[0]]
          if (inner && typeof inner === 'object') {
            const nested = inner as Record<string, unknown>
            if (typeof nested.name === 'string' && nested.arguments !== undefined) {
              functionName = nested.name
              functionArgs = nested.arguments
            }
          }
        }
      }

      if (!functionName || functionArgs === undefined) {
        return null
      }

      return {
        id: `${fallbackIdPrefix}-${index}-${generateId()}`,
        type: 'function' as const,
        function: {
          name: functionName,
          arguments:
            typeof functionArgs === 'string' ? functionArgs : JSON.stringify(functionArgs ?? {})
        }
      }
    })
    .filter((call): call is ParsedLegacyToolCall => call !== null)
}

export function buildFunctionCallRecordContent(
  name: string,
  args: unknown,
  response: unknown
): string {
  return `<function_call>${JSON.stringify({
    function_call_record: {
      name,
      arguments: args,
      response
    }
  })}</function_call>`
}

export function splitMergedToolContent(content: string, expectedParts: number): string[] | null {
  if (!content || expectedParts <= 1) {
    return null
  }

  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  const splitByDelimiter = (delimiter: RegExp): string[] | null => {
    const parts = trimmed
      .split(delimiter)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)

    return parts.length === expectedParts ? parts : null
  }

  const tryJsonArray = (): string[] | null => {
    if (!trimmed.startsWith('[')) {
      return null
    }

    const parsed = tryParseJson(trimmed)
    if (!Array.isArray(parsed) || parsed.length !== expectedParts) {
      return null
    }

    return parsed.map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
  }

  const strategies: Array<() => string[] | null> = [
    tryJsonArray,
    () => splitByDelimiter(/\n-{3,}\n+/g),
    () => splitByDelimiter(/\n={3,}\n+/g),
    () => splitByDelimiter(/\n\*{3,}\n+/g),
    () => splitByDelimiter(/\n\s*\n+/g)
  ]

  for (const strategy of strategies) {
    const parts = strategy()
    if (parts) {
      return parts
    }
  }

  return null
}

export function toToolResultOutput(value: unknown): any {
  if (Array.isArray(value)) {
    return {
      type: 'content',
      value: value.map((entry) => {
        if (typeof entry === 'string') {
          return {
            type: 'text',
            text: entry
          }
        }

        if (entry && typeof entry === 'object') {
          return entry as Record<string, unknown>
        }

        return {
          type: 'text',
          text: JSON.stringify(entry)
        }
      })
    }
  }

  if (typeof value === 'string') {
    const parsed = tryParseJson(value)
    if (parsed !== undefined) {
      return {
        type: 'json',
        value: parsed
      }
    }

    return {
      type: 'text',
      value
    }
  }

  return {
    type: 'json',
    value: value ?? null
  }
}
