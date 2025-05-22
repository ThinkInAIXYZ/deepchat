import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  UserMessageContent,
  AssistantMessageBlock,
  AssistantMessage,
  UserMessage,
  Message
} from '@shared/chat'
import type { CONVERSATION, CONVERSATION_SETTINGS } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import { CONVERSATION_EVENTS, DEEPLINK_EVENTS } from '@/events'
import router from '@/router'
import { useI18n } from 'vue-i18n'
// 定义会话工作状态类型
export type WorkingStatus = 'working' | 'error' | 'completed' | 'none'

export const useChatStore = defineStore('chat', () => {
  const threadP = usePresenter('threadPresenter')
  const windowP = usePresenter('windowPresenter')
  const notificationP = usePresenter('notificationPresenter')
  const { t } = useI18n()
  // 状态
  const activeThreadIdMap = ref<Map<number, string | null>>(new Map())
  const threads = ref<
    {
      dt: string
      dtThreads: CONVERSATION[]
    }[]
  >([])
  const messagesMap = ref<Map<number, AssistantMessage[] | UserMessage[]>>(new Map())
  const isLoading = ref(false)
  const generatingThreadIds = ref(new Set<string>())
  const pageSize = ref(40)
  const hasMore = ref(true)
  const isSidebarOpen = ref(false)

  // 使用Map来存储会话工作状态
  const threadsWorkingStatusMap = ref<Map<number, Map<string, WorkingStatus>>>(new Map())

  // 添加消息生成缓存
  const generatingMessagesCacheMap = ref<
    Map<number, Map<string, { message: AssistantMessage | UserMessage; threadId: string }>>
  >(new Map())

  // 对话配置状态
  const chatConfig = ref<CONVERSATION_SETTINGS>({
    systemPrompt: '',
    temperature: 0.7,
    contextLength: 32000,
    maxTokens: 8000,
    providerId: '',
    modelId: '',
    artifacts: 0
  })

  // Deeplink 消息缓存
  const deeplinkCache = ref<{
    msg?: string
    modelId?: string
    systemPrompt?: string
    autoSend?: boolean
  } | null>(null)

  // Getters
  const getTabId = () => window.api.getWebContentsId()
  const getActiveThreadId = () => activeThreadIdMap.value.get(getTabId()) ?? null
  const setActiveThreadId = (threadId: string | null) => {
    activeThreadIdMap.value.set(getTabId(), threadId)
  }
  const getMessages = () => messagesMap.value.get(getTabId()) ?? []
  const setMessages = (msgs: AssistantMessage[] | UserMessage[]) => {
    messagesMap.value.set(getTabId(), msgs)
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

  const activeThread = computed(() => {
    return threads.value.flatMap((t) => t.dtThreads).find((t) => t.id === getActiveThreadId())
  })

  // Actions
  const loadThreads = async (page: number) => {
    if (isLoading.value || (!hasMore.value && page !== 1)) {
      return
    }
    try {
      isLoading.value = true
      const result = await threadP.getConversationList(page, pageSize.value)

      // 按日期分组处理会话列表
      const groupedThreads: Map<string, CONVERSATION[]> = new Map()

      result.list.forEach((conv) => {
        const date = new Date(conv.updatedAt).toISOString().split('T')[0]
        if (!groupedThreads.has(date)) {
          groupedThreads.set(date, [])
        }
        groupedThreads.get(date)?.push({
          ...conv
        })
      })

      // 转换为组件所需的数据结构
      const newThreads = Array.from(groupedThreads.entries()).map(([dt, dtThreads]) => ({
        dt,
        dtThreads
      }))

      // 判断是否还有更多数据
      hasMore.value = result.list.length === pageSize.value

      if (page === 1) {
        threads.value = newThreads
      } else {
        // 合并现有数据和新数据，需要处理同一天的数据
        newThreads.forEach((newThread) => {
          const existingThread = threads.value.find((t) => t.dt === newThread.dt)
          if (existingThread) {
            existingThread.dtThreads.push(...newThread.dtThreads)
          } else {
            threads.value.push(newThread)
          }
        })
      }
      // 按日期排序
      threads.value.sort((a, b) => new Date(b.dt).getTime() - new Date(a.dt).getTime())
    } catch (error) {
      console.error('加载会话列表失败:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  const createNewEmptyThread = async () => {
    try {
      await clearActiveThread()
      await loadThreads(1)
    } catch (error) {
      console.error('清空活动会话并加载第一页失败:', error)
      throw error
    }
  }

  const createThread = async (title: string, settings: Partial<CONVERSATION_SETTINGS>) => {
    try {
      const threadId = await threadP.createConversation(title, settings, getTabId())
      await loadThreads(1)
      return threadId
    } catch (error) {
      console.error('创建会话失败:', error)
      throw error
    }
  }

  const setActiveThread = async (threadId: string) => {
    const tabId = getTabId()
    const threadsWorkingStatus = getThreadsWorkingStatus()
    if (
      threadsWorkingStatus.get(threadId) === 'completed' ||
      threadsWorkingStatus.get(threadId) === 'error'
    ) {
      threadsWorkingStatus.delete(threadId)
    }
    setActiveThreadId(threadId)
    setMessages([])
    await threadP.setActiveConversation(threadId, tabId)
  }

  const clearActiveThread = async () => {
    const tabId = getTabId()
    if (!getActiveThreadId()) return
    await threadP.clearActiveThread(tabId)
    setActiveThreadId(null)
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

  const loadMessages = async () => {
    if (!getActiveThreadId()) return

    try {
      const result = await threadP.getMessages(getActiveThreadId()!, 1, 100)
      // 合并数据库消息和缓存中的消息
      const mergedMessages = [...result.list]

      // 查找当前会话的缓存消息
      for (const [, cached] of getGeneratingMessagesCache()) {
        if (cached.threadId === getActiveThreadId()) {
          const message = cached.message
          if (message.is_variant && message.parentId) {
            // 如果是变体消息，找到父消息并添加到其 variants 数组中
            const parentMsg = mergedMessages.find((m) => m.parentId === message.parentId)
            if (parentMsg) {
              if (!parentMsg.variants) {
                parentMsg.variants = []
              }
              const existingVariantIndex = parentMsg.variants.findIndex((v) => v.id === message.id)
              if (existingVariantIndex !== -1) {
                parentMsg.variants[existingVariantIndex] = await enrichMessageWithExtra(message)
              } else {
                parentMsg.variants.push(await enrichMessageWithExtra(message))
              }
            }
          } else {
            // 如果是非变体消息，直接更新或添加到消息列表
            const existingIndex = mergedMessages.findIndex((m) => m.id === message.id)
            if (existingIndex !== -1) {
              mergedMessages[existingIndex] = await enrichMessageWithExtra(message)
            } else {
              mergedMessages.push(await enrichMessageWithExtra(message))
            }
          }
        }
      }

      // 处理所有消息的 extra 信息
      setMessages(
        (await Promise.all(mergedMessages.map((msg) => enrichMessageWithExtra(msg)))) as
          | AssistantMessage[]
          | UserMessage[]
      )
    } catch (error) {
      console.error('加载消息失败:', error)
      throw error
    }
  }

  const sendMessage = async (content: UserMessageContent | AssistantMessageBlock[]) => {
    if (!getActiveThreadId() || !content) return

    try {
      generatingThreadIds.value.add(getActiveThreadId()!)
      // 设置当前会话的workingStatus为working
      updateThreadWorkingStatus(getActiveThreadId()!, 'working')
      const aiResponseMessage = await threadP.sendMessage(
        getActiveThreadId()!,
        JSON.stringify(content),
        'user'
      )

      // 将消息添加到缓存
      getGeneratingMessagesCache().set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: getActiveThreadId()!
      })

      await loadMessages()
      await threadP.startStreamCompletion(getActiveThreadId()!)
    } catch (error) {
      console.error('发送消息失败:', error)
      throw error
    }
  }

  const retryMessage = async (messageId: string) => {
    if (!getActiveThreadId()) return
    try {
      const aiResponseMessage = await threadP.retryMessage(messageId, chatConfig.value.modelId)
      // 将消息添加到缓存
      getGeneratingMessagesCache().set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: getActiveThreadId()!
      })
      await loadMessages()
      generatingThreadIds.value.add(getActiveThreadId()!)
      // 设置当前会话的workingStatus为working
      updateThreadWorkingStatus(getActiveThreadId()!, 'working')
      await threadP.startStreamCompletion(getActiveThreadId()!, messageId)
    } catch (error) {
      console.error('重试消息失败:', error)
      throw error
    }
  }

  // 创建会话分支（从指定消息开始fork一个新会话）
  const forkThread = async (messageId: string, forkTag: string = '(fork)') => {
    if (!getActiveThreadId()) return

    try {
      // 获取当前会话信息
      const currentThread = await threadP.getConversation(getActiveThreadId()!)

      // 创建分支会话标题
      const newThreadTitle = `${currentThread.title} ${forkTag}`

      // 调用main层的forkConversation方法
      const newThreadId = await threadP.forkConversation(
        getActiveThreadId()!,
        messageId,
        newThreadTitle,
        currentThread.settings
      )

      // 重新加载会话列表
      await loadThreads(1)

      // 切换到新会话
      await setActiveThread(newThreadId)

      return newThreadId
    } catch (error) {
      console.error('创建会话分支失败:', error)
      throw error
    }
  }

  const handleStreamResponse = (msg: {
    eventId: string
    content?: string
    reasoning_content?: string
    tool_call_id?: string
    tool_call_name?: string
    tool_call_params?: string
    tool_call_response?: string
    maximum_tool_calls_reached?: boolean
    tool_call_server_name?: string
    tool_call_server_icons?: string
    tool_call_server_description?: string
    tool_call?: 'start' | 'end' | 'error'
    totalUsage?: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
    tool_call_response_raw?: unknown
    image_data?: {
      data: string
      mimeType: string
    }
  }) => {
    // 从缓存中查找消息
    const cached = getGeneratingMessagesCache().get(msg.eventId)
    if (cached) {
      const curMsg = cached.message as AssistantMessage
      if (curMsg.content) {
        // 处理工具调用达到最大次数的情况
        if (msg.maximum_tool_calls_reached) {
          const lastBlock = curMsg.content[curMsg.content.length - 1]
          if (lastBlock) {
            lastBlock.status = 'success'
          }
          curMsg.content.push({
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
          if (msg.tool_call === 'start') {
            // 创建新的工具调用块
            const lastBlock = curMsg.content[curMsg.content.length - 1]
            if (lastBlock) {
              lastBlock.status = 'success'
            }

            curMsg.content.push({
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
          } else if (msg.tool_call === 'end' || msg.tool_call === 'error') {
            // 查找对应的工具调用块
            const existingToolCallBlock = curMsg.content.find(
              (block) =>
                block.type === 'tool_call' &&
                ((msg.tool_call_id && block.tool_call?.id === msg.tool_call_id) ||
                  block.tool_call?.name === msg.tool_call_name) &&
                block.status === 'loading'
            )
            if (existingToolCallBlock && existingToolCallBlock.type === 'tool_call') {
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
        }
        // 处理图像数据
        else if (msg.image_data) {
          const lastBlock = curMsg.content[curMsg.content.length - 1]
          if (lastBlock) {
            lastBlock.status = 'success'
          }

          curMsg.content.push({
            type: 'image',
            content: 'image',
            status: 'success',
            timestamp: Date.now(),
            image_data: {
              data: msg.image_data.data,
              mimeType: msg.image_data.mimeType
            }
          })
        }
        // 处理普通内容
        else if (msg.content) {
          const lastContentBlock = curMsg.content[curMsg.content.length - 1]
          if (lastContentBlock && lastContentBlock.type === 'content') {
            lastContentBlock.content += msg.content
          } else {
            if (lastContentBlock) {
              lastContentBlock.status = 'success'
            }
            curMsg.content.push({
              type: 'content',
              content: msg.content,
              status: 'loading',
              timestamp: Date.now()
            })
          }
        }

        // 处理推理内容
        if (msg.reasoning_content) {
          const lastReasoningBlock = curMsg.content[curMsg.content.length - 1]
          if (lastReasoningBlock && lastReasoningBlock.type === 'reasoning_content') {
            lastReasoningBlock.content += msg.reasoning_content
          } else {
            if (lastReasoningBlock) {
              lastReasoningBlock.status = 'success'
            }
            curMsg.content.push({
              type: 'reasoning_content',
              content: msg.reasoning_content,
              status: 'loading',
              timestamp: Date.now()
            })
          }
        }
      }

      // 处理使用情况统计
      if (msg.totalUsage) {
        curMsg.usage = {
          ...curMsg.usage,
          total_tokens: msg.totalUsage.total_tokens,
          input_tokens: msg.totalUsage.prompt_tokens,
          output_tokens: msg.totalUsage.completion_tokens
        }
      }

      // 如果是当前激活的会话，更新显示
      if (cached.threadId === getActiveThreadId()) {
        const msgIndex = getMessages().findIndex((m) => m.id === msg.eventId)
        if (msgIndex !== -1) {
          getMessages()[msgIndex] = curMsg
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
          if (getActiveThreadId() === getActiveThreadId()) {
            const mainMsgIndex = getMessages().findIndex((m) => m.id === mainMessage.id)
            if (mainMsgIndex !== -1) {
              getMessages()[mainMsgIndex] = enrichedMainMessage as AssistantMessage | UserMessage
            }
          }
        }
      } else {
        // 如果是当前激活的会话，更新显示
        if (getActiveThreadId() === getActiveThreadId()) {
          const msgIndex = getMessages().findIndex((m) => m.id === msg.eventId)
          if (msgIndex !== -1) {
            getMessages()[msgIndex] = enrichedMessage as AssistantMessage | UserMessage
          }
        }
      }

      // 检查是否需要更新标题（仅在对话刚开始时）
      if (getActiveThreadId() === getActiveThreadId()) {
        const thread = await threadP.getConversation(getActiveThreadId()!)
        const { list: messages } = await threadP.getMessages(getActiveThreadId()!, 1, 10)
        // 只有当对话刚开始（只有一问一答两条消息）时才生成标题
        if (messages.length === 2 && thread && thread.is_new === 1) {
          try {
            console.info('自动生成标题 start', messages.length, thread)
            await threadP.summaryTitles(getTabId()).then(async (title) => {
              if (title) {
                console.info('自动生成标题', title)
                await threadP.renameConversation(getActiveThreadId()!, title)
                // 重新加载会话列表以更新标题
                await loadThreads(1)
              }
            })
          } catch (error) {
            console.error('自动生成标题失败:', error)
          }
        }
      }
      loadThreads(1)
    }
  }

  const handleStreamError = async (msg: { eventId: string }) => {
    // 从缓存中获取消息
    const cached = getGeneratingMessagesCache().get(msg.eventId)
    if (cached) {
      if (getActiveThreadId() === getActiveThreadId()) {
        try {
          const updatedMessage = await threadP.getMessage(msg.eventId)
          const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

          if (enrichedMessage.is_variant && enrichedMessage.parentId) {
            // 处理变体消息的错误状态
            const parentMsgIndex = getMessages().findIndex((m) => m.id === enrichedMessage.parentId)
            if (parentMsgIndex !== -1) {
              const parentMsg = getMessages()[parentMsgIndex] as AssistantMessage
              if (!parentMsg.variants) {
                parentMsg.variants = []
              }
              const variantIndex = parentMsg.variants.findIndex((v) => v.id === enrichedMessage.id)
              if (variantIndex !== -1) {
                parentMsg.variants[variantIndex] = enrichedMessage
              } else {
                parentMsg.variants.push(enrichedMessage)
              }
              getMessages()[parentMsgIndex] = { ...parentMsg }
            }
          } else {
            // 非变体消息的原有错误处理逻辑
            const messageIndex = getMessages().findIndex((m) => m.id === msg.eventId)
            if (messageIndex !== -1) {
              getMessages()[messageIndex] = enrichedMessage as AssistantMessage | UserMessage
            }
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
          console.error('加载错误消息失败:', error)
        }
      }
      getGeneratingMessagesCache().delete(msg.eventId)
      generatingThreadIds.value.delete(cached.threadId)
      // 设置会话的workingStatus为error
      // 如果是当前活跃的会话，则直接从Map中移除
      if (getActiveThreadId() === cached.threadId) {
        getThreadsWorkingStatus().delete(cached.threadId)
      } else {
        updateThreadWorkingStatus(cached.threadId, 'error')
      }
    }
  }

  const renameThread = async (threadId: string, title: string) => {
    await threadP.renameConversation(threadId, title)
    loadThreads(1)
  }
  const toggleThreadPinned = async (threadId: string, isPinned: boolean) => {
    await threadP.toggleConversationPinned(threadId, isPinned)
    loadThreads(1)
  }
  // 配置相关的方法
  const loadChatConfig = async () => {
    if (!getActiveThreadId()) return
    try {
      const conversation = await threadP.getConversation(getActiveThreadId()!)
      const threadToUpdate = threads.value
        .flatMap((thread) => thread.dtThreads)
        .find((t) => t.id === getActiveThreadId())
      if (threadToUpdate) {
        Object.assign(threadToUpdate, conversation)
      }
      if (conversation) {
        chatConfig.value = { ...conversation.settings }
      }
    } catch (error) {
      console.error('加载对话配置失败:', error)
      throw error
    }
  }

  const saveChatConfig = async () => {
    if (!getActiveThreadId()) return
    try {
      await threadP.updateConversationSettings(getActiveThreadId()!, chatConfig.value)
    } catch (error) {
      console.error('保存对话配置失败:', error)
      throw error
    }
  }

  const updateChatConfig = async (newConfig: Partial<CONVERSATION_SETTINGS>) => {
    chatConfig.value = { ...chatConfig.value, ...newConfig }
    await saveChatConfig()
    await loadChatConfig() // 加载对话配置
  }

  const deleteMessage = async (messageId: string) => {
    if (!getActiveThreadId()) return
    try {
      await threadP.deleteMessage(messageId)
      loadMessages()
    } catch (error) {
      console.error('删除消息失败:', error)
    }
  }
  const clearAllMessages = async (threadId: string) => {
    if (!threadId) return
    try {
      await threadP.clearAllMessages(threadId)
      // 清空本地消息列表
      if (threadId === getActiveThreadId()) {
        setMessages([])
      }
      // 清空生成缓存中的相关消息
      const cache = getGeneratingMessagesCache()
      for (const [messageId, cached] of cache.entries()) {
        if (cached.threadId === threadId) {
          cache.delete(messageId)
        }
      }
      generatingThreadIds.value.delete(threadId)
      // 从状态Map中移除会话状态
      getThreadsWorkingStatus().delete(threadId)
    } catch (error) {
      console.error('清空消息失败:', error)
      throw error
    }
  }

  const cancelGenerating = async (threadId: string) => {
    if (!threadId) return
    try {
      // 找到当前正在生成的消息
      const cache = getGeneratingMessagesCache()
      const generatingMessage = Array.from(cache.entries()).find(
        ([, cached]) => cached.threadId === threadId
      )
      if (generatingMessage) {
        const [messageId] = generatingMessage
        await threadP.stopMessageGeneration(messageId)
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
        // 更新消息列表中的对应消息
        const messageIndex = getMessages().findIndex((msg) => msg.id === messageId)
        if (messageIndex !== -1) {
          getMessages()[messageIndex] = updatedMessage
        }
      }
    } catch (error) {
      console.error('取消生成失败:', error)
    }
  }
  const continueStream = async (conversationId: string, messageId: string) => {
    if (!conversationId || !messageId) return
    try {
      generatingThreadIds.value.add(conversationId)
      // 设置会话的workingStatus为working
      updateThreadWorkingStatus(conversationId, 'working')

      // 创建一个新的助手消息
      const aiResponseMessage = await threadP.sendMessage(
        conversationId,
        JSON.stringify({
          text: 'continue',
          files: [],
          links: [],
          search: false,
          think: false,
          continue: true
        }),
        'user'
      )

      if (!aiResponseMessage) {
        console.error('创建助手消息失败')
        return
      }

      // 将消息添加到缓存
      getGeneratingMessagesCache().set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: conversationId
      })

      await loadMessages()
      await threadP.continueStreamCompletion(conversationId, messageId)
    } catch (error) {
      console.error('继续生成失败:', error)
      throw error
    }
  }

  window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, (_, msg) => {
    // 如果不是当前tab
    if (msg.tabId !== getTabId()) {
      // 检查新激活的会话是否在当前窗口的会话列表中
      const isThreadInCurrentWindow = threads.value
        .flatMap((t) => t.dtThreads)
        .some((t) => t.id === msg.conversationId)
      console.log('isThreadInCurrentWindow', isThreadInCurrentWindow)
      // 如果新激活的会话不在当前窗口的会话列表中，保持当前激活状态
      if (!isThreadInCurrentWindow) {
        loadThreads(1)
        return
      }
      return
    }

    // 如果是当前tab或新激活的会话在当前窗口中，则正常处理
    activeThreadIdMap.value.set(getTabId(), msg.conversationId)

    // 如果存在状态为completed或error的会话，从Map中移除
    if (msg.conversationId) {
      const status = getThreadsWorkingStatus().get(msg.conversationId)
      if (status === 'completed' || status === 'error') {
        getThreadsWorkingStatus().delete(msg.conversationId)
      }
    }

    loadMessages()
    loadChatConfig() // 加载对话配置
  })

  const handleMessageEdited = async (msgId: string) => {
    // 首先检查是否在生成缓存中
    const cached = getGeneratingMessagesCache().get(msgId)
    if (cached) {
      // 如果在缓存中，获取最新的消息
      const updatedMessage = await threadP.getMessage(msgId)
      // 处理 extra 信息
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      // 更新缓存
      cached.message = enrichedMessage as AssistantMessage | UserMessage

      // 如果是当前会话的消息，也更新显示
      if (cached.threadId === getActiveThreadId()) {
        const msgIndex = getMessages().findIndex((m) => m.id === msgId)
        if (msgIndex !== -1) {
          getMessages()[msgIndex] = enrichedMessage as AssistantMessage | UserMessage
        }
      }
    } else if (getActiveThreadId()) {
      // 如果不在缓存中，先尝试获取主消息
      const mainMessage = await threadP.getMainMessageByParentId(getActiveThreadId()!, msgId)
      if (mainMessage) {
        // 如果找到主消息，说明当前消息是变体消息
        const enrichedMainMessage = await enrichMessageWithExtra(mainMessage)
        const mainMsgIndex = getMessages().findIndex((m) => m.id === mainMessage.id)
        if (mainMsgIndex !== -1) {
          getMessages()[mainMsgIndex] = enrichedMainMessage as AssistantMessage | UserMessage
        }
      } else {
        // 如果不是变体消息，直接更新当前消息
        const msgIndex = getMessages().findIndex((m) => m.id === msgId)
        if (msgIndex !== -1) {
          const updatedMessage = await threadP.getMessage(msgId)
          const enrichedMessage = await enrichMessageWithExtra(updatedMessage)
          getMessages()[msgIndex] = enrichedMessage as AssistantMessage | UserMessage
        }
      }
    }
  }

  // 注册消息编辑事件处理
  window.electron.ipcRenderer.on(CONVERSATION_EVENTS.MESSAGE_EDITED, (_, msgId: string) => {
    handleMessageEdited(msgId)
  })

  window.electron.ipcRenderer.on(DEEPLINK_EVENTS.START, async (_, data) => {
    console.log('DEEPLINK_EVENTS.START', data)
    // 检查当前路由，如果不在新会话页面，则跳转
    const currentRoute = router.currentRoute.value
    if (currentRoute.name !== 'chat') {
      await router.push({ name: 'chat' })
    }
    // 检查是否存在 activeThreadId，如果存在则创建新会话
    if (getActiveThreadId()) {
      await clearActiveThread()
    }
    // 存储 deeplink 数据到缓存
    if (data) {
      deeplinkCache.value = {
        msg: data.msg,
        modelId: data.modelId,
        systemPrompt: data.systemPrompt,
        autoSend: data.autoSend
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

  return {
    renameThread,
    // 状态
    createNewEmptyThread,
    isSidebarOpen,
    activeThreadIdMap,
    threads,
    messagesMap,
    isLoading,
    hasMore,
    generatingThreadIds,
    // Getters
    activeThread,
    // Actions
    loadThreads,
    createThread,
    setActiveThread,
    loadMessages,
    sendMessage,
    handleStreamResponse,
    handleStreamEnd,
    handleStreamError,
    handleMessageEdited,
    // 导出配置相关的状态和方法
    chatConfig,
    updateChatConfig,
    retryMessage,
    deleteMessage,
    clearActiveThread,
    cancelGenerating,
    clearAllMessages,
    continueStream,
    deeplinkCache,
    clearDeeplinkCache,
    forkThread,
    updateThreadWorkingStatus,
    getThreadWorkingStatus,
    threadsWorkingStatusMap,
    toggleThreadPinned,
    getActiveThreadId,
    getGeneratingMessagesCache,
    getMessages
  }
})
