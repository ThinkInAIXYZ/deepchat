// src/main/presenter/mcpPresenter/inMemoryServers/deepResearchServer.ts
// 主要代码参考自 https://github.com/pinkpixel-dev/deep-research-mcp
// 已替换搜索引擎为 Bocha，重写页面内容提取逻辑。
// 采用基于反思的增量迭代研究模式。
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import axios from 'axios'
import { presenter } from '@/presenter'
import { nanoid } from 'nanoid'

// === Schema 定义 ===

// StartDeepResearchArgsSchema: 启动深度研究的参数。
const StartDeepResearchArgsSchema = z.object({
  question: z.string().describe('要开始深度研究的研究问题或主题。')
})

// SingleWebSearchArgsSchema: 执行单次网页搜索的参数。
const SingleWebSearchArgsSchema = z.object({
  session_id: z.string().describe('来自 start_deep_research 的研究会话ID。'),
  query: z.string().describe('要执行的单个搜索查询。'),
  max_results: z.number().min(5).max(15).default(10).describe('此搜索查询的最大结果数 (5-15)。')
})

// RequestResearchDataArgsScema: LLM 请求当前累积搜索结果以进行反思的参数。
const RequestResearchDataArgsSchema = z.object({
  session_id: z.string().describe('研究会话ID。'),
  iteration: z.number().describe('当前研究迭代次数。LLM 应自行维护此数值并传入。')
})

// SubmitReflectionResultsArgsSchema: LLM 提交反思结果的参数。
const SubmitReflectionResultsArgsSchema = z.object({
  session_id: z.string().describe('研究会话ID。'),
  iteration: z.number().describe('此反思对应的迭代次数。'),
  needs_more_research: z.boolean().describe('LLM 分析后认为是否需要更多研究。'),
  missing_information: z.array(z.string()).describe('LLM 识别出的缺失信息列表，如果需要更多研究。'),
  quality_assessment: z.string().describe('LLM 对当前研究结果的质量评估。'),
  suggested_queries: z.array(z.string()).describe('LLM 基于当前信息和缺失点，建议的后续搜索查询。'),
  confidence_score: z
    .number()
    .min(0)
    .max(1)
    .describe('LLM 对当前研究完整性和准确性的置信度（0-1 范围）。')
})

// GenerateFinalAnswerArgsSchema: 生成最终研究报告的参数。
const GenerateFinalAnswerArgsSchema = z.object({
  session_id: z.string().describe('来自 start_deep_research 的研究会话ID。'),
  documentation_prompt: z.string().optional().describe('自定义文档生成提示词。')
})

// 默认文档生成提示词
const DEFAULT_DOCUMENTATION_PROMPT = `
对于所有查询，请广泛搜索网页以获取最新信息。研究多个来源。利用所有提供的工具来收集尽可能多的上下文。适当时包含截图。
创建文档时请遵循以下指导原则：
1. 内容质量：
  清晰、简洁且事实准确
  结构逻辑清晰
  主题覆盖全面
  技术精确，注重细节
  不含不必要的评论或幽默
2. 文档风格：
  专业客观的语气
  透彻的解释，技术深度适中
  格式良好，包含适当的标题、列表和代码块
  术语和命名约定保持一致
  布局整洁、易读，无多余元素
3. 代码质量：
  代码干净、可维护且注释良好
  遵循最佳实践和现代模式
  适当的错误处理和边缘情况考虑
  优化性能和效率
  遵循语言特定的风格指南
4. 技术专长：
  编程语言和框架
  系统架构和设计模式
  开发方法论和实践
  安全考虑和标准
  行业标准工具和技术
5. 文档要求：
  当被要求时，请围绕给定主题创建一份极其详细、全面的 Markdown 文档。
`
// === 接口定义 ===

// ReflectionResult: LLM 提交给服务器的反思结果结构。
interface ReflectionResult {
  needs_more_research: boolean // 是否需要更多研究
  missing_information: string[] // 缺失信息列表
  quality_assessment: string // 研究质量评估
  suggested_queries: string[] // 建议的后续查询
  confidence_score: number // 置信度得分 (0-1)
}

// SearchResult: 单条搜索结果的数据结构。
interface SearchResult {
  title: string
  url: string
  snippet: string
  published_date?: string
}

// QuerySearchResult: 单次查询对应的多条搜索结果。
interface QuerySearchResult {
  query: string
  results: SearchResult[]
}

// ResearchSession: 研究会话的数据结构。
interface ResearchSession {
  session_id: string
  question: string
  iteration: number // 会话迭代次数，由 LLM 维护并在提交反思时更新
  search_results: QuerySearchResult[] // 存储所有搜索查询及其结果
  reflections: ReflectionResult[] // 存储 LLM 提交的历次反思结果
  suggested_queries: string[] // 上次反思后 LLM 建议的查询

  // last_reflected_search_index: 记录 LLM 上次反思时已处理到的 search_results 数组的索引。
  // 用于实现增量数据发送，下次请求时从此索引后开始提供新数据。
  last_reflected_search_index: number

  created_at: Date
  last_accessed_at: Date
  is_completed: boolean // 会话是否已完成并等待清理
}

// BochaWebSearchResponse: Bocha 搜索引擎 API 的响应结构。
interface BochaWebSearchResponse {
  msg: string | null
  data: {
    _type: string
    queryContext: {
      originalQuery: string
    }
    webPages: {
      webSearchUrl: string
      totalEstimatedMatches: number
      value: Array<{
        id: string | null
        name: string
        url: string
        displayUrl: string
        snippet: string
        summary: string // Bocha 提供的摘要，用于结果展示
        siteName: string
        siteIcon: string
        dateLastCrawled: string
        cachedPageUrl: string | null
        language: string | null
        isFamilyFriendly: boolean | null
        isNavigational: boolean | null
        datePublished?: string // 发布日期
      }>
      isFamilyFriendly: boolean | null
    }
    videos: unknown | null // 视频结果，当前未使用
  }
}

export class DeepResearchServer {
  private server: Server
  private bochaApiKey: string
  private researchSessions: Map<string, ResearchSession> = new Map()
  private readonly SESSION_TIMEOUT = 60 * 60 * 1000 // 会话超时时间：1 小时
  private readonly MAX_SESSIONS = 50 // 最大并发会话数
  private cleanupTimer: NodeJS.Timeout | null = null // 会话清理计时器

  constructor(env?: Record<string, unknown>) {
    // 检查 Bocha API 密钥是否已提供
    if (!env?.BOCHA_API_KEY) {
      throw new Error('需要 BOCHA_API_KEY')
    }
    this.bochaApiKey = env.BOCHA_API_KEY as string

    this.server = new Server(
      {
        name: 'deepchat-inmemory/deep-research-server',
        version: '2.0.0' // 版本号更新
      },
      {
        capabilities: {
          tools: {} // 声明支持工具能力
        }
      }
    )

    this.setupRequestHandlers() // 设置请求处理器
    this.startCleanupTimer() // 启动会话清理计时器
  }

  // 启动服务器并连接传输层
  public startServer(transport: Transport): void {
    this.server.connect(transport)
  }

  // 启动会话清理计时器，定期清理过期会话
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      () => {
        this.cleanupExpiredSessions()
      },
      5 * 60 * 1000 // 每 5 分钟检查一次
    )
  }

  // 清理过期的研究会话
  private cleanupExpiredSessions(): void {
    const now = new Date()
    const expiredSessions: string[] = []

    for (const [sessionId, session] of this.researchSessions.entries()) {
      if (now.getTime() - session.last_accessed_at.getTime() > this.SESSION_TIMEOUT) {
        expiredSessions.push(sessionId)
      }
    }

    expiredSessions.forEach((sessionId) => {
      this.researchSessions.delete(sessionId)
      console.log(`已清理过期研究会话: ${sessionId}`)
    })

    // 如果会话数超限，清理最早访问的会话
    if (this.researchSessions.size > this.MAX_SESSIONS) {
      const sortedSessions = Array.from(this.researchSessions.entries()).sort(
        ([, a], [, b]) => a.last_accessed_at.getTime() - b.last_accessed_at.getTime()
      )

      const toRemove = sortedSessions.slice(0, this.researchSessions.size - this.MAX_SESSIONS)
      toRemove.forEach(([sessionId]) => {
        this.researchSessions.delete(sessionId)
        console.log(`因超限已清理旧研究会话: ${sessionId}`)
      })
    }
  }

  // 获取指定 ID 的研究会话，并更新最后访问时间
  private getSession(sessionId: string): ResearchSession {
    const session = this.researchSessions.get(sessionId)
    if (!session) {
      throw new Error(`未找到研究会话: ${sessionId}`)
    }
    session.last_accessed_at = new Date() // 更新最后访问时间
    return session
  }

  // 创建新的研究会话
  private createSession(question: string): ResearchSession {
    const sessionId = nanoid() // 生成唯一会话 ID
    const session: ResearchSession = {
      session_id: sessionId,
      question,
      iteration: 0, // 初始迭代为 0
      search_results: [],
      reflections: [],
      suggested_queries: [], // 初始建议查询由 LLM 决定
      last_reflected_search_index: -1, // 初始无结果被反思
      created_at: new Date(),
      last_accessed_at: new Date(),
      is_completed: false
    }

    this.researchSessions.set(sessionId, session)
    return session
  }

  // 清理指定 ID 的研究会话数据
  private cleanupSession(sessionId: string): void {
    const removed = this.researchSessions.delete(sessionId)
    if (removed) {
      console.log(`研究会话已清理: ${sessionId}`)
    }
  }

  // 设置服务器的请求处理器，定义工具列表和工具调用逻辑
  private setupRequestHandlers(): void {
    // 定义可用工具列表
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'start_deep_research',
            description: '启动一个新的深度研究会话。返回 session_id 用于后续操作。',
            inputSchema: zodToJsonSchema(StartDeepResearchArgsSchema)
          },
          {
            name: 'execute_single_web_search',
            description: '在研究会话内执行一次网页搜索。',
            inputSchema: zodToJsonSchema(SingleWebSearchArgsSchema)
          },
          {
            name: 'request_research_data',
            description: '请求当前会话中新增的搜索结果和研究背景，供 LLM 反思。',
            inputSchema: zodToJsonSchema(RequestResearchDataArgsSchema)
          },
          {
            name: 'submit_reflection_results',
            description: 'LLM 提交其对研究数据的反思结果（如是否需更多研究、建议查询等）。',
            inputSchema: zodToJsonSchema(SubmitReflectionResultsArgsSchema)
          },
          {
            name: 'generate_final_answer',
            description: '根据累积研究生成最终答案，并清理会话数据。',
            inputSchema: zodToJsonSchema(GenerateFinalAnswerArgsSchema)
          }
        ]
      }
    })

    // 处理工具调用请求
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        switch (name) {
          case 'start_deep_research':
            return await this.handleStartDeepResearch(args)
          case 'execute_single_web_search':
            return await this.handleSingleWebSearch(args)
          case 'request_research_data': // 处理请求研究数据的工具
            return await this.handleRequestResearchData(args)
          case 'submit_reflection_results': // 处理提交反思结果的工具
            return await this.handleSubmitReflectionResults(args)
          case 'generate_final_answer':
            return await this.handleGenerateFinalAnswer(args)
          default:
            throw new Error(`未知工具: ${name}`)
        }
      } catch (error) {
        console.error('调用工具时出错:', error)
        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : '发生未知错误'

        return {
          content: [{ type: 'text', text: `错误: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }

  // 处理启动深度研究请求
  private async handleStartDeepResearch(args: unknown) {
    const parsed = StartDeepResearchArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`start_deep_research 参数无效: ${parsed.error}`)
    }
    const { question } = parsed.data
    const session = this.createSession(question)

    // 优化：返回简洁响应，包含 session_id 和下一步指示
    const response = {
      session_id: session.session_id,
      next_steps: `研究会话已创建 (ID: ${session.session_id})。LLM 请生成初始搜索查询，并使用 execute_single_web_search 执行搜索。完成后调用 request_research_data 获取数据反思。`
    }
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] }
  }

  // 处理单次网页搜索请求
  private async handleSingleWebSearch(args: unknown) {
    const parsed = SingleWebSearchArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`execute_single_web_search 参数无效: ${parsed.error}`)
    }
    const { session_id, query, max_results } = parsed.data
    const session = this.getSession(session_id)

    try {
      const searchResult = await this.performSingleBochaSearch(query, max_results)
      session.search_results.push(searchResult) // 存储搜索结果

      // 优化：返回简洁响应，包含结果数量和下一步指示
      const response = {
        results_count: searchResult.results.length,
        next_steps: `搜索结果已存储。可继续搜索，或调用 request_research_data 获取数据反思。`
      }
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] }
    } catch (error) {
      const axiosError = error as { message?: string }
      console.error('单次网页搜索出错:', axiosError.message)
      throw new Error(`单次网页搜索失败: ${axiosError.message}`)
    }
  }

  // 处理请求研究数据的请求 (增量发送)
  private async handleRequestResearchData(args: unknown) {
    const parsed = RequestResearchDataArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`request_research_data 参数无效: ${parsed.error}`)
    }
    const { session_id } = parsed.data // iteration 由 LLM 维护
    const session = this.getSession(session_id)

    // 计算并发送自上次反思以来的新增搜索结果
    const startIndex = session.last_reflected_search_index + 1
    const newSearchResults = session.search_results.slice(startIndex)

    const newConsolidatedResearchContent = newSearchResults
      .map(
        (sr) =>
          `=== 搜索查询: ${sr.query} ===\n` +
          sr.results
            .map(
              (result, idx) =>
                `[来源 ${idx + 1}] ${result.title}\n` +
                `URL: ${result.url}\n` +
                `发布日期: ${result.published_date || '未知'}\n` +
                `内容摘要: ${result.snippet}\n` + // 使用 Bocha 提供的 summary
                `---`
            )
            .join('\n')
      )
      .join('\n\n')

    // 优化：返回简洁响应，仅包含新增结果和反思指令
    const response = {
      new_search_results_to_reflect: newConsolidatedResearchContent, // 仅发送新增的搜索结果
      reflection_instructions: `
你是一个严谨的研究分析师。你已收到一批新的搜索结果。
请将这些新增结果与你（LLM）已有的历史研究数据结合，对【整个累积的研究上下文】进行全面评估。
基于这些【整个累积研究上下文】信息，判断是否已充分回答研究问题：“${session.question}”。

你的任务是生成结构化的 JSON 结果，包含字段：
- needs_more_research: boolean (是否需更多研究)
- missing_information: string[] (若需更多研究，列出缺失信息)
- quality_assessment: string (当前研究质量评估)
- suggested_queries: string[] (若需更多研究，建议3-5个新查询)
- confidence_score: number (0-1，当前研究完整性与准确性的置信度)

请严格以 JSON 格式输出，不要包含任何额外解释。
`,
      next_steps: `LLM 请使用上述数据和指令进行反思，然后调用 submit_reflection_results 提交分析结果。`
    }
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] }
  }

  // 处理提交反思结果的请求
  private async handleSubmitReflectionResults(args: unknown) {
    const parsed = SubmitReflectionResultsArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`submit_reflection_results 参数无效: ${parsed.error}`)
    }
    const {
      session_id,
      iteration,
      needs_more_research,
      missing_information,
      quality_assessment,
      suggested_queries,
      confidence_score
    } = parsed.data
    const session = this.getSession(session_id)

    // 存储 LLM 提交的反思结果
    const reflection: ReflectionResult = {
      needs_more_research,
      missing_information,
      quality_assessment,
      suggested_queries,
      confidence_score
    }
    session.reflections.push(reflection)
    session.iteration = iteration // LLM 更新迭代次数
    session.suggested_queries = suggested_queries || [] // 更新建议查询

    // 核心：更新 last_reflected_search_index，标记 LLM 已处理到当前所有搜索结果
    // 如果 search_results 为空，length 为 0，则 last_reflected_search_index 为 -1，正确。
    session.last_reflected_search_index = session.search_results.length - 1

    // 优化：返回简洁响应，仅包含下一步指示
    const nextStepsMessage = needs_more_research
      ? `LLM 分析表明需要更多研究。建议的后续查询已更新。LLM 请使用建议查询执行额外搜索。`
      : `LLM 分析表明已收集足够信息。LLM 请调用 generate_final_answer 生成最终报告。`

    return {
      content: [{ type: 'text', text: JSON.stringify({ next_steps: nextStepsMessage }, null, 2) }]
    }
  }

  // 处理生成最终答案的请求
  private async handleGenerateFinalAnswer(args: unknown) {
    const parsed = GenerateFinalAnswerArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`generate_final_answer 参数无效: ${parsed.error}`)
    }
    const { session_id, documentation_prompt } = parsed.data
    const session = this.getSession(session_id)

    // 构建用于最终报告的研究数据概览
    const researchData = {
      original_question: session.question, // 报告主题
      total_iterations: session.iteration,
      total_searches: session.search_results.length,
      total_results: session.search_results.reduce((sum, sr) => sum + sr.results.length, 0),
      reflections: session.reflections, // LLM 历次反思结果
      // 最终置信度取自最后一次反思
      final_confidence:
        session.reflections.length > 0
          ? session.reflections[session.reflections.length - 1].confidence_score
          : 0.5 // 若无反思，默认0.5
    }

    const locale = presenter.configPresenter.getLanguage?.() || 'zh-CN' // 获取用户语言设置
    const finalDocumentationPrompt =
      documentation_prompt ||
      `${DEFAULT_DOCUMENTATION_PROMPT}
用户当前的系统语言是 ${locale}，请除非另有说明，否则用系统语言回复。`

    // 构建完整的、供 LLM 生成最终报告所需的研究内容
    const completeResearchContent = {
      // research_question 已在 researchData.original_question 中提供
      research_metadata: {
        // 研究元数据
        session_id: session.session_id,
        session_created: session.created_at.toISOString(),
        session_duration: `${Math.round((new Date().getTime() - session.created_at.getTime()) / 1000 / 60)} 分钟`,
        total_iterations: researchData.total_iterations,
        total_searches: researchData.total_searches,
        total_sources: researchData.total_results,
        final_confidence_score: `${(researchData.final_confidence * 100).toFixed(1)}%`
      },
      // research_reflections: LLM 历次反思过程，帮助其理解决策历史。
      research_reflections: session.reflections.map((reflection, index) => ({
        iteration: index + 1, // 迭代从 1 开始计数
        needs_more_research: reflection.needs_more_research,
        confidence_score: `${(reflection.confidence_score * 100).toFixed(1)}%`,
        quality_assessment: reflection.quality_assessment,
        missing_information: reflection.missing_information,
        suggested_queries: reflection.suggested_queries
      })),
      // consolidated_research_content: 所有搜索结果的摘要合并文本，LLM 生成报告的核心依据。
      consolidated_research_content: session.search_results
        .map(
          (sr) =>
            `=== 搜索查询: ${sr.query} ===\n` +
            sr.results
              .map(
                (result, idx) =>
                  `[来源 ${idx + 1}] ${result.title}\n` +
                  `URL: ${result.url}\n` +
                  `发布日期: ${result.published_date || '未知'}\n` +
                  `内容摘要: ${result.snippet}\n` +
                  `---`
              )
              .join('\n')
        )
        .join('\n\n'),
      documentation_instructions: finalDocumentationPrompt, // 文档生成指令
      summary_instructions: `  // 最终报告生成指令
请根据上方完整的科研数据，为用户的问题：“${session.question}”生成一份全面且详细的研究报告。
报告应包括：
1. 问题概述和研究背景
2. 主要发现和关键信息点
3. 不同来源观点的比较分析
4. 具体的实施建议或解决方案
5. 相关最新发展和趋势
6. 参考文献和信息来源
请确保：
- 充分利用所有搜索结果中的信息
- 保持客观性和准确性
- 提供具体细节和示例
- 除非另有说明，否则请用用户的系统语言（${locale}）回复
- 适当引用具体来源和链接
`,
      cleanup_status: '此响应后会话数据将被清理',
      original_research_question: researchData.original_question // 明确提供原始研究问题
    }

    session.is_completed = true // 标记会话完成，准备清理
    setTimeout(() => {
      // 延迟清理，确保响应已发送
      this.cleanupSession(session_id)
    }, 1000)

    return {
      content: [{ type: 'text', text: JSON.stringify(completeResearchContent, null, 2) }]
    }
  }

  // 执行单次 Bocha 网页搜索
  private async performSingleBochaSearch(
    query: string,
    maxResults: number
  ): Promise<QuerySearchResult> {
    try {
      const response = await axios.post(
        'https://api.bochaai.com/v1/web-search', // Bocha API 地址
        {
          query,
          summary: true, // 请求摘要
          freshness: 'noLimit', // 不限制时效性
          count: maxResults // 结果数量
        },
        {
          headers: {
            Authorization: `Bearer ${this.bochaApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30秒超时
        }
      )

      const searchResponse = response.data as BochaWebSearchResponse
      const results = searchResponse.data?.webPages?.value || [] // 获取网页结果

      return {
        query,
        results: results.map(
          (item): SearchResult => ({
            title: item.name,
            url: item.url,
            snippet: item.summary, // 使用 Bocha 返回的 summary 作为 snippet
            published_date: item.datePublished
          })
        )
      }
    } catch (error) {
      console.error(`查询 "${query}" 搜索失败:`, error)
      return { query, results: [] } // 失败时返回空结果
    }
  }

  // 销毁服务器实例时清理资源
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.researchSessions.clear() // 清理所有会话
    console.log('DeepResearchServer 已销毁，所有会话已清理')
  }

  // 获取会话统计信息 (用于调试和监控)
  public getSessionStats(): {
    total_sessions: number
    active_sessions: number
    completed_sessions: number
    oldest_session_age_minutes: number
  } {
    const now = new Date()
    let activeCount = 0
    let completedCount = 0
    let oldestAge = 0

    for (const session of this.researchSessions.values()) {
      if (session.is_completed) {
        completedCount++
      } else {
        activeCount++
      }
      const ageMinutes = Math.round((now.getTime() - session.created_at.getTime()) / 1000 / 60)
      if (ageMinutes > oldestAge) {
        oldestAge = ageMinutes
      }
    }

    return {
      total_sessions: this.researchSessions.size,
      active_sessions: activeCount,
      completed_sessions: completedCount, // 已完成但可能尚未被清理的会话
      oldest_session_age_minutes: oldestAge
    }
  }
}
