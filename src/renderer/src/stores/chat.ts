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
// import DeepSeekLogo from '@/assets/llm-icons/deepseek-color.svg'
// import BaiduLogo from '@/assets/llm-icons/baidu-color.svg'
// import GoogleLogo from '@/assets/llm-icons/google-color.svg'

// const fakeMessage: AssistantMessage = {
//   id: '1',
//   avatar: DeepSeekLogo,
//   name: 'DeepSeek R1',
//   model_name: 'DeepSeek R1',
//   conversationId: '1',
//   model_id: 'sksadfjkasd',
//   model_provider: 'siliconflow',
//   status: 'sent',
//   error: '',
//   is_variant: 0,
//   usage: {
//     tokens_per_second: 123,
//     total_tokens: 123,
//     prompt_tokens: 123,
//     completion_tokens: 123
//   },
//   content: [
//     {
//       type: 'search',
//       extra: {
//         total: 40,
//         pages: [
//           {
//             title: '网页1',
//             url: 'https://www.baidu.com',
//             icon: BaiduLogo
//           },
//           {
//             title: '网页2',
//             url: 'https://www.baidu.com',
//             icon: GoogleLogo
//           },
//           {
//             title: '网页3',
//             url: 'https://www.baidu.com',
//             icon: GoogleLogo
//           }
//         ]
//       },
//       status: 'success',
//       timestamp: Date.now()
//     },
//     {
//       type: 'reasoning_content',
//       content: '思考中...',
//       status: 'loading',
//       timestamp: Date.now()
//     },
//     {
//       type: 'reasoning_content',
//       content: '让我好好想一想',
//       status: 'loading',
//       timestamp: Date.now()
//     },
//     {
//       type: 'reasoning_content',
//       content: '我也不知道想到了些什么东西？',
//       status: 'success',
//       timestamp: Date.now()
//     },
//     {
//       type: 'search',
//       extra: {
//         total: 40,
//         pages: [
//           {
//             title: '网页1',
//             url: 'https://www.baidu.com',
//             icon: BaiduLogo
//           },
//           {
//             title: '网页2',
//             url: 'https://www.baidu.com',
//             icon: GoogleLogo
//           },
//           {
//             title: '网页3',
//             url: 'https://www.baidu.com',
//             icon: BaiduLogo
//           }
//         ]
//       },
//       status: 'loading',
//       timestamp: Date.now()
//     },
//     {
//       type: 'search',
//       extra: {},
//       status: 'loading',
//       timestamp: Date.now()
//     },

//     {
//       type: 'content',
//       content: '欢迎使用聊天界面！',
//       status: 'loading',
//       timestamp: Date.now()
//     },
//     {
//       type: 'content',
//       content: '欢迎使用聊天界面！',
//       status: 'success',
//       timestamp: Date.now()
//     }
//   ],
//   role: 'assistant',
//   timestamp: Date.now()
// }

// const fakeUserMessage: UserMessage = {
//   id: '1',
//   avatar: '',
//   name: '用户',
//   role: 'user',
//   model_name: '',
//   model_id: '',
//   model_provider: '',
//   status: 'sent',
//   error: '',
//   is_variant: 0,
//   usage: {
//     tokens_per_second: 0,
//     total_tokens: 0,
//     prompt_tokens: 0,
//     completion_tokens: 0
//   },
//   conversationId: '1',
//   timestamp: Date.now(),
//   content: {
//     files: [
//       {
//         name: 'test.txt',
//         type: 'text/plain',
//         size: 100,
//         token: 100,
//         path: 'test.txt'
//       }
//     ],
//     links: [],
//     reasoning_content: true,
//     search: true,
//     think: true,
//     text: '你好，我是DeepSeek R1，很高兴认识你！'
//   }
// }

export const useChatStore = defineStore('chat', () => {
  const threadP = usePresenter('threadPresenter')

  // 状态
  const activeThreadId = ref<string | null>(null)
  const threads = ref<
    {
      dt: string
      dtThreads: CONVERSATION[]
    }[]
  >([])
  const messages = ref<AssistantMessage[] | UserMessage[]>([])
  // messages.value.push(fakeMessage)
  // messages.value.push(fakeUserMessage)
  const isLoading = ref(false)
  const generatingThreadIds = ref(new Set<string>())
  // const currentPage = ref(1)
  const pageSize = ref(40)
  const hasMore = ref(true)
  const isSidebarOpen = ref(false)

  // 添加消息生成缓存
  const generatingMessagesCache = ref<
    Map<
      string,
      {
        message: AssistantMessage | UserMessage
        threadId: string
      }
    >
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
  const deeplinkCache = ref<{ msg?: string; modelId?: string; systemPrompt?: string } | null>(null)

  // Getters
  const activeThread = computed(() => {
    return threads.value.flatMap((t) => t.dtThreads).find((t) => t.id === activeThreadId.value)
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
        const date = new Date(conv.createdAt).toISOString().split('T')[0]
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

  const createThread = async (title: string, settings: Partial<CONVERSATION_SETTINGS>) => {
    try {
      const threadId = await threadP.createConversation(title, settings)
      await loadThreads(1)
      return threadId
    } catch (error) {
      console.error('创建会话失败:', error)
      throw error
    }
  }

  const setActiveThread = async (threadId: string) => {
    try {
      await threadP.setActiveConversation(threadId)
      activeThreadId.value = threadId
      // no need to load messages and chat config here, because they will be loaded when the conversation-activated event is triggered
      // await loadMessages()
      // await loadChatConfig() // 加载对话配置
    } catch (error) {
      console.error('设置活动会话失败:', error)
      throw error
    }
  }

  const clearActiveThread = async () => {
    if (!activeThreadId.value) return
    await threadP.clearActiveThread()
    activeThreadId.value = null
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
    if (!activeThreadId.value) return

    try {
      const result = await threadP.getMessages(activeThreadId.value, 1, 100)
      // 合并数据库消息和缓存中的消息
      const mergedMessages = [...result.list]

      // 查找当前会话的缓存消息
      for (const [, cached] of generatingMessagesCache.value) {
        if (cached.threadId === activeThreadId.value) {
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
      messages.value = await Promise.all(mergedMessages.map((msg) => enrichMessageWithExtra(msg)))
    } catch (error) {
      console.error('加载消息失败:', error)
      throw error
    }
  }

  const sendMessage = async (content: UserMessageContent | AssistantMessageBlock[]) => {
    if (!activeThreadId.value || !content) return

    try {
      generatingThreadIds.value.add(activeThreadId.value)
      const aiResponseMessage = await threadP.sendMessage(
        activeThreadId.value,
        JSON.stringify(content),
        'user'
      )

      // 将消息添加到缓存
      generatingMessagesCache.value.set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: activeThreadId.value
      })

      await loadMessages()
      await threadP.startStreamCompletion(activeThreadId.value)
    } catch (error) {
      console.error('发送消息失败:', error)
      throw error
    }
  }

  const retryMessage = async (messageId: string) => {
    if (!activeThreadId.value) return
    try {
      const aiResponseMessage = await threadP.retryMessage(messageId, chatConfig.value.modelId)
      // 将消息添加到缓存
      generatingMessagesCache.value.set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: activeThreadId.value
      })
      await loadMessages()
      generatingThreadIds.value.add(activeThreadId.value)
      await threadP.startStreamCompletion(activeThreadId.value, messageId)
    } catch (error) {
      console.error('重试消息失败:', error)
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
  }) => {
    // 从缓存中查找消息
    const cached = generatingMessagesCache.value.get(msg.eventId)
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
                existingToolCallBlock.tool_call.response = msg.tool_call_response || '执行失败'
              } else {
                existingToolCallBlock.status = 'success'
                if (msg.tool_call_response) {
                  existingToolCallBlock.tool_call.response = msg.tool_call_response
                }
              }
            }
          }
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

      // 如果是当前激活的会话，更新显示
      if (cached.threadId === activeThreadId.value) {
        const msgIndex = messages.value.findIndex((m) => m.id === msg.eventId)
        if (msgIndex !== -1) {
          messages.value[msgIndex] = curMsg
        }
      }
    }
  }

  const handleStreamEnd = async (msg: { eventId: string }) => {
    // 从缓存中移除消息
    const cached = generatingMessagesCache.value.get(msg.eventId)
    if (cached) {
      // 获取最新的消息并处理 extra 信息
      const updatedMessage = await threadP.getMessage(msg.eventId)
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      generatingMessagesCache.value.delete(msg.eventId)
      generatingThreadIds.value.delete(cached.threadId)

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
          if (cached.threadId === activeThreadId.value) {
            const mainMsgIndex = messages.value.findIndex((m) => m.id === mainMessage.id)
            if (mainMsgIndex !== -1) {
              messages.value[mainMsgIndex] = enrichedMainMessage
            }
          }
        }
      } else {
        // 如果是当前激活的会话，更新显示
        if (cached.threadId === activeThreadId.value) {
          const msgIndex = messages.value.findIndex((m) => m.id === msg.eventId)
          if (msgIndex !== -1) {
            messages.value[msgIndex] = enrichedMessage
          }
        }
      }

      // 检查是否需要更新标题（仅在对话刚开始时）
      if (cached.threadId === activeThreadId.value) {
        const thread = await threadP.getConversation(cached.threadId)
        const { list: messages } = await threadP.getMessages(cached.threadId, 1, 10)
        // 只有当对话刚开始（只有一问一答两条消息）时才生成标题
        if (messages.length === 2 && thread && thread.is_new === 1) {
          try {
            console.info('自动生成标题 start', messages.length, thread)
            await threadP.summaryTitles().then(async (title) => {
              if (title) {
                console.info('自动生成标题', title)
                await threadP.renameConversation(cached.threadId, title)
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
    const cached = generatingMessagesCache.value.get(msg.eventId)
    if (cached) {
      if (cached.threadId === activeThreadId.value) {
        try {
          const updatedMessage = await threadP.getMessage(msg.eventId)
          const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

          if (enrichedMessage.is_variant && enrichedMessage.parentId) {
            // 处理变体消息的错误状态
            const parentMsgIndex = messages.value.findIndex(
              (m) => m.id === enrichedMessage.parentId
            )
            if (parentMsgIndex !== -1) {
              const parentMsg = messages.value[parentMsgIndex] as AssistantMessage
              if (!parentMsg.variants) {
                parentMsg.variants = []
              }
              const variantIndex = parentMsg.variants.findIndex((v) => v.id === enrichedMessage.id)
              if (variantIndex !== -1) {
                parentMsg.variants[variantIndex] = enrichedMessage
              } else {
                parentMsg.variants.push(enrichedMessage)
              }
              messages.value[parentMsgIndex] = { ...parentMsg }
            }
          } else {
            // 非变体消息的原有错误处理逻辑
            const messageIndex = messages.value.findIndex((m) => m.id === msg.eventId)
            if (messageIndex !== -1) {
              messages.value[messageIndex] = enrichedMessage
            }
          }
        } catch (error) {
          console.error('加载错误消息失败:', error)
        }
      }
      generatingMessagesCache.value.delete(msg.eventId)
      generatingThreadIds.value.delete(cached.threadId)
    }
  }

  const renameThread = async (threadId: string, title: string) => {
    await threadP.renameConversation(threadId, title)
    loadThreads(1)
  }

  // 配置相关的方法
  const loadChatConfig = async () => {
    if (!activeThreadId.value) return
    try {
      const conversation = await threadP.getConversation(activeThreadId.value)
      const threadToUpdate = threads.value
        .flatMap((thread) => thread.dtThreads)
        .find((t) => t.id === activeThreadId.value)
      if (threadToUpdate) {
        Object.assign(threadToUpdate, conversation)
      }
      if (conversation) {
        chatConfig.value = { ...conversation.settings }
      }
      // console.log('loadChatConfig', chatConfig.value)
    } catch (error) {
      console.error('加载对话配置失败:', error)
      throw error
    }
  }

  const saveChatConfig = async () => {
    if (!activeThreadId.value) return
    try {
      await threadP.updateConversationSettings(activeThreadId.value, chatConfig.value)
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
    if (!activeThreadId.value) return
    try {
      await threadP.deleteMessage(messageId)
      loadMessages()
    } catch (error) {
      console.error('删除消息失败:', error)
    }
  }
  const cancelGenerating = async (threadId: string) => {
    if (!threadId) return
    try {
      // 找到当前正在生成的消息
      const generatingMessage = Array.from(generatingMessagesCache.value.entries()).find(
        ([, cached]) => cached.threadId === threadId
      )

      if (generatingMessage) {
        const [messageId] = generatingMessage
        await threadP.stopMessageGeneration(messageId)
        // 从缓存中移除消息
        generatingMessagesCache.value.delete(messageId)
        generatingThreadIds.value.delete(threadId)
        // 获取更新后的消息
        const updatedMessage = await threadP.getMessage(messageId)
        // 更新消息列表中的对应消息
        const messageIndex = messages.value.findIndex((msg) => msg.id === messageId)
        if (messageIndex !== -1) {
          messages.value[messageIndex] = updatedMessage
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
      generatingMessagesCache.value.set(aiResponseMessage.id, {
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
  const clearAllMessages = async (threadId: string) => {
    if (!threadId) return
    try {
      await threadP.clearAllMessages(threadId)
      // 清空本地消息列表
      if (threadId === activeThreadId.value) {
        messages.value = []
      }
      // 清空生成缓存中的相关消息
      for (const [messageId, cached] of generatingMessagesCache.value.entries()) {
        if (cached.threadId === threadId) {
          generatingMessagesCache.value.delete(messageId)
        }
      }
      generatingThreadIds.value.delete(threadId)
    } catch (error) {
      console.error('清空消息失败:', error)
      throw error
    }
  }

  window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, (_, msg) => {
    // console.log(CONVERSATION_EVENTS.ACTIVATED, msg)
    activeThreadId.value = msg.conversationId
    loadMessages()
    loadChatConfig() // 加载对话配置
  })
  const handleMessageEdited = async (msgId: string) => {
    // 首先检查是否在生成缓存中
    const cached = generatingMessagesCache.value.get(msgId)
    if (cached) {
      // 如果在缓存中，获取最新的消息
      const updatedMessage = await threadP.getMessage(msgId)
      // 处理 extra 信息
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      // 更新缓存
      cached.message = enrichedMessage

      // 如果是当前会话的消息，也更新显示
      if (cached.threadId === activeThreadId.value) {
        const msgIndex = messages.value.findIndex((m) => m.id === msgId)
        if (msgIndex !== -1) {
          messages.value[msgIndex] = enrichedMessage
        }
      }
    } else if (activeThreadId.value) {
      // 如果不在缓存中但是当前会话的消息，直接更新显示
      const msgIndex = messages.value.findIndex((m) => m.id === msgId)
      if (msgIndex !== -1) {
        const updatedMessage = await threadP.getMessage(msgId)
        // 处理 extra 信息
        const enrichedMessage = await enrichMessageWithExtra(updatedMessage)
        messages.value[msgIndex] = enrichedMessage
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
    if (activeThreadId.value) {
      await clearActiveThread();
    }
    // 存储 deeplink 数据到缓存
    if (data) {
      deeplinkCache.value = {
        msg: data.msg,
        modelId: data.modelId,
        systemPrompt: data.systemPrompt
      }
    }
  })

  // 清理 Deeplink 缓存
  const clearDeeplinkCache = () => {
    deeplinkCache.value = null
  }

  return {
    renameThread,
    // 状态
    isSidebarOpen,
    activeThreadId,
    threads,
    messages,
    isLoading,
    hasMore,
    generatingMessagesCache,
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
    clearDeeplinkCache
  }
})
