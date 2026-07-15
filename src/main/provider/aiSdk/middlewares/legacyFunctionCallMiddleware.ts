import type { MCPToolDefinition } from '@shared/presenter'
import type { ModelMessage } from 'ai'

function appendTextToUserMessage(message: ModelMessage, extraText: string): ModelMessage {
  if (message.role !== 'user') {
    return message
  }

  if (!Array.isArray(message.content)) {
    return {
      ...message,
      role: message.role ?? 'user',
      content: [
        {
          type: 'text',
          text: `${String(message.content ?? '')}${extraText}`
        }
      ]
    }
  }

  const content = [...message.content]
  const lastPart = content.at(-1)
  if (lastPart?.type === 'text') {
    content[content.length - 1] = {
      ...lastPart,
      text: `${lastPart.text}${extraText}`
    }
  } else {
    content.push({
      type: 'text',
      text: extraText
    })
  }

  return {
    ...message,
    content
  }
}

export function applyLegacyFunctionCallPrompt(
  messages: ModelMessage[],
  tools: MCPToolDefinition[],
  buildPrompt: ((tools: MCPToolDefinition[]) => string) | undefined
): ModelMessage[] {
  if (!tools.length || !buildPrompt) {
    return messages
  }

  const promptSuffix = `\n\n${buildPrompt(tools)}`
  const lastUserIndex = [...messages].map((message) => message.role).lastIndexOf('user')

  if (lastUserIndex === -1) {
    return [
      ...messages,
      {
        role: 'user',
        content: [{ type: 'text', text: buildPrompt(tools) }]
      }
    ]
  }

  return messages.map((message, index) =>
    index === lastUserIndex ? appendTextToUserMessage(message, promptSuffix) : message
  )
}
