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
// Reverse index for O(1) thread-to-messages lookup
const threadToMessagesMap = new Map<string, Set<string>>()

const touch = (messageId: string, message: Message) => {
  if (!messageCache.has(messageId)) return
  messageCache.delete(messageId)
  messageCache.set(messageId, message)
}

const prune = () => {
  while (messageCache.size > MAX_CACHE_ENTRIES) {
    const oldestId = messageCache.keys().next().value as string | undefined
    if (!oldestId) return
    
    // Remove from all maps atomically
    const threadId = messageThreadMap.get(oldestId)
    messageCache.delete(oldestId)
    messageThreadMap.delete(oldestId)
    messageDomInfo.delete(oldestId)
    
    // Update reverse index
    if (threadId) {
      const messageIds = threadToMessagesMap.get(threadId)
      if (messageIds) {
        messageIds.delete(oldestId)
        if (messageIds.size === 0) {
          threadToMessagesMap.delete(threadId)
        }
      }
    }
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
  
  // Update reverse index
  if (!threadToMessagesMap.has(message.conversationId)) {
    threadToMessagesMap.set(message.conversationId, new Set())
  }
  threadToMessagesMap.get(message.conversationId)!.add(message.id)
  
  touch(message.id, message)
  prune()
}

export const cacheMessages = (messages: Message[]) => {
  for (const message of messages) {
    cacheMessage(message)
  }
}

export const deleteCachedMessage = (messageId: string) => {
  const threadId = messageThreadMap.get(messageId)
  
  messageCache.delete(messageId)
  messageThreadMap.delete(messageId)
  messageDomInfo.delete(messageId)
  
  // Update reverse index
  if (threadId) {
    const messageIds = threadToMessagesMap.get(threadId)
    if (messageIds) {
      messageIds.delete(messageId)
      if (messageIds.size === 0) {
        threadToMessagesMap.delete(threadId)
      }
    }
  }
}

export const clearCachedMessagesForThread = (threadId: string) => {
  // O(1) lookup instead of O(n) iteration
  const messageIds = threadToMessagesMap.get(threadId)
  if (!messageIds) return
  
  for (const messageId of messageIds) {
    messageCache.delete(messageId)
    messageThreadMap.delete(messageId)
    messageDomInfo.delete(messageId)
  }
  
  threadToMessagesMap.delete(threadId)
}

export const clearMessageCache = () => {
  messageCache.clear()
  messageThreadMap.clear()
  messageDomInfo.clear()
  threadToMessagesMap.clear()
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
