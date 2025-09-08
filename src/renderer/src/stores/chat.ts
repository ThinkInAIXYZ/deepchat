import { defineStore } from 'pinia'
import { ref, computed, onMounted } from 'vue'
import type {
  UserMessageContent,
  AssistantMessageBlock,
  AssistantMessage,
  UserMessage,
  Message
} from '@shared/chat'
import type { CONVERSATION, CONVERSATION_SETTINGS } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import { CONVERSATION_EVENTS, DEEPLINK_EVENTS, MEETING_EVENTS } from '@/events'
import router from '@/router'
import { useI18n } from 'vue-i18n'
import { useSoundStore } from './sound'
import sfxfcMp3 from '/sounds/sfx-fc.mp3?url'
import sfxtyMp3 from '/sounds/sfx-typing.mp3?url'

// 定义会话工作状态类型
export type WorkingStatus = 'working' | 'error' | 'completed' | 'none'

export const useChatStore = defineStore('chat', () => {
  const threadP = usePresenter('threadPresenter')
  const windowP = usePresenter('windowPresenter')
  const notificationP = usePresenter('notificationPresenter')
  const tabP = usePresenter('tabPresenter')
  const { t } = useI18n()

  const soundStore = useSoundStore()

  // 状态
  const activeThreadIdMap = ref<Map<number, string | null>>(new Map())
  const threads = ref<
    {
      dt: string
      dtThreads: CONVERSATION[]
    }[]
  >([])
  const messagesMap = ref<Map<number, AssistantMessage[] | UserMessage[]>>(new Map())
  const generatingThreadIds = ref(new Set<string>())
  const isSidebarOpen = ref(false)
  const isMessageNavigationOpen = ref(false)

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
    artifacts: 0,
    enabledMcpTools: [],
    thinkingBudget: undefined,
    enableSearch: undefined,
    forcedSearch: undefined,
    searchStrategy: undefined,
    reasoningEffort: undefined,
    verbosity: undefined
  })

  // Deeplink 消息缓存
  const deeplinkCache = ref<{
    msg?: string
    modelId?: string
    systemPrompt?: string
    autoSend?: boolean
    mentions?: string[]
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
  const getCurrentThreadMessages = () => {
    const activeThreadId = getActiveThreadId()
    if (!activeThreadId) return []
    return getMessages()
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
      const threadId = await threadP.createConversation(title, settings, getTabId())
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
      console.error('Failed to load messages:', error)
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
      console.error('Failed to send message:', error)
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
      console.error('Failed to retry message:', error)
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

      // 切换到新会话
      await setActiveThread(newThreadId)

      return newThreadId
    } catch (error) {
      console.error('Failed to create thread branch:', error)
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
    tool_call?: 'start' | 'end' | 'error' | 'update' | 'running'
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
    rate_limit?: {
      providerId: string
      qpsLimit: number
      currentQps: number
      queueLength: number
      estimatedWaitTime?: number
    }
  }) => {
    // 从缓存中查找消息
    const cached = getGeneratingMessagesCache().get(msg.eventId)
    if (cached) {
      const curMsg = cached.message as AssistantMessage
      if (curMsg.content) {
        // 提取一个可复用的保护逻辑
        const finalizeLastBlock = () => {
          const lastBlock =
            curMsg.content.length > 0 ? curMsg.content[curMsg.content.length - 1] : undefined
          if (lastBlock) {
            // 只有当上一个块不是一个正在等待结果的工具调用时，才将其标记为成功
            if (!(lastBlock.type === 'tool_call' && lastBlock.status === 'loading')) {
              lastBlock.status = 'success'
            }
          }
        }

        // 处理工具调用达到最大次数的情况
        if (msg.maximum_tool_calls_reached) {
          finalizeLastBlock() // 使用保护逻辑
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
            // 工具调用开始解析参数 - 创建新的工具调用块
            finalizeLastBlock() // 使用保护逻辑

            // 工具调用音效，与实际数据流同步
            playToolcallSound()

            curMsg.content.push({
              type: 'tool_call',
              content: '',
              status: 'loading', // 使用loading状态表示正在解析参数
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
            // 实时更新工具调用参数
            const existingToolCallBlock = curMsg.content.find(
              (block) =>
                block.type === 'tool_call' &&
                ((msg.tool_call_id && block.tool_call?.id === msg.tool_call_id) ||
                  block.tool_call?.name === msg.tool_call_name) &&
                block.status === 'loading'
            )
            if (
              existingToolCallBlock &&
              existingToolCallBlock.type === 'tool_call' &&
              existingToolCallBlock.tool_call
            ) {
              // 更新参数内容
              existingToolCallBlock.tool_call.params = msg.tool_call_params || ''
            }
          } else if (msg.tool_call === 'running') {
            // 工具开始执行 - 查找对应的工具调用块并更新状态
            const existingToolCallBlock = curMsg.content.find(
              (block) =>
                block.type === 'tool_call' &&
                ((msg.tool_call_id && block.tool_call?.id === msg.tool_call_id) ||
                  block.tool_call?.name === msg.tool_call_name) &&
                block.status === 'loading'
            )
            if (existingToolCallBlock && existingToolCallBlock.type === 'tool_call') {
              // 保持loading状态，但可以添加执行中的标识
              existingToolCallBlock.status = 'loading'
              if (existingToolCallBlock.tool_call) {
                // 确保参数是最新的
                existingToolCallBlock.tool_call.params =
                  msg.tool_call_params || existingToolCallBlock.tool_call.params
              }
            } else {
              // 如果没有找到现有的工具调用块，创建一个新的（兼容旧逻辑）
              finalizeLastBlock() // 使用保护逻辑

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
            }
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
          finalizeLastBlock() // 使用保护逻辑
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
        // 处理速率限制
        else if (msg.rate_limit) {
          finalizeLastBlock() // 使用保护逻辑
          curMsg.content.push({
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
        }
        // 处理普通内容
        else if (msg.content) {
          const lastContentBlock = curMsg.content[curMsg.content.length - 1]
          if (lastContentBlock && lastContentBlock.type === 'content') {
            lastContentBlock.content += msg.content
            // 打字机音效，与实际数据流同步
            playTypewriterSound()
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
            // 如果是新块的第一个字符，也播放声音
            playTypewriterSound()
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
          console.error('Failed to load error message:', error)
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
  }

  const toggleThreadPinned = async (threadId: string, isPinned: boolean) => {
    await threadP.toggleConversationPinned(threadId, isPinned)
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
      console.error('Failed to load conversation config:', error)
      throw error
    }
  }

  const saveChatConfig = async () => {
    if (!getActiveThreadId()) return
    try {
      await threadP.updateConversationSettings(getActiveThreadId()!, chatConfig.value)
    } catch (error) {
      console.error('Failed to save conversation config:', error)
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
      console.error('Failed to delete message:', error)
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
      console.error('Failed to clear messages:', error)
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
      console.error('Failed to cancel generation:', error)
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
        console.error('Failed to create assistant message')
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

        // 3. 检查列表更新之前的活动会话是否还存在于新列表中
        if (currentActiveId) {
          const flatList = updatedGroupedList.flatMap((g) => g.dtThreads)
          const activeThreadExists = flatList.some((thread) => thread.id === currentActiveId)

          // 如果活动会话不存在了（如在其他窗口被删除），只清空当前tab的活动状态，待其他流程处理
          if (!activeThreadExists) {
            clearActiveThread()
          }
        }
      }
    )

    // 监听：定向的会话激活事件
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, (_, msg) => {
      // 确保是发给当前Tab的事件
      if (msg.tabId !== getTabId()) {
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
      setActiveThreadId(null)
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
    format: 'markdown' | 'html' | 'txt' = 'markdown'
  ) => {
    try {
      // 直接使用主线程导出
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
    const result = await threadP.exportConversation(threadId, format)

    // 触发下载
    const blob = new Blob([result.content], {
      type: getContentType(format)
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = result.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    return result
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

  return {
    renameThread,
    // 状态
    createNewEmptyThread,
    isSidebarOpen,
    isMessageNavigationOpen,
    activeThreadIdMap,
    threads,
    messagesMap,
    generatingThreadIds,
    // Getters
    activeThread,
    // Actions
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
    getMessages,
    getCurrentThreadMessages,
    exportThread,
    showProviderSelector
  }
})
