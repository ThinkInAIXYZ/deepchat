import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import axios from 'axios'

// Schema definitions
const RagflowKnowledgeSearchArgsSchema = z.object({
  query: z.string().describe('搜索查询内容 (必填)'),
  topK: z.number().optional().default(5).describe('返回结果数量 (默认5条)'),
  scoreThreshold: z.number().optional().default(0.2).describe('相似度阈值 (0-1之间，默认0.2)'),
  keyword: z.boolean().optional().default(false).describe('是否启用关键词匹配 (默认false)'),
  highlight: z.boolean().optional().default(false).describe('是否高亮匹配的文本 (默认false)')
})

// 定义RAGFlow API返回的数据结构
interface RagflowSearchResponse {
  code: number
  data: {
    chunks: Array<{
      content: string
      content_ltks: string
      document_id: string
      document_keyword: string
      highlight?: string
      id: string
      image_id: string
      important_keywords: string[]
      kb_id: string
      positions: string[]
      similarity: number
      term_similarity: number
      vector_similarity: number
    }>
    doc_aggs: Array<{
      count: number
      doc_id: string
      doc_name: string
    }>
    total: number
  }
}

// 导入MCPTextContent接口
import { MCPTextContent } from '@shared/presenter'

export class RagflowKnowledgeServer {
  private server: Server
  private configs: Array<{
    apiKey: string
    endpoint: string
    datasetIds: string[]
    description: string
    enabled: boolean
  }> = []

  constructor(env?: {
    configs: {
      apiKey: string
      endpoint: string
      datasetIds: string[]
      description: string
      enabled: boolean
    }[]
  }) {
    if (!env) {
      throw new Error('需要提供RAGFlow知识库配置')
    }

    const envs = env.configs

    if (!Array.isArray(envs) || envs.length === 0) {
      throw new Error('需要提供至少一个RAGFlow知识库配置')
    }

    // 处理每个配置
    for (const env of envs) {
      if (!env.apiKey) {
        throw new Error('需要提供RAGFlow API Key')
      }
      if (!env.datasetIds || !Array.isArray(env.datasetIds) || env.datasetIds.length === 0) {
        throw new Error('需要提供至少一个RAGFlow Dataset ID')
      }
      if (!env.description) {
        throw new Error('需要提供对这个知识库的描述，以方便ai决定是否检索此知识库')
      }

      this.configs.push({
        apiKey: env.apiKey,
        datasetIds: env.datasetIds,
        endpoint: env.endpoint || 'http://localhost:8000',
        description: env.description,
        enabled: env.enabled
      })
    }

    // 创建服务器实例
    this.server = new Server(
      {
        name: 'deepchat-inmemory/ragflow-knowledge-server',
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
            name: `ragflow_knowledge_search${suffix}`,
            description: config.description,
            inputSchema: zodToJsonSchema(RagflowKnowledgeSearchArgsSchema)
          }
        })
      return { tools }
    })

    // 设置工具调用处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: parameters } = request.params

      // 检查是否是RAGFlow知识库搜索工具
      if (name.startsWith('ragflow_knowledge_search')) {
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

          return await this.performRagflowKnowledgeSearch(parameters, actualConfigIndex)
        } catch (error) {
          console.error('RAGFlow知识库搜索失败:', error)
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

  // 执行RAGFlow知识库搜索
  private async performRagflowKnowledgeSearch(
    parameters: Record<string, unknown> | undefined,
    configIndex: number = 0
  ): Promise<{ content: MCPTextContent[] }> {
    const {
      query,
      topK = 5,
      scoreThreshold = 0.2,
      keyword = false,
      highlight = false
    } = parameters as {
      query: string
      topK?: number
      scoreThreshold?: number
      keyword?: boolean
      highlight?: boolean
    }

    if (!query) {
      throw new Error('查询内容不能为空')
    }

    // 获取当前配置
    const config = this.configs[configIndex]

    try {
      const url = `${config.endpoint.replace(/\/$/, '')}/api/v1/retrieval`
      console.log('performRagflowKnowledgeSearch request', url, {
        question: query,
        dataset_ids: config.datasetIds,
        top_k: topK,
        similarity_threshold: scoreThreshold,
        keyword,
        highlight
      })

      const response = await axios.post<RagflowSearchResponse>(
        url,
        {
          question: query,
          dataset_ids: config.datasetIds,
          page_size: topK,
          similarity_threshold: scoreThreshold,
          keyword,
          highlight
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          }
        }
      )

      if (response.data.code !== 0) {
        throw new Error(`RAGFlow API错误: ${response.data.code}`)
      }

      // 处理响应数据
      const results = response.data.data.chunks.map((chunk) => {
        const docName = chunk.document_keyword || '未知文档'
        const docId = chunk.document_id
        const content = highlight && chunk.highlight ? chunk.highlight : chunk.content
        const score = chunk.similarity

        return {
          title: docName,
          documentId: docId,
          content: content,
          score: score,
          keywords: chunk.important_keywords || []
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
      console.error('RAGFlow API请求失败:', error)
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(
          `RAGFlow API错误 (${error.response.status}): ${JSON.stringify(error.response.data)}`
        )
      }
      throw error
    }
  }
}
