import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { presenter } from '@/presenter'
import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'

interface PromptDefinition {
  name: string
  description: string
  arguments: Array<{
    name: string
    description: string
    required: boolean
  }>
  files?: Array<{
    id: string
    name: string
    type: string
    size: number
    path: string
    description?: string
    content?: string
    createdAt: number
  }>
}

export class CustomPromptsServer {
  private server: Server
  private promptsCache: PromptDefinition[] | null = null

  constructor() {
    // 创建服务器实例
    this.server = new Server(
      {
        name: 'deepchat-inmemory/custom-prompts-server',
        version: '0.1.0'
      },
      {
        capabilities: {
          prompts: {}
        }
      }
    )

    // 设置请求处理器
    this.setupRequestHandlers()

    // 监听自定义提示词变更事件
    this.setupEventListeners()
  }

  // 启动服务器
  public startServer(transport: Transport): void {
    this.server.connect(transport)
  }

  // 设置事件监听器
  private setupEventListeners(): void {
    eventBus.on(CONFIG_EVENTS.CUSTOM_PROMPTS_SERVER_CHECK_REQUIRED, () => {
      this.promptsCache = null
    })
  }

  // 获取提示词列表
  private async getPromptsList(): Promise<PromptDefinition[]> {
    // 如果有缓存，直接返回
    if (this.promptsCache !== null) {
      return this.promptsCache
    }

    try {
      const prompts = await presenter.configPresenter.getCustomPrompts()

      if (!prompts || prompts.length === 0) {
        this.promptsCache = []
        return []
      }

      this.promptsCache = prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.parameters
          ? prompt.parameters.map((param) => ({
              name: param.name,
              description: param.description,
              required: !!param.required
            }))
          : [],
        files: prompt.files || []
      }))

      return this.promptsCache
    } catch {
      this.promptsCache = []
      return []
    }
  }

  // 获取提示词内容
  private async getPromptContent(name: string, content: string, args?: Record<string, string>) {
    const prompts = await presenter.configPresenter.getCustomPrompts()
    if (!prompts || prompts.length === 0) throw new Error('No prompts found')

    const prompt = prompts.find((p) => p.name === name)
    if (!prompt) throw new Error('Prompt not found')

    let promptContent = prompt.content

    // 替换参数占位符
    if (args && prompt.parameters) {
      // 遍历所有参数，并替换内容中的{{参数名}}
      for (const param of prompt.parameters) {
        const value = args[param.name] || ''
        promptContent = promptContent?.replace(new RegExp(`{{${param.name}}}`, 'g'), value)
      }
    }

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${promptContent}\n\n${content}`
          }
        }
      ]
    }
  }

  // 设置请求处理器
  private setupRequestHandlers(): void {
    // 设置提示词列表处理器
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = await this.getPromptsList()
      return { prompts }
    })

    // 设置提示词获取处理器
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params
        const response = await this.getPromptContent(name, '', args as Record<string, string>)
        return {
          messages: response.messages,
          _meta: {}
        }
      } catch (error) {
        return {
          messages: [
            {
              role: 'system',
              content: {
                type: 'text',
                text: `Error: ${error instanceof Error ? error.message : String(error)}`
              }
            }
          ],
          _meta: {}
        }
      }
    })
  }

  // 提供对server的访问方法，供外部调用
  public getServer(): Server {
    return this.server
  }
}
