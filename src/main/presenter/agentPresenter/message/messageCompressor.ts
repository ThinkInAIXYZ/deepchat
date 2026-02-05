import { approximateTokenSize } from 'tokenx'
import type { AssistantMessageBlock, Message } from '@shared/chat'

function calculateToolCallBlockTokens(block: AssistantMessageBlock): number {
  if (block.type !== 'tool_call' || !block.tool_call?.response) {
    return 0
  }

  const nameTokens = approximateTokenSize(block.tool_call.name || '')
  const paramsTokens = approximateTokenSize(block.tool_call.params || '')
  const responseTokens = approximateTokenSize(block.tool_call.response || '')

  return nameTokens + paramsTokens + responseTokens
}

function cloneMessageWithContent(message: Message): Message {
  const cloned: Message = { ...message }

  if (Array.isArray(message.content)) {
    cloned.content = message.content.map((block) => {
      const clonedBlock: AssistantMessageBlock = { ...(block as AssistantMessageBlock) }
      if (block.type === 'tool_call' && block.tool_call) {
        clonedBlock.tool_call = { ...block.tool_call }
      }
      return clonedBlock
    })
  } else if (message.content && typeof message.content === 'object') {
    cloned.content = JSON.parse(JSON.stringify(message.content))
  } else {
    cloned.content = message.content
  }

  return cloned
}

function removeToolCallsFromAssistant(message: Message): {
  updatedMessage: Message
  removedTokens: number
  removedToolCalls: number
} {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) {
    return { updatedMessage: message, removedTokens: 0, removedToolCalls: 0 }
  }

  const clonedMessage = cloneMessageWithContent(message)
  const clonedContent = clonedMessage.content as AssistantMessageBlock[]

  let removedTokens = 0
  let removedToolCalls = 0

  const filteredBlocks = clonedContent.filter((block) => {
    if (block.type !== 'tool_call' || !block.tool_call) {
      return true
    }

    removedTokens += calculateToolCallBlockTokens(block)
    removedToolCalls += 1
    return false
  })

  clonedMessage.content = filteredBlocks

  return { updatedMessage: clonedMessage, removedTokens, removedToolCalls }
}

export function compressToolCallsFromContext(
  messages: Message[],
  excessTokens: number,
  supportsFunctionCall: boolean
): { compressedMessages: Message[]; removedTokens: number } {
  if (!supportsFunctionCall || excessTokens <= 0) {
    return { compressedMessages: messages, removedTokens: 0 }
  }

  const messagesToEdit = messages.map((msg) => cloneMessageWithContent(msg))
  const lastUserIndex = messagesToEdit.findLastIndex((message) => message.role === 'user')
  let removedTokens = 0

  for (let i = 0; i < messagesToEdit.length; i++) {
    if (lastUserIndex !== -1 && i >= lastUserIndex) {
      break
    }

    const message = messagesToEdit[i]
    if (message.role !== 'assistant') {
      continue
    }

    const {
      updatedMessage,
      removedTokens: toolCallTokens,
      removedToolCalls
    } = removeToolCallsFromAssistant(message)

    if (removedToolCalls > 0) {
      messagesToEdit[i] = updatedMessage
      console.debug(
        `MessageCompressor: removed ${removedToolCalls} tool call block(s) (${toolCallTokens} tokens) from context`
      )
    }

    removedTokens += toolCallTokens

    if (removedTokens >= excessTokens) {
      break
    }
  }

  return { compressedMessages: messagesToEdit, removedTokens }
}
