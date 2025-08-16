import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { presenter } from '@/presenter'
import { Prompt } from '@shared/presenter'

// --- 类型定义和 Schema (合并后) ---

// 模板参数的 Schema
const TemplateParameterSchema = z.object({
  name: z.string().describe('参数名'),
  description: z.string().describe('参数描述'),
  required: z.boolean().describe('是否为必填参数')
  // type 字段已移除，所有模板参数都是 string
})

// 模板定义的 Schema
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TemplateDefinitionSchema = z.object({
  name: z.string().describe('模板名称'),
  description: z.string().describe('模板描述'),
  content: z.string().describe('模板内容，包含占位符'),
  parameters: z.array(TemplateParameterSchema).optional().describe('模板参数列表')
})

// 使用 z.infer 从 Schema 推断出 TypeScript 类型
type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>
// type TemplateParameter = z.infer<typeof TemplateParameterSchema>

// 获取模板参数信息的函数参数 Schema
const GetTemplateParametersArgsSchema = z.object({
  templateName: z.string().describe('要获取参数的模板名称')
})

// 填充模板的函数参数 Schema
const FillTemplateArgsSchema = z.object({
  templateName: z.string().describe('要填充的模板名称'),
  templateArgs: z.record(z.string(), z.string()).optional().describe('填充模板所需的参数键值对'),
  additionalContent: z.string().optional().describe('用户希望添加到Prompt末尾的额外内容')
})

// Zod Schema 转换为 JSON Schema
const GetTemplateParametersArgsJsonSchema = zodToJsonSchema(GetTemplateParametersArgsSchema)
const FillTemplateArgsJsonSchema = zodToJsonSchema(FillTemplateArgsSchema)

// --- MCP Server 实现 ---
export class AutoPromptingServer {
  private server: Server

  constructor() {
    this.server = new Server(
      {
        name: 'template-prompt-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {} // 只声明提供工具能力
        }
      }
    )

    this.setupRequestHandlers()
  }

  public startServer(transport: Transport): void {
    this.server.connect(transport)
  }

  /**
   * 辅助函数：根据模板名称从 presenter 获取模板定义。
   * 将 Prompt 类型转换为 TemplateDefinition 类型。
   * @param name 模板名称
   * @returns 模板定义或 undefined
   */
  private async getTemplateDefinition(name: string): Promise<TemplateDefinition | undefined> {
    try {
      const prompts: Prompt[] = await presenter.configPresenter.getCustomPrompts()
      const prompt = prompts.find((p) => p.name === name)

      if (!prompt) {
        return undefined
      }

      // 将 Prompt 转换为 TemplateDefinition，处理 content 可能为 undefined 的情况
      const templateDefinition: TemplateDefinition = {
        name: prompt.name,
        description: prompt.description,
        content: prompt.content || '', // 如果 content 为 undefined，使用空字符串
        parameters: prompt.parameters
      }

      return templateDefinition
    } catch (error) {
      console.error('Failed to retrieve custom templates:', error)
      return undefined
    }
  }

  // 列出所有可用工具 (对应 ListToolsRequestSchema)
  private listTools() {
    return {
      tools: [
        {
          name: 'list_all_prompt_template_names',
          description: '获取所有可用提示词模板的名称列表。',
          inputSchema: zodToJsonSchema(z.object({})) // 无需参数
        },
        {
          name: 'get_prompt_template_parameters',
          description: '根据提示词模板名称获取其所需的参数列表和描述。',
          inputSchema: GetTemplateParametersArgsJsonSchema
        },
        {
          name: 'fill_prompt_template',
          description: '根据提示词模板名称和参数，填充模板内容并生成最终的Prompt。',
          inputSchema: FillTemplateArgsJsonSchema
        }
      ]
    }
  }

  // 处理工具调用 (对应 CallToolRequestSchema)
  private async handleToolCall(request: z.infer<typeof CallToolRequestSchema>) {
    const { name, arguments: args } = request.params

    if (name === 'list_all_prompt_template_names') {
      // 1. 得到所有模板名
      try {
        const prompts: Prompt[] = await presenter.configPresenter.getCustomPrompts()
        const templateNames = prompts.map((p) => p.name)
        return {
          content: [{ type: 'text', text: JSON.stringify(templateNames) }]
        }
      } catch (error) {
        console.error('Failed to retrieve the list of template names:', error)
        throw new Error('Unable to retrieve the list of template names.')
      }
    } else if (name === 'get_prompt_template_parameters') {
      // 2. 得到模型的参数等信息
      const parsed = GetTemplateParametersArgsSchema.safeParse(args)
      if (!parsed.success) {
        throw new Error(
          `Invalid parameters for get_prompt_template_parameters: ${parsed.error.errors.map((e) => e.message).join(', ')}`
        )
      }

      const { templateName } = parsed.data
      const template = await this.getTemplateDefinition(templateName)

      if (!template) {
        throw new Error(`Template not found: ${templateName}`)
      }

      // 现在 template.parameters 已经是 TemplateParameterSchema 的类型，无需额外适配
      return {
        content: [{ type: 'text', text: JSON.stringify(template.parameters || []) }]
      }
    } else if (name === 'fill_prompt_template') {
      // 3. 填充模板，得到最终prompt
      const parsed = FillTemplateArgsSchema.safeParse(args)
      if (!parsed.success) {
        throw new Error(
          `Invalid parameters for fill_prompt_template: ${parsed.error.errors.map((e) => e.message).join(', ')}`
        )
      }

      const { templateName, templateArgs, additionalContent } = parsed.data
      const template = await this.getTemplateDefinition(templateName)

      if (!template) {
        throw new Error(`Template not found: ${templateName}`)
      }

      let filledContent = template.content // 使用模板内容

      // 替换参数占位符
      if (templateArgs && template.parameters) {
        for (const param of template.parameters) {
          const value = templateArgs[param.name] || ''
          filledContent = filledContent.replace(new RegExp(`{{${param.name}}}`, 'g'), value)
        }
      }

      // 添加额外内容
      const finalPrompt = additionalContent
        ? `${filledContent}\n\n${additionalContent}`
        : filledContent

      return {
        content: [{ type: 'text', text: finalPrompt }]
      }
    }

    throw new Error(`Unknown tool: ${name}`)
  }

  // 设置所有请求处理器
  private setupRequestHandlers(): void {
    // 注册 ListToolsRequestSchema 处理器，返回所有工具的元数据
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return this.listTools()
    })

    // 注册 CallToolRequestSchema 处理器，根据工具名称调用相应的处理逻辑
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        return await this.handleToolCall(request)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }
}
