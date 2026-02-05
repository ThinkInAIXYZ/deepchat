import type { Message } from '@shared/chat'

type DomInfo = {
  top: number
  height: number
}

type DomInfoEntry = {
  id: string
  top: number
  height: number
}

const MAX_CACHE_ENTRIES = 800

const messageCache = new Map<string, Message>()
const messageThreadMap = new Map<string, string>()
const messageDomInfo = new Map<string, DomInfo>()

const touch = (messageId: string, message: Message) => {
  if (!messageCache.has(messageId)) return
  messageCache.delete(messageId)
  messageCache.set(messageId, message)
}

const prune = () => {
  while (messageCache.size > MAX_CACHE_ENTRIES) {
    const oldestId = messageCache.keys().next().value as string | undefined
    if (!oldestId) return
    messageCache.delete(oldestId)
    messageThreadMap.delete(oldestId)
    messageDomInfo.delete(oldestId)
  }
}

export const getCachedMessage = (messageId: string): Message | null => {
  const message = messageCache.get(messageId)
  if (!message) return null
  touch(messageId, message)
  return message
}

export const hasCachedMessage = (messageId: string): boolean => {
  return messageCache.has(messageId)
}

export const cacheMessage = (message: Message) => {
  messageCache.set(message.id, message)
  messageThreadMap.set(message.id, message.conversationId)
  touch(message.id, message)
  prune()
}

export const cacheMessages = (messages: Message[]) => {
  for (const message of messages) {
    cacheMessage(message)
  }
}

export const deleteCachedMessage = (messageId: string) => {
  messageCache.delete(messageId)
  messageThreadMap.delete(messageId)
  messageDomInfo.delete(messageId)
}

export const clearCachedMessagesForThread = (sessionId: string) => {
  for (const [messageId, conversationId] of messageThreadMap.entries()) {
    if (conversationId === sessionId) {
      messageCache.delete(messageId)
      messageThreadMap.delete(messageId)
      messageDomInfo.delete(messageId)
    }
  }
}

export const clearMessageCache = () => {
  messageCache.clear()
  messageThreadMap.clear()
  messageDomInfo.clear()
}

export const setMessageDomInfo = (entries: Array<{ id: string; top: number; height: number }>) => {
  for (const entry of entries) {
    messageDomInfo.set(entry.id, { top: entry.top, height: entry.height })
  }
}

export const getMessageDomInfo = (messageId: string): DomInfo | null => {
  return messageDomInfo.get(messageId) ?? null
}

export const getAllMessageDomInfo = (): DomInfoEntry[] => {
  return Array.from(messageDomInfo.entries()).map(([id, info]) => ({
    id,
    top: info.top,
    height: info.height
  }))
}

export const clearMessageDomInfo = () => {
  messageDomInfo.clear()
}
