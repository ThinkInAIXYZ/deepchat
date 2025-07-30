import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import axios from 'axios'

// Schema definitions
const DifyKnowledgeSearchArgsSchema = z.object({
  query: z.string().describe('搜索查询内容 (必填)'),
  topK: z.number().optional().default(5).describe('返回结果数量 (默认5条)'),
  scoreThreshold: z.number().optional().default(0.2).describe('相似度阈值 (0-1之间，默认0.2)')
})

// 定义Dify API返回的数据结构
interface DifySearchResponse {
  query: {
    content: string
  }
  records: Array<{
    segment: {
      id: string
      position: number
      document_id: string
      content: string
      word_count: number
      tokens: number
      keywords: string[]
      index_node_id: string
      index_node_hash: string
      hit_count: number
      enabled: boolean
      status: string
      created_by: string
      created_at: number
      indexing_at: number
      completed_at: number
      document?: {
        id: string
        data_source_type: string
        name: string
      }
    }
    score: number
  }>
}

// 导入MCPTextContent接口
import { MCPTextContent } from '@shared/presenter'

export class DifyKnowledgeServer {
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
    console.log('DifyKnowledgeServer constructor', env)
    if (!env) {
      throw new Error('需要提供Dify知识库配置')
    }

    const envs = env.configs

    if (!Array.isArray(envs) || envs.length === 0) {
      throw new Error('需要提供至少一个Dify知识库配置')
    }

    // 处理每个配置
    for (const env of envs) {
      if (!env.apiKey) {
        throw new Error('需要提供Dify API Key')
      }
      if (!env.datasetId) {
        throw new Error('需要提供Dify Dataset ID')
      }
      if (!env.description) {
        throw new Error('需要提供对这个知识库的描述，以方便ai决定是否检索此知识库')
      }

      this.configs.push({
        apiKey: env.apiKey,
        datasetId: env.datasetId,
        endpoint: env.endpoint || 'https://api.dify.ai/v1',
        description: env.description,
        enabled: env.enabled
      })
    }

    // 创建服务器实例
    this.server = new Server(
      {
        name: 'deepchat-inmemory/dify-knowledge-server',
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
            name: `dify_knowledge_search${suffix}`,
            description: config.description,
            inputSchema: zodToJsonSchema(DifyKnowledgeSearchArgsSchema)
          }
        })

      return { tools }
    })

    // 设置工具调用处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: parameters } = request.params

      // 检查是否是Dify知识库搜索工具
      if (name.startsWith('dify_knowledge_search')) {
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

          return await this.performDifyKnowledgeSearch(parameters, actualConfigIndex)
        } catch (error) {
          console.error('Dify知识库搜索失败:', error)
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

  // 执行Dify知识库搜索
  private async performDifyKnowledgeSearch(
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
      const url = `${config.endpoint.replace(/\/$/, '')}/datasets/${config.datasetId}/retrieve`
      console.log('performDifyKnowledgeSearch request', url, {
        query,
        retrieval_model: {
          top_k: topK,
          score_threshold: scoreThreshold
        }
      })

      const response = await axios.post<DifySearchResponse>(
        url,
        {
          query,
          retrieval_model: {
            top_k: topK,
            score_threshold: scoreThreshold,
            reranking_enable: null, // 下面这两个字段即使为空也必须要有，否则接口无法请求
            score_threshold_enabled: null
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          }
        }
      )

      // 处理响应数据
      const results = response.data.records.map((record) => {
        const docName = record.segment.document?.name || '未知文档'
        const docId = record.segment.document_id
        const content = record.segment.content
        const score = record.score

        return {
          title: docName,
          documentId: docId,
          content: content,
          score: score,
          keywords: record.segment.keywords || []
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

          if (result.keywords && result.keywords.length > 0) {
            resultText += `关键词: ${result.keywords.join(', ')}\n\n`
          }
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
      console.error('Dify API请求失败:', error)
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(
          `Dify API错误 (${error.response.status}): ${JSON.stringify(error.response.data)}`
        )
      }
      throw error
    }
  }
}
