import { defineStore } from 'pinia'
import { ref, computed, onMounted, watch } from 'vue'
import type {
  UserMessageContent,
  AssistantMessageBlock,
  AssistantMessage,
  UserMessage,
  Message
} from '@shared/chat'
import { finalizeAssistantMessageBlocks } from '@shared/chat/messageBlocks'
import type { CONVERSATION, CONVERSATION_SETTINGS, ParentSelection } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import {
  CONVERSATION_EVENTS,
  CONFIG_EVENTS,
  DEEPLINK_EVENTS,
  MEETING_EVENTS,
  STREAM_EVENTS
} from '@/events'
import router from '@/router'
import { useI18n } from 'vue-i18n'
import { useSoundStore } from './sound'
import { useWorkspaceStore } from './workspace'
import sfxfcMp3 from '/sounds/sfx-fc.mp3?url'
import sfxtyMp3 from '/sounds/sfx-typing.mp3?url'
import { downloadBlob } from '@/lib/download'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'
import {
  cacheMessage,
  cacheMessages,
  clearCachedMessagesForThread,
  clearMessageDomInfo,
  deleteCachedMessage,
  getCachedMessage,
  getMessageDomInfo,
  hasCachedMessage,
  setMessageDomInfo
} from '@/lib/messageRuntimeCache'

// 定义会话工作状态类型
export type WorkingStatus = 'working' | 'error' | 'completed' | 'none'

type PendingContextMention = {
  id: string
  label: string
  category: 'context'
  content: string
}

type PendingScrollTarget = {
  messageId?: string
  childConversationId?: string
}

export type MessageListItem = {
  id: string
  message: Message | null
}

export const useChatStore = defineStore('chat', () => {
  const threadP = usePresenter('sessionPresenter')
  const agentP = usePresenter('agentPresenter')
  const exporterP = usePresenter('exporter')
  const windowP = usePresenter('windowPresenter')
  const notificationP = usePresenter('notificationPresenter')
  const tabP = usePresenter('tabPresenter')
  const configP = usePresenter('configPresenter')
  const { t } = useI18n()
  const { currentMode } = useChatMode()

  const soundStore = useSoundStore()

  // 状态
  const activeThreadIdMap = ref<Map<number, string | null>>(new Map())
  const threads = ref<
    {
      dt: string
      dtThreads: CONVERSATION[]
    }[]
  >([])
  const messageIdsMap = ref<Map<number, string[]>>(new Map())
  const messageCacheVersion = ref(0)
  const generatingThreadIds = ref(new Set<string>())
  const isSidebarOpen = ref(false)
  const isMessageNavigationOpen = ref(false)
  const childThreadsByMessageId = ref<Map<string, CONVERSATION[]>>(new Map())
  const pendingContextMentions = ref<Map<string, PendingContextMention>>(new Map())
  const pendingScrollTargetByConversation = ref<Map<string, PendingScrollTarget>>(new Map())

  // 使用Map来存储会话工作状态
  const threadsWorkingStatusMap = ref<Map<number, Map<string, WorkingStatus>>>(new Map())

  // 添加消息生成缓存
  const generatingMessagesCacheMap = ref<
    Map<number, Map<string, { message: Message; threadId: string }>>
  >(new Map())

  // 对话配置状态
  const chatConfig = ref<CONVERSATION_SETTINGS>({
    systemPrompt: '',
    temperature: 0.7,
    contextLength: 32000,
    maxTokens: 8000,
    providerId: '',
    modelId: '',
    artifacts: 0,
    enabledMcpTools: [],
    thinkingBudget: undefined,
    enableSearch: undefined,
    forcedSearch: undefined,
    searchStrategy: undefined,
    reasoningEffort: undefined,
    verbosity: undefined,
    selectedVariantsMap: {},
    acpWorkdirMap: {},
    agentWorkspacePath: null
  })

  // Deeplink 消息缓存
  const deeplinkCache = ref<{
    msg?: string
    modelId?: string
    systemPrompt?: string
    autoSend?: boolean
    mentions?: string[]
  } | null>(null)

  // 用于管理当前激活会话的 selectedVariantsMap
  const selectedVariantsMap = ref<Record<string, string>>({})

  // 标志：是否正在更新变体选择（用于防止 LIST_UPDATED 循环）
  let isUpdatingVariant = false

  // Getters
  const getTabId = () => window.api.getWebContentsId()
  const getActiveThreadId = () => activeThreadIdMap.value.get(getTabId()) ?? null
  const setActiveThreadId = (threadId: string | null) => {
    activeThreadIdMap.value.set(getTabId(), threadId)
  }
  const bumpMessageCacheVersion = () => {
    messageCacheVersion.value += 1
  }
  const getMessageIds = () => messageIdsMap.value.get(getTabId()) ?? []
  const setMessageIds = (ids: string[]) => {
    messageIdsMap.value.set(getTabId(), ids)
    bumpMessageCacheVersion()
  }
  const ensureMessageId = (messageId: string) => {
    if (!messageId) return
    const ids = getMessageIds()
    if (ids.includes(messageId)) return
    setMessageIds([...ids, messageId])
  }
  const getLoadedMessages = () => {
    const ids = getMessageIds()
    const messages: Message[] = []
    for (const messageId of ids) {
      const message = getCachedMessage(messageId)
      if (message) {
        messages.push(message)
      }
    }
    return messages
  }
  const cacheMessageForView = (message: Message) => {
    cacheMessage(message)
    bumpMessageCacheVersion()
  }
  const cacheMessagesForView = (messages: Message[]) => {
    if (messages.length === 0) return
    cacheMessages(messages)
    bumpMessageCacheVersion()
  }
  const getCurrentThreadMessages = () => {
    const activeThreadId = getActiveThreadId()
    if (!activeThreadId) return []
    return getLoadedMessages()
  }
  const getThreadsWorkingStatus = () => {
    if (!threadsWorkingStatusMap.value.has(getTabId())) {
      threadsWorkingStatusMap.value.set(getTabId(), new Map())
    }
    return threadsWorkingStatusMap.value.get(getTabId())!
  }
  const getGeneratingMessagesCache = () => {
    if (!generatingMessagesCacheMap.value.has(getTabId())) {
      generatingMessagesCacheMap.value.set(getTabId(), new Map())
    }
    return generatingMessagesCacheMap.value.get(getTabId())!
  }
  const findMainAssistantMessageByParentId = (parentId: string) => {
    if (!parentId) return null
    const ids = getMessageIds()
    for (const messageId of ids) {
      const message = getCachedMessage(messageId)
      if (
        message &&
        message.role === 'assistant' &&
        !message.is_variant &&
        message.parentId === parentId
      ) {
        return message as AssistantMessage
      }
    }
    return null
  }

  const activeThread = computed(() => {
    return threads.value.flatMap((t) => t.dtThreads).find((t) => t.id === getActiveThreadId())
  })

  const activeContextMention = computed(() => {
    const activeThreadId = getActiveThreadId()
    if (!activeThreadId) return null
    return pendingContextMentions.value.get(activeThreadId) ?? null
  })

  const activePendingScrollTarget = computed(() => {
    const activeThreadId = getActiveThreadId()
    if (!activeThreadId) return null
    return pendingScrollTargetByConversation.value.get(activeThreadId) ?? null
  })

  const isAcpMode = computed(() => currentMode.value === 'acp agent')
  const activeAcpAgentId = computed(() =>
    isAcpMode.value ? chatConfig.value.modelId?.trim() || null : null
  )

  const activeAgentMcpSelectionsState = ref<string[] | null>(null)
  let activeAgentMcpSelectionsRequestId = 0

  const refreshActiveAgentMcpSelections = async () => {
    const requestId = ++activeAgentMcpSelectionsRequestId

    if (!isAcpMode.value || !activeAcpAgentId.value) {
      activeAgentMcpSelectionsState.value = null
      return
    }

    try {
      const selections = await configP.getAgentMcpSelections(activeAcpAgentId.value)
      if (activeAgentMcpSelectionsRequestId !== requestId) return
      activeAgentMcpSelectionsState.value = Array.isArray(selections) ? selections : []
    } catch (error) {
      if (activeAgentMcpSelectionsRequestId !== requestId) return
      console.warn('[Chat Store] Failed to load ACP agent MCP selections:', error)
      activeAgentMcpSelectionsState.value = []
    }
  }

  watch(
    [isAcpMode, activeAcpAgentId],
    () => {
      void refreshActiveAgentMcpSelections()
    },
    { immediate: true }
  )

  const activeAgentMcpSelections = computed(() => activeAgentMcpSelectionsState.value)

  const resolveVariantMessage = (
    message: Message,
    currentSelectedVariants: Record<string, string>
  ) => {
    if (message.role === 'assistant' && currentSelectedVariants[message.id]) {
      const selectedVariantId = currentSelectedVariants[message.id]
      if (!selectedVariantId) return message
      const selectedVariant = (message as AssistantMessage).variants?.find(
        (v) => v.id === selectedVariantId
      )
      if (selectedVariant) {
        const newMsg = JSON.parse(JSON.stringify(message))
        newMsg.content = selectedVariant.content
        newMsg.usage = selectedVariant.usage
        newMsg.model_id = selectedVariant.model_id
        newMsg.model_provider = selectedVariant.model_provider
        newMsg.model_name = selectedVariant.model_name
        return newMsg
      }
    }

    return message
  }

  const messageItems = computed((): MessageListItem[] => {
    const ids = getMessageIds()
    const cacheVersion = messageCacheVersion.value
    const currentSelectedVariants = selectedVariantsMap.value
    if (cacheVersion < 0) return []

    return ids.map((messageId) => {
      const cached = getCachedMessage(messageId)
      if (!cached) {
        return { id: messageId, message: null }
      }
      return {
        id: messageId,
        message: resolveVariantMessage(cached, currentSelectedVariants)
      }
    })
  })

  const variantAwareMessages = computed((): Array<Message> => {
    return messageItems.value
      .map((item) => item.message)
      .filter((message): message is Message => Boolean(message))
  })

  const messageCount = computed(() => {
    const cacheVersion = messageCacheVersion.value
    if (cacheVersion < 0) return 0
    return getMessageIds().length
  })

  const formatContextLabel = (value: string) => {
    const normalized = value.trim().replace(/\s+/g, ' ')
    if (!normalized) return 'context'
    const maxLength = 48
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, maxLength)}...`
  }

  const setPendingContextMention = (threadId: string, content: string, label?: string) => {
    if (!threadId || !content.trim()) {
      return
    }
    const displayLabel = formatContextLabel(label ?? '')
    const next = new Map(pendingContextMentions.value)
    next.set(threadId, {
      id: displayLabel,
      label: displayLabel,
      category: 'context',
      content
    })
    pendingContextMentions.value = next
  }

  const consumeContextMention = (threadId: string) => {
    if (!threadId) return
    const next = new Map(pendingContextMentions.value)
    next.delete(threadId)
    pendingContextMentions.value = next
  }

  const queueScrollTarget = (conversationId: string, target: PendingScrollTarget) => {
    if (!conversationId || (!target.messageId && !target.childConversationId)) return
    const next = new Map(pendingScrollTargetByConversation.value)
    next.set(conversationId, target)
    pendingScrollTargetByConversation.value = next
  }

  const consumePendingScrollMessage = (conversationId: string) => {
    if (!conversationId) return
    const next = new Map(pendingScrollTargetByConversation.value)
    next.delete(conversationId)
    pendingScrollTargetByConversation.value = next
  }

  // Actions
  const createNewEmptyThread = async () => {
    try {
      await clearActiveThread()
    } catch (error) {
      console.error('Failed to clear active thread and load first page:', error)
      throw error
    }
  }

  const createThread = async (title: string, settings: Partial<CONVERSATION_SETTINGS>) => {
    try {
      const normalizedSettings: Partial<CONVERSATION_SETTINGS> = { ...settings }
      const shouldAttachAcpWorkdir =
        (!normalizedSettings.acpWorkdirMap ||
          Object.keys(normalizedSettings.acpWorkdirMap).length === 0) &&
        normalizedSettings.providerId === 'acp' &&
        typeof normalizedSettings.modelId === 'string'

      if (shouldAttachAcpWorkdir && normalizedSettings.modelId) {
        const currentMap = chatConfig.value.acpWorkdirMap || {}
        const pendingWorkdir = currentMap[normalizedSettings.modelId]
        if (pendingWorkdir) {
          normalizedSettings.acpWorkdirMap = {
            [normalizedSettings.modelId]: pendingWorkdir
          }
        }
      }

      if (normalizedSettings.agentWorkspacePath === undefined) {
        const pendingWorkspacePath = chatConfig.value.agentWorkspacePath ?? null
        if (pendingWorkspacePath) {
          normalizedSettings.agentWorkspacePath = pendingWorkspacePath
        }
      }
      const threadId = await threadP.createConversation(title, normalizedSettings, getTabId())
      // 因为 createConversation 内部已经调用了 setActiveConversation
      // 并且可以确定是为当前tab激活，所以在这里可以直接、安全地更新本地状态
      // 以确保后续的 sendMessage 能正确获取 activeThreadId。
      setActiveThreadId(threadId)
      return threadId
    } catch (error) {
      console.error('Failed to create thread:', error)
      throw error
    }
  }

  const setActiveThread = async (threadId: string) => {
    // 不在渲染进程进行逻辑判定（查重）和决策，只向主进程发送意图。
    // 主进程会处理“防重”逻辑，并通过 'ACTIVATED' 事件来通知UI更新。
    // 如果主进程决定切换到其他tab，当前tab不会收到此事件，状态也就不会被错误地更新。
    const tabId = getTabId()
    await threadP.setActiveConversation(threadId, tabId)
  }

  const openThreadInNewTab = async (
    threadId: string,
    options?: { messageId?: string; childConversationId?: string }
  ) => {
    if (!threadId) return
    try {
      const tabId = getTabId()
      await threadP.openConversationInNewTab({
        conversationId: threadId,
        tabId,
        messageId: options?.messageId,
        childConversationId: options?.childConversationId
      })
    } catch (error) {
      console.error('Failed to open thread in new tab:', error)
    }
  }

  const clearActiveThread = async () => {
    const activeThreadId = getActiveThreadId()
    if (!activeThreadId) return
    const tabId = getTabId()
    await threadP.clearActiveThread(tabId)
    setActiveThreadId(null)
    setMessageIds([])
    clearCachedMessagesForThread(activeThreadId)
    clearMessageDomInfo()
    selectedVariantsMap.value = {}
    childThreadsByMessageId.value = new Map()
    pendingContextMentions.value = new Map()
    pendingScrollTargetByConversation.value = new Map()
    chatConfig.value = {
      ...chatConfig.value,
      acpWorkdirMap: {},
      agentWorkspacePath: null
    }
  }

  const clearThreadCachesForTab = (threadId: string | null) => {
    if (threadId) {
      clearCachedMessagesForThread(threadId)
      if (!generatingThreadIds.value.has(threadId)) {
        const cache = getGeneratingMessagesCache()
        for (const [messageId, cached] of cache.entries()) {
          if (cached.threadId === threadId) {
            cache.delete(messageId)
          }
        }
      }
    }
    setMessageIds([])
    clearMessageDomInfo()
    selectedVariantsMap.value = {}
    childThreadsByMessageId.value = new Map()
    pendingContextMentions.value = new Map()
    pendingScrollTargetByConversation.value = new Map()
    chatConfig.value = {
      ...chatConfig.value,
      acpWorkdirMap: {},
      agentWorkspacePath: null
    }
  }

  const setAcpWorkdirPreference = (agentId: string, workdir: string | null) => {
    if (!agentId) return
    const currentMap = chatConfig.value.acpWorkdirMap ?? {}
    const nextMap = { ...currentMap }
    if (workdir && workdir.trim().length > 0) {
      nextMap[agentId] = workdir
    } else {
      delete nextMap[agentId]
    }
    chatConfig.value = { ...chatConfig.value, acpWorkdirMap: nextMap }
  }

  const setAgentWorkspacePreference = (workspacePath: string | null) => {
    const nextPath = workspacePath?.trim() ? workspacePath : null
    chatConfig.value = { ...chatConfig.value, agentWorkspacePath: nextPath }
  }

  // 处理消息的 extra 信息
  const enrichMessageWithExtra = async (message: Message): Promise<Message> => {
    if (
      Array.isArray((message as AssistantMessage).content) &&
      (message as AssistantMessage).content.some((block) => block.extra)
    ) {
      const attachments = await threadP.getMessageExtraInfo(message.id, 'search_result')
      // 更新消息中的 extra 信息
      ;(message as AssistantMessage).content = (message as AssistantMessage).content.map(
        (block) => {
          if (block.type === 'search' && block.extra) {
            return {
              ...block,
              extra: {
                ...block.extra,
                pages: attachments.map((attachment) => ({
                  title: attachment.title,
                  url: attachment.url,
                  content: attachment.content,
                  description: attachment.description,
                  icon: attachment.icon
                }))
              }
            }
          }
          return block
        }
      )
      // 处理变体消息的 extra 信息
      const assistantMessage = message as AssistantMessage
      if (assistantMessage.variants && assistantMessage.variants.length > 0) {
        assistantMessage.variants = await Promise.all(
          assistantMessage.variants.map((variant) => enrichMessageWithExtra(variant))
        )
      }
    }

    return message
  }

  const getMessageTextForContext = (message: Message | null): string => {
    if (!message) return ''
    if (typeof message.content === 'string') {
      return message.content
    }
    if (Array.isArray(message.content)) {
      return message.content
        .map((block) => (typeof block.content === 'string' ? block.content : ''))
        .join('')
    }
    const userContent = message.content as UserMessageContent
    if (userContent.text) {
      return userContent.text
    }
    if (userContent.content && Array.isArray(userContent.content)) {
      return userContent.content.map((block) => block.content || '').join('')
    }
    return ''
  }

  const refreshChildThreadsForActiveThread = async () => {
    const activeThreadId = getActiveThreadId()
    if (!activeThreadId) {
      childThreadsByMessageId.value = new Map()
      return
    }

    const messageIds = getMessageIds()
    if (messageIds.length === 0) {
      childThreadsByMessageId.value = new Map()
      return
    }

    const childThreads = (await threadP.listChildConversationsByMessageIds(messageIds)) || []
    const nextMap = new Map<string, CONVERSATION[]>()
    for (const child of childThreads) {
      if (!child.parentMessageId) continue
      if (child.parentConversationId && child.parentConversationId !== activeThreadId) continue
      const existing = nextMap.get(child.parentMessageId) ?? []
      existing.push(child)
      nextMap.set(child.parentMessageId, existing)
    }
    childThreadsByMessageId.value = nextMap
  }

  const maybeQueueContextMention = async () => {
    const activeThreadId = getActiveThreadId()
    if (!activeThreadId) return
    if (pendingContextMentions.value.has(activeThreadId)) return
    if (getMessageIds().length > 0) return

    const active = activeThread.value
    if (!active?.parentMessageId) return

    const parentMessage = await threadP.getMessage(active.parentMessageId)
    const parentText = getMessageTextForContext(parentMessage)
    if (!parentText.trim()) return

    const selectionLabel = active.parentSelection?.selectedText ?? ''
    setPendingContextMention(activeThreadId, parentText, selectionLabel)
  }

  const PREFETCH_BUFFER = 24
  const PREFETCH_BATCH_SIZE = 80

  const fetchMessagesByIds = async (messageIds: string[]) => {
    if (!messageIds.length) return
    for (let i = 0; i < messageIds.length; i += PREFETCH_BATCH_SIZE) {
      const chunk = messageIds.slice(i, i + PREFETCH_BATCH_SIZE)
      const messages = await threadP.getMessagesByIds(chunk)
      const enriched = (await Promise.all(messages.map((msg) => enrichMessageWithExtra(msg)))) as
        | AssistantMessage[]
        | UserMessage[]
      cacheMessagesForView(enriched as Message[])
    }
  }

  const ensureMessagesLoadedByIds = async (messageIds: string[]) => {
    const missing = messageIds.filter((messageId) => !hasCachedMessage(messageId))
    if (!missing.length) return
    await fetchMessagesByIds(missing)
  }

  const prefetchMessagesForRange = async (startIndex: number, endIndex: number) => {
    const ids = getMessageIds()
    if (!ids.length) return
    const safeStart = Math.max(0, startIndex - PREFETCH_BUFFER)
    const safeEnd = Math.min(ids.length, endIndex + PREFETCH_BUFFER + 1)
    const targetIds = ids.slice(safeStart, safeEnd)
    await ensureMessagesLoadedByIds(targetIds)
  }

  const prefetchAllMessages = async () => {
    const ids = getMessageIds()
    if (!ids.length) return
    await ensureMessagesLoadedByIds(ids)
  }

  const recordMessageDomInfo = (entries: Array<{ id: string; top: number; height: number }>) => {
    setMessageDomInfo(entries)
  }

  const hasMessageDomInfo = (messageId: string) => {
    return Boolean(getMessageDomInfo(messageId))
  }

  const loadMessages = async () => {
    if (!getActiveThreadId()) return

    try {
      childThreadsByMessageId.value = new Map()
      const messageIds = (await threadP.getMessageIds(getActiveThreadId()!)) || []
      setMessageIds(Array.isArray(messageIds) ? messageIds : [])
      const activeThread = getActiveThreadId()
      for (const [, cached] of getGeneratingMessagesCache()) {
        if (cached.threadId === activeThread) {
          const enriched = await enrichMessageWithExtra(cached.message)
          if (!enriched.is_variant) {
            cacheMessageForView(enriched)
            ensureMessageId(enriched.id)
          }
        }
      }
      await prefetchMessagesForRange(0, Math.min(messageIds.length - 1, 50))
      await refreshChildThreadsForActiveThread()
      await maybeQueueContextMention()
    } catch (error) {
      console.error('Failed to load messages:', error)
      throw error
    }
  }

  const sendMessage = async (content: UserMessageContent | AssistantMessageBlock[]) => {
    const threadId = getActiveThreadId()
    if (!threadId || !content) return

    try {
      generatingThreadIds.value.add(threadId)
      // 设置当前会话的workingStatus为working
      updateThreadWorkingStatus(threadId, 'working')
      const aiResponseMessage = await agentP.sendMessage(
        threadId,
        JSON.stringify(content),
        getTabId(),
        selectedVariantsMap.value
      )

      if (!aiResponseMessage) {
        throw new Error('Failed to create assistant message')
      }

      // 将消息添加到缓存
      getGeneratingMessagesCache().set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId
      })
      cacheMessageForView(aiResponseMessage)
      ensureMessageId(aiResponseMessage.id)

      await loadMessages()
    } catch (error) {
      console.error('Failed to send message:', error)
      // 发生错误时，务必清理 loading 状态
      if (threadId) {
        generatingThreadIds.value.delete(threadId)
        // 强制触发响应式更新
        generatingThreadIds.value = new Set(generatingThreadIds.value)
        updateThreadWorkingStatus(threadId, 'error')
      }
      throw error
    }
  }

  const retryMessage = async (messageId: string) => {
    if (!getActiveThreadId()) return
    try {
      const aiResponseMessage = await agentP.retryMessage(messageId, selectedVariantsMap.value)
      let didUpdateVariant = false
      // 将正在生成的变体消息缓存起来，但不插入消息列表，避免额外的消息行
      getGeneratingMessagesCache().set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: getActiveThreadId()!
      })
      // 将新变体挂到主消息，确保流式更新能渲染到当前消息上
      if (aiResponseMessage.parentId) {
        const mainMessage = findMainAssistantMessageByParentId(aiResponseMessage.parentId)
        if (mainMessage) {
          if (!mainMessage.variants) {
            mainMessage.variants = []
          }
          const existingIndex = mainMessage.variants.findIndex((v) => v.id === aiResponseMessage.id)
          if (existingIndex !== -1) {
            mainMessage.variants[existingIndex] = aiResponseMessage
          } else {
            mainMessage.variants.push(aiResponseMessage)
          }
          cacheMessageForView({ ...mainMessage })
          ensureMessageId(mainMessage.id)
          await updateSelectedVariant(mainMessage.id, aiResponseMessage.id)
          didUpdateVariant = true
        }
      }
      await loadMessages()
      if (aiResponseMessage.parentId && !didUpdateVariant) {
        const mainMessage = await threadP.getMainMessageByParentId(
          getActiveThreadId()!,
          aiResponseMessage.parentId
        )
        if (mainMessage) {
          await updateSelectedVariant(mainMessage.id, aiResponseMessage.id)
        }
      }
      generatingThreadIds.value.add(getActiveThreadId()!)
      // 设置当前会话的workingStatus为working
      updateThreadWorkingStatus(getActiveThreadId()!, 'working')
    } catch (error) {
      console.error('Failed to retry message:', error)
      throw error
    }
  }

  const regenerateFromUserMessage = async (userMessageId: string) => {
    const activeThread = getActiveThreadId()
    if (!activeThread) return
    try {
      generatingThreadIds.value.add(activeThread)
      updateThreadWorkingStatus(activeThread, 'working')

      const aiResponseMessage = await agentP.regenerateFromUserMessage(
        activeThread,
        userMessageId,
        selectedVariantsMap.value
      )

      getGeneratingMessagesCache().set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: getActiveThreadId()!
      })
      cacheMessageForView(aiResponseMessage)
      ensureMessageId(aiResponseMessage.id)

      await loadMessages()
    } catch (error) {
      console.error('Failed to regenerate from user message:', error)
      throw error
    }
  }

  const retryFromUserMessage = async (userMessageId: string) => {
    const activeThread = getActiveThreadId()
    if (!activeThread) return false

    try {
      const mainMessage = await threadP.getMainMessageByParentId(activeThread, userMessageId)
      if (mainMessage) {
        await retryMessage(mainMessage.id)
        return true
      }

      await regenerateFromUserMessage(userMessageId)
      return true
    } catch (error) {
      console.error('Failed to retry from user message:', error)
      throw error
    }
  }

  // 创建会话分支（从指定消息开始fork一个新会话）
  const forkThread = async (messageId: string, forkTag: string = '(fork)') => {
    const activeThread = getActiveThreadId()
    if (!activeThread) return

    try {
      // 获取当前会话信息
      const currentThread = await threadP.getConversation(activeThread)

      // 创建分支会话标题
      const newThreadTitle = `${currentThread.title} ${forkTag}`

      // 调用main层的forkConversation方法
      const newThreadId = await threadP.forkConversation(
        activeThread,
        messageId,
        newThreadTitle,
        currentThread.settings,
        selectedVariantsMap.value
      )

      // 切换到新会话
      await setActiveThread(newThreadId)

      return newThreadId
    } catch (error) {
      console.error('Failed to create thread branch:', error)
      throw error
    }
  }

  const createChildThreadFromSelection = async (payload: {
    parentMessageId: string
    parentSelection: ParentSelection
  }) => {
    const activeThread = getActiveThreadId()
    if (!activeThread) return

    try {
      const parentThreadId = activeThread
      const parentConversation = await threadP.getConversation(activeThread)
      const selectionSnippet = payload.parentSelection.selectedText
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 48)
      const title = selectionSnippet
        ? `${parentConversation.title} - ${selectionSnippet}`
        : parentConversation.title

      const newThreadId = await threadP.createChildConversationFromSelection({
        parentConversationId: activeThread,
        parentMessageId: payload.parentMessageId,
        parentSelection: payload.parentSelection,
        title,
        settings: parentConversation.settings,
        tabId: getTabId(),
        openInNewTab: true
      })

      if (!newThreadId) {
        return
      }

      if (getActiveThreadId() === parentThreadId) {
        await refreshChildThreadsForActiveThread()
      }
      return newThreadId
    } catch (error) {
      console.error('Failed to create child thread from selection:', error)
      throw error
    }
  }

  const handleStreamResponse = (msg: {
    eventId: string
    conversationId?: string
    parentId?: string
    is_variant?: boolean
    stream_kind?: 'init' | 'delta' | 'final'
    seq?: number
    content?: string
    reasoning_content?: string
    reasoning_time?: { start: number; end: number }
    tool_call_id?: string
    tool_call_name?: string
    tool_call_params?: string
    tool_call_response?: string
    maximum_tool_calls_reached?: boolean
    tool_call_server_name?: string
    tool_call_server_icons?: string
    tool_call_server_description?: string
    tool_call_response_raw?: unknown
    tool_call?:
      | 'start'
      | 'end'
      | 'error'
      | 'update'
      | 'running'
      | 'permission-required'
      | 'permission-granted'
      | 'permission-denied'
      | 'continue'
    permission_request?: {
      toolName: string
      serverName: string
      permissionType: 'read' | 'write' | 'all' | 'command'
      description: string
      command?: string
      commandSignature?: string
      commandInfo?: {
        command: string
        riskLevel: 'low' | 'medium' | 'high' | 'critical'
        suggestion: string
        signature?: string
        baseCommand?: string
      }
      providerId?: string
      requestId?: string
      sessionId?: string
      agentId?: string
      agentName?: string
      conversationId?: string
      options?: Array<{
        id: string
        label: string
        description?: string
      }>
      rememberable?: boolean
    }
    totalUsage?: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
    image_data?: {
      data: string
      mimeType: string
    }
    rate_limit?: {
      providerId: string
      qpsLimit: number
      currentQps: number
      queueLength: number
      estimatedWaitTime?: number
    }
  }) => {
    const { eventId, conversationId, parentId, is_variant, stream_kind } = msg

    // 非当前会话的消息直接忽略（性能优化）
    if (conversationId && conversationId !== getActiveThreadId()) {
      return
    }

    // 处理 init 事件：创建骨架消息行
    if (stream_kind === 'init') {
      if (hasCachedMessage(eventId)) {
        return
      }

      const skeleton: AssistantMessage = {
        id: eventId,
        conversationId: conversationId ?? getActiveThreadId() ?? '',
        parentId: parentId ?? '',
        role: 'assistant',
        content: [],
        timestamp: Date.now(),
        status: 'pending',
        usage: {
          context_usage: 0,
          tokens_per_second: 0,
          total_tokens: 0,
          generation_time: 0,
          first_token_time: 0,
          reasoning_start_time: 0,
          reasoning_end_time: 0,
          input_tokens: 0,
          output_tokens: 0
        },
        avatar: '',
        name: '',
        model_name: '',
        model_id: '',
        model_provider: '',
        error: '',
        is_variant: Number(is_variant),
        variants: []
      }

      cacheMessageForView(skeleton)
      if (!skeleton.is_variant) {
        ensureMessageId(eventId)
      }

      return
    }

    // 从缓存中查找消息
    const cached = getGeneratingMessagesCache().get(eventId)
    const fallbackCached = cached ? null : (getCachedMessage(eventId) as Message | null)
    const message = cached?.message ?? fallbackCached
    const activeThreadId = cached?.threadId ?? getActiveThreadId()

    if (!message || message.role !== 'assistant') {
      return
    }

    const assistantMsg = message as AssistantMessage

    if (!Array.isArray(assistantMsg.content)) {
      return
    }

    // 处理工具调用达到最大次数的情况
    if (msg.maximum_tool_calls_reached) {
      finalizeAssistantMessageBlocks(assistantMsg.content)
      assistantMsg.content.push({
        type: 'action',
        content: 'common.error.maximumToolCallsReached',
        status: 'success',
        timestamp: Date.now(),
        action_type: 'maximum_tool_calls_reached',
        tool_call: {
          id: msg.tool_call_id,
          name: msg.tool_call_name,
          params: msg.tool_call_params,
          server_name: msg.tool_call_server_name,
          server_icons: msg.tool_call_server_icons,
          server_description: msg.tool_call_server_description
        },
        extra: {
          needContinue: true
        }
      })
    } else if (msg.tool_call) {
      if (msg.tool_call === 'permission-required') {
        finalizeAssistantMessageBlocks(assistantMsg.content)
        const permissionRequest = msg.permission_request
        const permissionExtra: Record<string, string | boolean> = {
          needsUserAction: true,
          permissionType: permissionRequest?.permissionType ?? 'read'
        }
        if (permissionRequest) {
          permissionExtra.permissionRequest = JSON.stringify(permissionRequest)
          if (permissionRequest.commandInfo) {
            permissionExtra.commandInfo = JSON.stringify(permissionRequest.commandInfo)
          }
          if (permissionRequest.toolName) {
            permissionExtra.toolName = permissionRequest.toolName
          }
          if (permissionRequest.serverName) {
            permissionExtra.serverName = permissionRequest.serverName
          }
          if (permissionRequest.providerId) {
            permissionExtra.providerId = permissionRequest.providerId
          }
          if (permissionRequest.requestId) {
            permissionExtra.permissionRequestId = permissionRequest.requestId
          }
          if (permissionRequest.rememberable === false) {
            permissionExtra.rememberable = false
          }
          if (permissionRequest.agentId) {
            permissionExtra.agentId = permissionRequest.agentId
          }
          if (permissionRequest.agentName) {
            permissionExtra.agentName = permissionRequest.agentName
          }
          if (permissionRequest.sessionId) {
            permissionExtra.sessionId = permissionRequest.sessionId
          }
        }
        assistantMsg.content.push({
          type: 'action',
          content: msg.tool_call_response || '',
          status: 'pending',
          timestamp: Date.now(),
          action_type: 'tool_call_permission',
          tool_call: {
            id: msg.tool_call_id,
            name: msg.tool_call_name,
            params: msg.tool_call_params || '',
            server_name: msg.tool_call_server_name,
            server_icons: msg.tool_call_server_icons,
            server_description: msg.tool_call_server_description
          },
          extra: permissionExtra
        })
      } else if (
        msg.tool_call === 'permission-granted' ||
        msg.tool_call === 'permission-denied' ||
        msg.tool_call === 'continue'
      ) {
        const permissionBlock = [...assistantMsg.content]
          .reverse()
          .find(
            (block) =>
              block.type === 'action' &&
              block.action_type === 'tool_call_permission' &&
              (msg.tool_call_id
                ? block.tool_call?.id === msg.tool_call_id
                : block.tool_call?.name === msg.tool_call_name)
          )
        if (permissionBlock?.type === 'action') {
          if (msg.tool_call === 'permission-granted') {
            permissionBlock.status = 'granted'
            permissionBlock.content = msg.tool_call_response || ''
            if (permissionBlock.extra) {
              permissionBlock.extra.needsUserAction = false
              if (
                !permissionBlock.extra.grantedPermissions &&
                typeof permissionBlock.extra.permissionType === 'string'
              ) {
                permissionBlock.extra.grantedPermissions = permissionBlock.extra.permissionType
              }
            }
          } else if (msg.tool_call === 'permission-denied') {
            permissionBlock.status = 'denied'
            permissionBlock.content = msg.tool_call_response || ''
            if (permissionBlock.extra) {
              permissionBlock.extra.needsUserAction = false
            }
          } else {
            permissionBlock.status = 'success'
          }
        }
      } else if (msg.tool_call === 'start') {
        finalizeAssistantMessageBlocks(assistantMsg.content)
        playToolcallSound()
        assistantMsg.content.push({
          type: 'tool_call',
          content: '',
          status: 'loading',
          timestamp: Date.now(),
          tool_call: {
            id: msg.tool_call_id,
            name: msg.tool_call_name,
            params: msg.tool_call_params || '',
            server_name: msg.tool_call_server_name,
            server_icons: msg.tool_call_server_icons,
            server_description: msg.tool_call_server_description
          }
        })
      } else if (msg.tool_call === 'update') {
        const existingToolCallBlock = assistantMsg.content.find(
          (block) =>
            block.type === 'tool_call' &&
            ((msg.tool_call_id && block.tool_call?.id === msg.tool_call_id) ||
              block.tool_call?.name === msg.tool_call_name) &&
            block.status === 'loading'
        )
        if (existingToolCallBlock?.type === 'tool_call' && existingToolCallBlock.tool_call) {
          existingToolCallBlock.tool_call.params = msg.tool_call_params || ''
          if (msg.tool_call_server_name) {
            existingToolCallBlock.tool_call.server_name = msg.tool_call_server_name
          }
          if (msg.tool_call_server_icons) {
            existingToolCallBlock.tool_call.server_icons = msg.tool_call_server_icons
          }
          if (msg.tool_call_server_description) {
            existingToolCallBlock.tool_call.server_description = msg.tool_call_server_description
          }
        }
      } else if (msg.tool_call === 'running') {
        const existingToolCallBlock = assistantMsg.content.find(
          (block) =>
            block.type === 'tool_call' &&
            ((msg.tool_call_id && block.tool_call?.id === msg.tool_call_id) ||
              block.tool_call?.name === msg.tool_call_name) &&
            block.status === 'loading'
        )
        if (existingToolCallBlock?.type === 'tool_call') {
          existingToolCallBlock.status = 'loading'
          if (existingToolCallBlock.tool_call) {
            existingToolCallBlock.tool_call.params =
              msg.tool_call_params || existingToolCallBlock.tool_call.params
            if (msg.tool_call_server_name) {
              existingToolCallBlock.tool_call.server_name = msg.tool_call_server_name
            }
            if (msg.tool_call_server_icons) {
              existingToolCallBlock.tool_call.server_icons = msg.tool_call_server_icons
            }
            if (msg.tool_call_server_description) {
              existingToolCallBlock.tool_call.server_description = msg.tool_call_server_description
            }
          }
        } else {
          finalizeAssistantMessageBlocks(assistantMsg.content)
          assistantMsg.content.push({
            type: 'tool_call',
            content: '',
            status: 'loading',
            timestamp: Date.now(),
            tool_call: {
              id: msg.tool_call_id,
              name: msg.tool_call_name,
              params: msg.tool_call_params || '',
              server_name: msg.tool_call_server_name,
              server_icons: msg.tool_call_server_icons,
              server_description: msg.tool_call_server_description
            }
          })
        }
      } else if (msg.tool_call === 'end' || msg.tool_call === 'error') {
        const existingToolCallBlock = assistantMsg.content.find(
          (block) =>
            block.type === 'tool_call' &&
            ((msg.tool_call_id && block.tool_call?.id === msg.tool_call_id) ||
              block.tool_call?.name === msg.tool_call_name) &&
            block.status === 'loading'
        )
        if (existingToolCallBlock?.type === 'tool_call') {
          if (msg.tool_call === 'error') {
            existingToolCallBlock.status = 'error'
            if (existingToolCallBlock.tool_call) {
              existingToolCallBlock.tool_call.response =
                msg.tool_call_response || 'tool call failed'
            }
          } else {
            existingToolCallBlock.status = 'success'
            if (msg.tool_call_response && existingToolCallBlock.tool_call) {
              existingToolCallBlock.tool_call.response = msg.tool_call_response
            }
          }
        }
      }
    } else if (msg.image_data) {
      finalizeAssistantMessageBlocks(assistantMsg.content)
      assistantMsg.content.push({
        type: 'image',
        content: 'image',
        status: 'success',
        timestamp: Date.now(),
        image_data: {
          data: msg.image_data.data,
          mimeType: msg.image_data.mimeType
        }
      })
    } else if (msg.rate_limit) {
      finalizeAssistantMessageBlocks(assistantMsg.content)
      assistantMsg.content.push({
        type: 'action',
        content: 'chat.messages.rateLimitWaiting',
        status: 'loading',
        timestamp: Date.now(),
        action_type: 'rate_limit',
        extra: {
          providerId: msg.rate_limit.providerId,
          qpsLimit: msg.rate_limit.qpsLimit,
          currentQps: msg.rate_limit.currentQps,
          queueLength: msg.rate_limit.queueLength,
          estimatedWaitTime: msg.rate_limit.estimatedWaitTime ?? 0
        }
      })
    } else if (msg.content) {
      const lastContentBlock = assistantMsg.content[assistantMsg.content.length - 1]
      if (lastContentBlock?.type === 'content') {
        lastContentBlock.content += msg.content
      } else {
        // Finalize previous blocks (e.g., reasoning_content) before adding new content block
        finalizeAssistantMessageBlocks(assistantMsg.content)
        assistantMsg.content.push({
          type: 'content',
          content: msg.content,
          status: 'loading',
          timestamp: Date.now()
        })
      }
      playTypewriterSound()
    }

    if (msg.reasoning_content) {
      const lastReasoningBlock = assistantMsg.content[assistantMsg.content.length - 1]
      if (lastReasoningBlock?.type === 'reasoning_content') {
        lastReasoningBlock.content += msg.reasoning_content
        // Update reasoning_time from stream data
        if (msg.reasoning_time) {
          lastReasoningBlock.reasoning_time = msg.reasoning_time
        }
      } else {
        const now = Date.now()
        assistantMsg.content.push({
          type: 'reasoning_content',
          content: msg.reasoning_content,
          status: 'loading',
          timestamp: now,
          reasoning_time: msg.reasoning_time ?? { start: now, end: now }
        })
      }
    }

    if (msg.totalUsage) {
      assistantMsg.usage = {
        ...assistantMsg.usage,
        total_tokens: msg.totalUsage.total_tokens,
        input_tokens: msg.totalUsage.prompt_tokens,
        output_tokens: msg.totalUsage.completion_tokens
      }
    }

    if (activeThreadId === getActiveThreadId()) {
      cacheMessageForView(assistantMsg)
      if (!assistantMsg.is_variant) {
        ensureMessageId(assistantMsg.id)
      }

      if (assistantMsg.is_variant && assistantMsg.parentId) {
        const mainMessage = findMainAssistantMessageByParentId(assistantMsg.parentId)
        if (mainMessage) {
          if (!mainMessage.variants) {
            mainMessage.variants = []
          }
          const variantIndex = mainMessage.variants.findIndex((v) => v.id === assistantMsg.id)
          if (variantIndex !== -1) {
            mainMessage.variants[variantIndex] = assistantMsg
          } else {
            mainMessage.variants.push(assistantMsg)
          }
          cacheMessageForView(mainMessage)
          ensureMessageId(mainMessage.id)
        }
      }
    }
  }

  const handleStreamEnd = async (msg: { eventId: string }) => {
    // 从缓存中移除消息
    const cached = getGeneratingMessagesCache().get(msg.eventId)
    if (cached) {
      // 获取最新的消息并处理 extra 信息
      const updatedMessage = await threadP.getMessage(msg.eventId)
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      getGeneratingMessagesCache().delete(msg.eventId)
      generatingThreadIds.value.delete(cached.threadId)
      generatingThreadIds.value = new Set(generatingThreadIds.value)
      // 设置会话的workingStatus为completed
      // 如果是当前活跃的会话，则直接从Map中移除
      if (getActiveThreadId() === cached.threadId) {
        getThreadsWorkingStatus().delete(cached.threadId)
      } else {
        updateThreadWorkingStatus(cached.threadId, 'completed')
      }

      // 检查窗口是否聚焦，如果未聚焦则发送通知
      // const isFocused = await windowP.isMainWindowFocused(windowP.mainWindow?.id)
      // if (!isFocused) {
      //   // 获取生成内容的前20个字符作为通知内容
      //   let notificationContent = ''
      //   if (enrichedMessage && (enrichedMessage as AssistantMessage).content) {
      //     const assistantMsg = enrichedMessage as AssistantMessage
      //     // 从content中提取文本内容
      //     for (const block of assistantMsg.content) {
      //       if (block.type === 'content' && block.content) {
      //         notificationContent = block.content.substring(0, 20)
      //         if (block.content.length > 20) notificationContent += '...'
      //         break
      //       }
      //     }
      //   }

      //   // 发送通知
      //   await notificationP.showNotification({
      //     id: `chat/${cached.threadId}/${msg.eventId}`,
      //     title: t('chat.notify.generationComplete'),
      //     body: notificationContent || t('chat.notify.generationComplete')
      //   })
      // }

      // 如果是变体消息，需要更新主消息
      if (enrichedMessage.is_variant && enrichedMessage.parentId) {
        // 获取主消息
        const mainMessage = await threadP.getMainMessageByParentId(
          cached.threadId,
          enrichedMessage.parentId
        )

        if (mainMessage) {
          const enrichedMainMessage = await enrichMessageWithExtra(mainMessage)
          // 如果是当前激活的会话，更新显示
          if (getActiveThreadId() === cached.threadId) {
            cacheMessageForView(enrichedMainMessage as AssistantMessage | UserMessage)
            ensureMessageId(enrichedMainMessage.id)
          }
        }
      } else {
        // 如果是当前激活的会话，更新显示
        if (getActiveThreadId() === cached.threadId) {
          cacheMessageForView(enrichedMessage as AssistantMessage | UserMessage)
          ensureMessageId(enrichedMessage.id)
        }
      }
    }
  }

  const handleStreamError = async (msg: { eventId: string }) => {
    // 从缓存中获取消息
    let cached = getGeneratingMessagesCache().get(msg.eventId)
    let threadId = cached?.threadId

    // 如果缓存中没有，尝试从当前消息列表中查找对应的会话ID
    if (!threadId) {
      try {
        const foundMessage = await threadP.getMessage(msg.eventId)
        threadId = foundMessage.conversationId
      } catch (error) {
        console.warn('Failed to locate message thread for stream error:', error)
      }
    }

    if (threadId) {
      try {
        const updatedMessage = await threadP.getMessage(msg.eventId)
        const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

        if (enrichedMessage.is_variant && enrichedMessage.parentId) {
          // 处理变体消息的错误状态
          const mainMessage = findMainAssistantMessageByParentId(enrichedMessage.parentId)
          if (mainMessage) {
            if (!mainMessage.variants) {
              mainMessage.variants = []
            }
            const variantIndex = mainMessage.variants.findIndex((v) => v.id === enrichedMessage.id)
            if (variantIndex !== -1) {
              mainMessage.variants[variantIndex] = enrichedMessage
            } else {
              mainMessage.variants.push(enrichedMessage)
            }
            cacheMessageForView({ ...mainMessage })
            ensureMessageId(mainMessage.id)
          }
        } else {
          // 非变体消息的原有错误处理逻辑
          cacheMessageForView(enrichedMessage as AssistantMessage | UserMessage)
          ensureMessageId(enrichedMessage.id)
        }
        const wid = window.api.getWindowId() || 0
        // 检查窗口是否聚焦，如果未聚焦则发送错误通知
        const isFocused = await windowP.isMainWindowFocused(wid)
        if (!isFocused) {
          // 获取错误信息
          let errorMessage = t('chat.notify.generationError')
          if (enrichedMessage && (enrichedMessage as AssistantMessage).content) {
            const assistantMsg = enrichedMessage as AssistantMessage
            // 查找错误信息块
            for (const block of assistantMsg.content) {
              if (block.status === 'error' && block.content) {
                errorMessage = block.content.substring(0, 20)
                if (block.content.length > 20) errorMessage += '...'
                break
              }
            }
          }

          // 发送错误通知
          await notificationP.showNotification({
            id: `error-${msg.eventId}`,
            title: t('chat.notify.generationError'),
            body: errorMessage
          })
        }
      } catch (error) {
        console.error('Failed to load error message:', error)
      }

      getGeneratingMessagesCache().delete(msg.eventId)
      generatingThreadIds.value.delete(threadId)
      // 设置会话的workingStatus为error
      // 如果是当前活跃的会话，则直接从Map中移除
      if (getActiveThreadId() === threadId) {
        getThreadsWorkingStatus().delete(threadId)
      } else {
        updateThreadWorkingStatus(threadId, 'error')
      }
    }
  }

  const renameThread = async (threadId: string, title: string) => {
    await threadP.renameConversation(threadId, title)
  }

  const toggleThreadPinned = async (threadId: string, isPinned: boolean) => {
    await threadP.toggleConversationPinned(threadId, isPinned)
  }

  // 配置相关的方法
  const loadChatConfig = async () => {
    const activeThread = getActiveThreadId()
    if (!activeThread) return
    try {
      const conversation = await threadP.getConversation(activeThread)
      const threadToUpdate = threads.value
        .flatMap((thread) => thread.dtThreads)
        .find((t) => t.id === activeThread)
      if (threadToUpdate) {
        Object.assign(threadToUpdate, conversation)
      }
      if (conversation) {
        chatConfig.value = {
          ...conversation.settings,
          acpWorkdirMap: conversation.settings.acpWorkdirMap ?? {}
        }
        // Populate the in-memory map from the loaded settings
        if (conversation.settings.selectedVariantsMap) {
          selectedVariantsMap.value = { ...conversation.settings.selectedVariantsMap }
        } else {
          selectedVariantsMap.value = {}
        }
      }
    } catch (error) {
      console.error('Failed to load conversation config:', error)
      throw error
    }
  }

  const saveChatConfig = async () => {
    const activeThread = getActiveThreadId()
    if (!activeThread) return
    try {
      await threadP.updateConversationSettings(activeThread, chatConfig.value)
    } catch (error) {
      console.error('Failed to save conversation config:', error)
      throw error
    }
  }

  const updateChatConfig = async (newConfig: Partial<CONVERSATION_SETTINGS>) => {
    chatConfig.value = { ...chatConfig.value, ...newConfig }
    await saveChatConfig()
    // Removed loadChatConfig() call to avoid triggering watch loops
    // loadChatConfig() should only be called when switching conversations, not after every config update
  }

  const deleteMessage = async (messageId: string) => {
    const activeThreadId = getActiveThreadId()
    if (!activeThreadId) return

    try {
      const messages = getLoadedMessages()
      let parentMessage: AssistantMessage | undefined
      let parentIndex = -1
      const mainMsgIndex = messages.findIndex((m) => m.id === messageId)
      if (mainMsgIndex !== -1 && (messages[mainMsgIndex] as AssistantMessage).is_variant === 0) {
        if (selectedVariantsMap.value[messageId]) {
          delete selectedVariantsMap.value[messageId]
          await updateSelectedVariant(messageId, null)
        }
      } else {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as AssistantMessage
          if (msg.role === 'assistant' && msg.variants?.some((v) => v.id === messageId)) {
            parentMessage = msg
            parentIndex = i
            break
          }
        }

        if (parentMessage && parentIndex !== -1) {
          const remainingVariants = parentMessage.variants?.filter((v) => v.id !== messageId) || []
          parentMessage.variants = remainingVariants
          messages[parentIndex] = { ...parentMessage }
          const newSelectedVariantId =
            remainingVariants.length > 0 ? remainingVariants[remainingVariants.length - 1].id : null
          await updateSelectedVariant(parentMessage.id, newSelectedVariantId)
        }
      }

      await threadP.deleteMessage(messageId)
      deleteCachedMessage(messageId)
      await loadMessages()
    } catch (error) {
      console.error('Failed to delete message:', error)
      await loadMessages()
    }
  }

  const clearAllMessages = async (threadId: string) => {
    if (!threadId) return
    try {
      await threadP.clearAllMessages(threadId)
      clearCachedMessagesForThread(threadId)
      // 清空本地消息列表
      if (threadId === getActiveThreadId()) {
        setMessageIds([])
        clearMessageDomInfo()
      }
      // 清空生成缓存中的相关消息
      const cache = getGeneratingMessagesCache()
      for (const [messageId, cached] of cache.entries()) {
        if (cached.threadId === threadId) {
          cache.delete(messageId)
        }
      }
      generatingThreadIds.value.delete(threadId)
      generatingThreadIds.value = new Set(generatingThreadIds.value)
      // 从状态Map中移除会话状态
      getThreadsWorkingStatus().delete(threadId)
    } catch (error) {
      console.error('Failed to clear messages:', error)
      throw error
    }
  }

  const cancelGenerating = async (threadId: string) => {
    if (!threadId) return
    try {
      const workspaceStore = useWorkspaceStore()
      await workspaceStore.terminateAllRunningCommands()

      // 找到当前正在生成的消息
      const cache = getGeneratingMessagesCache()
      const generatingMessage = Array.from(cache.entries()).find(
        ([, cached]) => cached.threadId === threadId
      ) as string[]
      if (generatingMessage) {
        const [messageId] = generatingMessage
        await agentP.cancelLoop(messageId)
        // 从缓存中移除消息
        cache.delete(messageId)
        generatingThreadIds.value.delete(threadId)
        // 设置会话的workingStatus为completed
        if (getActiveThreadId() === threadId) {
          getThreadsWorkingStatus().delete(threadId)
        } else {
          updateThreadWorkingStatus(threadId, 'completed')
        }
        // 获取更新后的消息
        const updatedMessage = await threadP.getMessage(messageId)
        const enrichedMessage = await enrichMessageWithExtra(updatedMessage)
        cacheMessageForView(enrichedMessage)
        if (!enrichedMessage.is_variant) {
          ensureMessageId(enrichedMessage.id)
        }
      }
    } catch (error) {
      console.error('Failed to cancel generation:', error)
    }
  }
  const continueStream = async (conversationId: string, messageId: string) => {
    if (!conversationId || !messageId) return
    try {
      generatingThreadIds.value.add(conversationId)
      generatingThreadIds.value = new Set(generatingThreadIds.value)
      // 设置会话的workingStatus为working
      updateThreadWorkingStatus(conversationId, 'working')

      const aiResponseMessage = await agentP.continueLoop(
        conversationId,
        messageId,
        selectedVariantsMap.value
      )

      if (!aiResponseMessage) {
        console.error('Failed to create assistant message')
        return
      }

      // 将消息添加到缓存
      getGeneratingMessagesCache().set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: conversationId
      })
      cacheMessageForView(aiResponseMessage)
      ensureMessageId(aiResponseMessage.id)

      await loadMessages()
    } catch (error) {
      console.error('Failed to continue generation:', error)
      throw error
    }
  }

  // 新增：监听来自主进程的初始化并发送消息的指令
  window.electron.ipcRenderer.on(
    'command:send-initial-message',
    async (_, data: { userInput: string }) => {
      // 确保当前有活动的会话
      if (!getActiveThreadId()) {
        console.error('Received send-initial-message command but no active thread is set.')
        return
      }

      try {
        // 调用已有的 sendMessage 方法，这将复用所有现有逻辑
        await sendMessage({
          text: data.userInput,
          files: [],
          links: [],
          think: false,
          search: false
        })
      } catch (error) {
        console.error('Failed to handle send-initial-message command:', error)
      }
    }
  )

  const handleMessageEdited = async (msgId: string) => {
    // 首先检查是否在生成缓存中
    const cached = getGeneratingMessagesCache().get(msgId)
    const activeThreadId = getActiveThreadId()
    if (!cached && !activeThreadId) return

    // 获取最新的消息
    const updatedMessage = await threadP.getMessage(msgId)
    // 处理 extra 信息
    const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

    // 更新缓存
    if (cached) {
      cached.message = enrichedMessage as AssistantMessage | UserMessage
    }

    if (!activeThreadId) return

    // 非当前会话的消息直接忽略，避免跨会话污染
    if (enrichedMessage.conversationId !== activeThreadId) {
      return
    }

    // 如果是当前会话的消息，也更新显示
    if (enrichedMessage.is_variant && enrichedMessage.parentId) {
      const mainMessage = await threadP.getMainMessageByParentId(
        activeThreadId,
        enrichedMessage.parentId
      )
      if (mainMessage) {
        const enrichedMainMessage = await enrichMessageWithExtra(mainMessage)
        cacheMessageForView(enrichedMainMessage as AssistantMessage | UserMessage)
        ensureMessageId(enrichedMainMessage.id)
        return
      }
    }

    cacheMessageForView(enrichedMessage as AssistantMessage | UserMessage)
    if (!enrichedMessage.is_variant) {
      ensureMessageId(enrichedMessage.id)
    }
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  // 更新和持久化变体选择
  const updateSelectedVariant = async (mainMessageId: string, selectedVariantId: string | null) => {
    const activeThreadId = getActiveThreadId()
    if (!activeThreadId) return

    isUpdatingVariant = true

    // 更新内存中的映射
    if (selectedVariantId && selectedVariantId !== mainMessageId) {
      selectedVariantsMap.value[mainMessageId] = selectedVariantId
    } else {
      delete selectedVariantsMap.value[mainMessageId]
    }

    // 同步更新 chatConfig
    if (chatConfig.value) {
      chatConfig.value.selectedVariantsMap = { ...selectedVariantsMap.value }
    }

    // 持久化到后端
    try {
      await threadP.updateConversationSettings(activeThreadId, {
        selectedVariantsMap: selectedVariantsMap.value
      })
    } catch (error) {
      console.error('Failed to update selected variant:', error)
    } finally {
      setTimeout(() => {
        isUpdatingVariant = false
      }, 100)
    }
  }

  const clearSelectedVariantForMessage = (mainMessageId: string): boolean => {
    if (!mainMessageId) return false
    if (!selectedVariantsMap.value[mainMessageId]) return false
    void updateSelectedVariant(mainMessageId, null)
    return true
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  let typewriterAudio: HTMLAudioElement | null = null
  let toolcallAudio: HTMLAudioElement | null = null

  let lastSoundTime = 0
  const soundInterval = 120

  const initAudio = () => {
    if (!typewriterAudio) {
      typewriterAudio = new Audio(sfxtyMp3)
      typewriterAudio.volume = 0.6
      typewriterAudio.load()
    }
    if (!toolcallAudio) {
      toolcallAudio = new Audio(sfxfcMp3)
      toolcallAudio.volume = 1
      toolcallAudio.load()
    }
  }

  initAudio()

  const playTypewriterSound = () => {
    const now = Date.now()
    if (!soundStore.soundEnabled || !typewriterAudio) return
    if (now - lastSoundTime > soundInterval) {
      typewriterAudio.currentTime = 0
      typewriterAudio.play().catch(console.error)
      lastSoundTime = now
    }
  }

  const playToolcallSound = () => {
    if (!soundStore.soundEnabled || !toolcallAudio) return
    toolcallAudio.currentTime = 0
    toolcallAudio.play().catch(console.error)
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  // 注册 deeplink 事件处理
  window.electron.ipcRenderer.on(DEEPLINK_EVENTS.START, async (_, data) => {
    console.log(`[Renderer] Tab ${getTabId()} received DEEPLINK_EVENTS.START:`, data)
    // 确保路由正确
    const currentRoute = router.currentRoute.value
    if (currentRoute.name !== 'chat') {
      await router.push({ name: 'chat' })
    }
    // 如果存在活动会话，创建新会话
    if (getActiveThreadId()) {
      await clearActiveThread()
    }
    // 存储 deeplink 数据到缓存
    if (data) {
      deeplinkCache.value = {
        msg: data.msg,
        modelId: data.modelId,
        systemPrompt: data.systemPrompt,
        autoSend: data.autoSend,
        mentions: data.mentions
      }
    }
  })

  // 清理 Deeplink 缓存
  const clearDeeplinkCache = () => {
    deeplinkCache.value = null
  }

  // 新增更新会话workingStatus的方法
  const updateThreadWorkingStatus = (threadId: string, status: WorkingStatus) => {
    // 如果是活跃会话，且状态为completed或error，直接从Map中移除
    if (getActiveThreadId() === threadId && (status === 'completed' || status === 'error')) {
      // console.log(`活跃会话状态移除: ${threadId}`)
      getThreadsWorkingStatus().delete(threadId)
      return
    }

    // 记录状态变更
    const oldStatus = getThreadsWorkingStatus().get(threadId)
    if (oldStatus !== status) {
      // console.log(`会话状态变更: ${threadId} ${oldStatus || 'none'} -> ${status}`)
      getThreadsWorkingStatus().set(threadId, status)
    }
  }

  // 获取会话工作状态的方法
  const getThreadWorkingStatus = (threadId: string): WorkingStatus | null => {
    return getThreadsWorkingStatus().get(threadId) || null
  }

  /**
   * 新增: 处理来自主进程的会议指令
   * @param data 包含指令文本的对象
   */
  const handleMeetingInstruction = async (data: { prompt: string }) => {
    // 确保当前有活动的会话，否则指令无法执行
    if (!getActiveThreadId()) {
      console.warn('Received meeting command, but no active session. Command ignored.')
      return
    }
    try {
      // 将收到的指令作为用户输入，调用已有的sendMessage方法
      // 这样可以完全复用UI的加载状态、消息显示等所有逻辑
      await sendMessage({
        text: data.prompt,
        files: [],
        links: [],
        think: false,
        search: false,
        content: [{ type: 'text', content: data.prompt }]
      })
    } catch (error) {
      console.error('Error occurred while processing meeting command:', error)
    }
  }

  const setupEventListeners = () => {
    // 新增：监听来自主进程的会议指令
    window.electron.ipcRenderer.on(MEETING_EVENTS.INSTRUCTION, (_, data) => {
      handleMeetingInstruction(data)
    })

    // 监听：主进程推送的完整会话列表
    window.electron.ipcRenderer.on(
      CONVERSATION_EVENTS.LIST_UPDATED,
      (_, updatedGroupedList: { dt: string; dtThreads: CONVERSATION[] }[]) => {
        console.log('Received full thread list update from main process.')

        // 1. 获取当前活动会话ID，在列表更新前
        const currentActiveId = getActiveThreadId()

        // 2. 用主进程推送的最新、完整的、已格式化好的列表直接替换本地状态
        threads.value = updatedGroupedList

        // 3. 检查活动会话是否还存在
        if (currentActiveId) {
          const flatList = updatedGroupedList.flatMap((g) => g.dtThreads)
          const activeThread = flatList.find((thread) => thread.id === currentActiveId)

          if (!activeThread) {
            // 如果活动会话不存在了（如在其他窗口被删除），清空当前tab的活动状态
            clearActiveThread()
          } else if (!isUpdatingVariant && activeThread.settings.selectedVariantsMap) {
            // 只在非变体更新期间，同步 selectedVariantsMap（防止其他窗口的更新被覆盖）
            selectedVariantsMap.value = { ...activeThread.settings.selectedVariantsMap }
          }
        }
      }
    )

    // 监听：定向的会话激活事件
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, async (_, msg) => {
      // 确保是发给当前Tab的事件
      if (msg.tabId !== getTabId()) {
        return
      }

      // 如果是当前tab或新激活的会话在当前窗口中，则正常处理
      const prevActiveThreadId = getActiveThreadId()
      activeThreadIdMap.value.set(getTabId(), msg.conversationId)
      if (prevActiveThreadId && prevActiveThreadId !== msg.conversationId) {
        clearThreadCachesForTab(prevActiveThreadId)
      }

      // 如果存在状态为completed或error的会话，从Map中移除
      if (msg.conversationId) {
        const status = getThreadsWorkingStatus().get(msg.conversationId)
        if (status === 'completed' || status === 'error') {
          getThreadsWorkingStatus().delete(msg.conversationId)
        }
      }

      await loadChatConfig() // 加载对话配置
      await loadMessages()

      // 新增：在会话激活处理完成后，通过usePresenter发送确认信号
      tabP.onRendererTabActivated(msg.conversationId)
    })

    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.MESSAGE_EDITED, (_, msgId: string) => {
      handleMessageEdited(msgId)
    })

    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.DEACTIVATED, (_, msg) => {
      if (msg.tabId !== getTabId()) {
        return
      }
      const prevActiveThreadId = getActiveThreadId()
      setActiveThreadId(null)
      clearThreadCachesForTab(prevActiveThreadId)
    })

    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.SCROLL_TO_MESSAGE, (_, payload) => {
      if (!payload?.conversationId) {
        return
      }
      queueScrollTarget(payload.conversationId, {
        messageId: payload.messageId,
        childConversationId: payload.childConversationId
      })
    })

    window.electron.ipcRenderer.on(CONFIG_EVENTS.MODEL_LIST_CHANGED, (_, providerId?: string) => {
      if (providerId === 'acp') {
        void refreshActiveAgentMcpSelections()
      }
    })
  }

  onMounted(() => {
    console.log(`[Chat Store] Tab ${getTabId()} is mounted. Setting up event listeners.`)

    // store现在是被动的，等待主进程推送数据
    setupEventListeners()

    // 在 store 初始化完成后，通过usePresenter发送就绪信号
    console.log(`[Chat Store] Tab ${getTabId()} sending ready signal`)
    tabP.onRendererTabReady(getTabId())
  })

  /**
   * 导出会话内容
   * @param threadId 会话ID
   * @param format 导出格式
   */
  const exportThread = async (
    threadId: string,
    format: 'markdown' | 'html' | 'txt' | 'nowledge-mem' = 'markdown'
  ) => {
    try {
      // 直接使用主线程导出
      if (format === 'nowledge-mem') {
        await submitToNowledgeMem(threadId)
        return { filename: '', content: '' }
      }
      return await exportWithMainThread(threadId, format)
    } catch (error) {
      console.error('Failed to export thread:', error)
      throw error
    }
  }

  /**
   * 主线程导出
   */
  const exportWithMainThread = async (threadId: string, format: 'markdown' | 'html' | 'txt') => {
    let result: { filename: string; content: string }

    result = await exporterP.exportConversation(threadId, format)
    // 触发下载
    const blob = new Blob([result.content], {
      type: getContentType(format)
    })
    downloadBlob(blob, result.filename)

    return result
  }

  /**
   * Submit thread to nowledge-mem API
   */
  const submitToNowledgeMem = async (threadId: string) => {
    const result = await exporterP.submitToNowledgeMem(threadId)

    if (!result.success) {
      throw new Error(result.errors?.join(', ') || 'Submission failed')
    }
  }

  /**
   * Test nowledge-mem connection
   */
  const testNowledgeMemConnection = async () => {
    try {
      const result = await exporterP.testNowledgeMemConnection()

      if (!result.success) {
        throw new Error(result.error || 'Connection test failed')
      }

      return result
    } catch (error) {
      console.error('Failed to test nowledge-mem connection:', error)
      throw error
    }
  }

  /**
   * Update nowledge-mem configuration
   */
  const updateNowledgeMemConfig = async (config: {
    baseUrl?: string
    apiKey?: string
    timeout?: number
  }) => {
    try {
      await exporterP.updateNowledgeMemConfig(config)
    } catch (error) {
      console.error('Failed to update nowledge-mem config:', error)
      throw error
    }
  }

  /**
   * Get nowledge-mem configuration
   */
  const getNowledgeMemConfig = () => {
    return exporterP.getNowledgeMemConfig()
  }

  /**
   * 获取内容类型
   */
  const getContentType = (format: string): string => {
    switch (format) {
      case 'markdown':
        return 'text/markdown;charset=utf-8'
      case 'html':
        return 'text/html;charset=utf-8'
      case 'txt':
        return 'text/plain;charset=utf-8'
      case 'nowledge-mem':
        return 'application/json;charset=utf-8'
      default:
        return 'text/plain;charset=utf-8'
    }
  }

  /**
   * 显示 provider 选择器（触发事件让界面显示选择器）
   */
  const showProviderSelector = () => {
    // 触发事件让 ChatInput 组件显示 provider 选择器
    window.dispatchEvent(new CustomEvent('show-provider-selector'))
  }

  // 初始化全局流事件监听
  // 确保只在客户端环境中执行
  if (window.electron && window.electron.ipcRenderer) {
    // 移除旧的监听器以防止重复（虽然 store 通常只初始化一次）
    window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.RESPONSE)
    window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.END)
    window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.ERROR)

    window.electron.ipcRenderer.on(STREAM_EVENTS.RESPONSE, (_, msg) => {
      handleStreamResponse(msg)
    })

    window.electron.ipcRenderer.on(STREAM_EVENTS.END, (_, msg) => {
      handleStreamEnd(msg)
    })

    window.electron.ipcRenderer.on(STREAM_EVENTS.ERROR, (_, msg) => {
      handleStreamError(msg)
    })
  }

  return {
    renameThread,
    // 状态
    createNewEmptyThread,
    isSidebarOpen,
    isMessageNavigationOpen,
    activeThreadIdMap,
    threads,
    messageIdsMap,
    generatingThreadIds,
    selectedVariantsMap,
    childThreadsByMessageId,
    // Getters
    activeThread,
    messageItems,
    variantAwareMessages,
    messageCount,
    activeContextMention,
    activePendingScrollTarget,
    isAcpMode,
    activeAgentMcpSelections,
    // Actions
    createThread,
    setActiveThread,
    loadMessages,
    sendMessage,
    handleStreamResponse,
    handleStreamEnd,
    handleStreamError,
    handleMessageEdited,
    prefetchMessagesForRange,
    ensureMessagesLoadedByIds,
    prefetchAllMessages,
    recordMessageDomInfo,
    hasMessageDomInfo,
    // 导出配置相关的状态和方法
    chatConfig,
    updateChatConfig,
    setAcpWorkdirPreference,
    setAgentWorkspacePreference,
    retryMessage,
    deleteMessage,
    clearActiveThread,
    cancelGenerating,
    clearAllMessages,
    continueStream,
    deeplinkCache,
    clearDeeplinkCache,
    forkThread,
    createChildThreadFromSelection,
    openThreadInNewTab,
    consumeContextMention,
    consumePendingScrollMessage,
    clearSelectedVariantForMessage,
    updateThreadWorkingStatus,
    getThreadWorkingStatus,
    threadsWorkingStatusMap,
    toggleThreadPinned,
    getActiveThreadId,
    getGeneratingMessagesCache,
    getMessageIds,
    getCurrentThreadMessages,
    exportThread,
    submitToNowledgeMem,
    testNowledgeMemConnection,
    updateNowledgeMemConfig,
    getNowledgeMemConfig,
    showProviderSelector,
    regenerateFromUserMessage,
    retryFromUserMessage,
    updateSelectedVariant
  }
})
