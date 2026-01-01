import { approximateTokenSize } from 'tokenx'
import type { AssistantMessageBlock, Message } from '@shared/chat'
import type { ChatMessage } from '@shared/presenter'
import { addContextMessages } from './messageFormatter'
import { compressToolCallsFromContext } from './messageCompressor'

function calculateToolCallTokens(toolCall: NonNullable<ChatMessage['tool_calls']>[number]): number {
  const nameTokens = approximateTokenSize(toolCall.function?.name || '')
  const argumentsTokens = approximateTokenSize(toolCall.function?.arguments || '')
  return nameTokens + argumentsTokens
}

function calculateMessageTokens(message: ChatMessage): number {
  let tokens = 0

  if (typeof message.content === 'string') {
    tokens += approximateTokenSize(message.content)
  } else if (Array.isArray(message.content)) {
    const textContent = message.content.reduce((acc, item) => {
      if (item.type === 'text' && typeof item.text === 'string') {
        return acc + item.text
      }
      return acc
    }, '')
    tokens += approximateTokenSize(textContent)
  }

  if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach((toolCall) => {
      tokens += calculateToolCallTokens(toolCall)
    })
  }

  return tokens
}

function calculateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((acc, message) => acc + calculateMessageTokens(message), 0)
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

export function selectContextMessages(
  contextMessages: Message[],
  userMessage: Message,
  remainingContextLength: number,
  supportsFunctionCall: boolean,
  vision: boolean
): Message[] {
  if (remainingContextLength <= 0) {
    return []
  }

  const messages = contextMessages
    .filter((msg) => msg.id !== userMessage?.id)
    .map((msg) => cloneMessageWithContent(msg))
    .reverse()
  let selectedMessages = messages.filter((msg) => msg.status === 'sent')

  if (selectedMessages.length === 0) {
    return []
  }

  let chatMessages = addContextMessages(selectedMessages, vision, supportsFunctionCall)
  let totalTokens = calculateMessagesTokens(chatMessages)
  console.log('totalTokens', totalTokens, 'remainingContextLength', remainingContextLength)
  if (totalTokens > remainingContextLength) {
    let excessTokens = totalTokens - remainingContextLength

    if (supportsFunctionCall) {
      const { removedTokens } = compressToolCallsFromContext(
        selectedMessages,
        excessTokens,
        supportsFunctionCall
      )

      totalTokens = Math.max(0, totalTokens - removedTokens)
      chatMessages = addContextMessages(selectedMessages, vision, supportsFunctionCall)
      totalTokens = calculateMessagesTokens(chatMessages)
    }

    if (totalTokens > remainingContextLength) {
      excessTokens = totalTokens - remainingContextLength
      let removedTokens = 0

      while (removedTokens < excessTokens && selectedMessages.length > 0) {
        const userIndex = selectedMessages.findIndex((msg) => msg.role === 'user')
        if (userIndex === -1) {
          break
        }

        const lastUserIndex = selectedMessages.findLastIndex((msg) => msg.role === 'user')
        if (userIndex === lastUserIndex) {
          break
        }

        const userMsg = selectedMessages[userIndex]
        const matchingAssistants = selectedMessages
          .map((msg, idx) => ({ msg, idx }))
          .filter(({ msg }) => msg.role === 'assistant' && msg.parentId === userMsg.id)
          .sort((a, b) => a.msg.is_variant - b.msg.is_variant)

        if (matchingAssistants.length === 0) {
          selectedMessages.splice(userIndex, 1)
          continue
        }

        const assistantIndex = matchingAssistants[0].idx

        const startIndex = Math.min(userIndex, assistantIndex)
        const endIndex = Math.max(userIndex, assistantIndex)

        const pairMessages = selectedMessages.slice(startIndex, endIndex + 1)
        const pairTokens = calculateMessagesTokens(
          addContextMessages(pairMessages, vision, supportsFunctionCall)
        )

        console.log(
          `PromptBuilder: removing one user/assistant pair from context (${pairTokens} tokens)`
        )

        selectedMessages.splice(startIndex, endIndex - startIndex + 1)
        removedTokens += pairTokens
        totalTokens = Math.max(0, totalTokens - pairTokens)
      }
    }

    chatMessages = addContextMessages(selectedMessages, vision, supportsFunctionCall)
    totalTokens = calculateMessagesTokens(chatMessages)
  }

  const userIds = new Set(
    selectedMessages.filter((msg) => msg.role === 'user').map((msg) => msg.id)
  )
  selectedMessages = selectedMessages.filter((msg) => {
    if (msg.role === 'assistant') {
      return msg.parentId && userIds.has(msg.parentId)
    }
    return true
  })

  return selectedMessages.reverse()
}
