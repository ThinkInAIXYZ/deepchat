import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import axios from 'axios'

// Schema definitions
const FastGptKnowledgeSearchArgsSchema = z.object({
  query: z.string().describe('搜索查询内容 (必填)'),
  topK: z.number().optional().default(5).describe('返回结果数量 (默认5条)'),
  scoreThreshold: z.number().optional().default(0.2).describe('相似度阈值 (0-1之间，默认0.2)')
})

// 定义FastGPT API返回的数据结构
interface FastGptSearchResponse {
  code: number
  statusText: string
  data: {
    list: Array<{
      id: string
      q: string
      a: string
      datasetId: string
      collectionId: string
      sourceName: string
      sourceId: string
      score: Array<{
        value: number
        type: string
        index: number
      }>
    }>
  }
}

// 导入MCPTextContent接口
import { MCPTextContent } from '@shared/presenter'

export class FastGptKnowledgeServer {
  private server: Server
  private configs: Array<{
    apiKey: string
    endpoint: string
    datasetId: string
    description: string
    enabled: boolean
  }> = []

  constructor(env?: {
    configs: {
      apiKey: string
      endpoint: string
      datasetId: string
      description: string
      enabled: boolean
    }[]
  }) {
    console.log('FastGptKnowledgeServer constructor', env)
    if (!env) {
      throw new Error('需要提供FastGPT知识库配置')
    }

    const envs = env.configs

    if (!Array.isArray(envs) || envs.length === 0) {
      throw new Error('需要提供至少一个FastGPT知识库配置')
    }

    // 处理每个配置
    for (const env of envs) {
      if (!env.apiKey) {
        throw new Error('需要提供FastGPT API Key')
      }
      if (!env.datasetId) {
        throw new Error('需要提供FastGPT Dataset ID')
      }
      if (!env.description) {
        throw new Error('需要提供对这个知识库的描述，以方便ai决定是否检索此知识库')
      }

      this.configs.push({
        apiKey: env.apiKey,
        datasetId: env.datasetId,
        endpoint: env.endpoint || 'http://localhost:3000/api',
        description: env.description,
        enabled: env.enabled
      })
    }

    // 创建服务器实例
    this.server = new Server(
      {
        name: 'deepchat-inmemory/fastgpt-knowledge-server',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    // 设置请求处理器
    this.setupRequestHandlers()
  }

  // 启动服务器
  public startServer(transport: Transport): void {
    this.server.connect(transport)
  }

  // 设置请求处理器
  private setupRequestHandlers(): void {
    // 设置工具列表处理器
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.configs
        .filter((conf) => conf.enabled)
        .map((config, index) => {
          const suffix = this.configs.length > 1 ? `_${index + 1}` : ''
          return {
            name: `fastgpt_knowledge_search${suffix}`,
            description: config.description,
            inputSchema: zodToJsonSchema(FastGptKnowledgeSearchArgsSchema)
          }
        })
      return { tools }
    })

    // 设置工具调用处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: parameters } = request.params

      // 检查是否是FastGPT知识库搜索工具
      if (name.startsWith('fastgpt_knowledge_search')) {
        try {
          // 过滤出启用的配置
          const enabledConfigs = this.configs.filter((config) => config.enabled)
          // 提取索引
          let configIndex = 0
          const match = name.match(/_([0-9]+)$/)
          if (match) {
            configIndex = parseInt(match[1], 10) - 1
          }

          // 确保索引有效
          if (configIndex < 0 || configIndex >= enabledConfigs.length) {
            throw new Error(`无效的知识库索引: ${configIndex}`)
          }
          // 获取实际配置的索引
          const actualConfigIndex = this.configs.findIndex(
            (config) => config === enabledConfigs[configIndex]
          )

          return await this.performFastGptKnowledgeSearch(parameters, actualConfigIndex)
        } catch (error) {
          console.error('FastGPT知识库搜索失败:', error)
          return {
            content: [
              {
                type: 'text',
                text: `搜索失败: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `未知工具: ${name}`
          }
        ]
      }
    })
  }

  // 执行FastGPT知识库搜索
  private async performFastGptKnowledgeSearch(
    parameters: Record<string, unknown> | undefined,
    configIndex: number = 0
  ): Promise<{ content: MCPTextContent[] }> {
    const {
      query,
      topK = 5,
      scoreThreshold = 0.2
    } = parameters as {
      query: string
      topK?: number
      scoreThreshold?: number
    }

    if (!query) {
      throw new Error('查询内容不能为空')
    }

    // 获取当前配置
    const config = this.configs[configIndex]

    try {
      const url = `${config.endpoint.replace(/\/$/, '')}/core/dataset/searchTest`

      const response = await axios.post<FastGptSearchResponse>(
        url,
        {
          datasetId: config.datasetId,
          text: query,
          limit: 20000,
          similarity: scoreThreshold,
          searchMode: 'embedding',
          usingReRank: false
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          }
        }
      )

      if (response.data.code !== 200) {
        throw new Error(`FastGPT API错误: ${response.data.statusText}`)
      }

      // 处理响应数据
      const results = response.data.data.list.slice(0, topK).map((record) => {
        return {
          title: record.sourceName || '未知文档',
          documentId: record.sourceId,
          content: record.q,
          score: record.score.length > 0 ? record.score[0].value : 0
        }
      })

      // 构建响应
      let resultText = `### 查询: ${query}\n\n`

      if (results.length === 0) {
        resultText += '未找到相关结果。'
      } else {
        resultText += `找到 ${results.length} 条相关结果:\n\n`

        results.forEach((result, index) => {
          resultText += `#### ${index + 1}. ${result.title} (相关度: ${(result.score * 100).toFixed(2)}%)\n`
          resultText += `${result.content}\n\n`
        })
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      }
    } catch (error) {
      console.error('FastGPT API请求失败:', error)
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(
          `FastGPT API错误 (${error.response.status}): ${JSON.stringify(error.response.data)}`
        )
      }
      throw error
    }
  }
}
