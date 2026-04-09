import type {
  IConfigPresenter,
  IMCPPresenter,
  MCPToolDefinition,
  MCPToolCall,
  MCPToolResponse
} from '@shared/presenter'
import type { AgentToolProgressUpdate } from '@shared/types/presenters/tool.presenter'
import { resolveToolOffloadTemplatePath } from '@/lib/agentRuntime/sessionPaths'
import { QUESTION_TOOL_NAME } from '@/lib/agentRuntime/questionTool'
import { ToolMapper } from './toolMapper'
import { AgentToolManager, type AgentToolCallResult } from './agentTools'
import type { AgentToolRuntimePort } from './runtimePorts'
import { jsonrepair } from 'jsonrepair'
import { CommandPermissionService } from '../permission'
import { YO_BROWSER_TOOL_NAMES } from '../browser/YoBrowserToolDefinitions'

interface PreCheckedPermissionResult {
  needsPermission: true
  toolName: string
  serverName: string
  permissionType: 'read' | 'write' | 'all' | 'command'
  description: string
  paths?: string[]
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
  rememberable?: boolean
  [key: string]: unknown
}

export interface IToolPresenter {
  getAllToolDefinitions(context: {
    enabledMcpTools?: string[]
    disabledAgentTools?: string[]
    chatMode?: 'agent' | 'acp agent'
    supportsVision?: boolean
    agentWorkspacePath?: string | null
    conversationId?: string
  }): Promise<MCPToolDefinition[]>
  callTool(
    request: MCPToolCall,
    options?: {
      onProgress?: (update: AgentToolProgressUpdate) => void
      signal?: AbortSignal
    }
  ): Promise<{ content: unknown; rawData: MCPToolResponse }>
  preCheckToolPermission?(request: MCPToolCall): Promise<PreCheckedPermissionResult | null>
  buildToolSystemPrompt(context: {
    conversationId?: string
    toolDefinitions?: MCPToolDefinition[]
  }): string
}

interface ToolPresenterOptions {
  mcpPresenter: IMCPPresenter
  configPresenter: IConfigPresenter
  commandPermissionHandler?: CommandPermissionService
  agentToolRuntime: AgentToolRuntimePort
}

const FILESYSTEM_TOOL_ORDER = ['read', 'write', 'edit', 'exec', 'process']
const OFFLOAD_TOOL_NAMES = new Set(['exec', 'cdp_send'])
const RESERVED_AGENT_TOOL_NAMES = new Set<string>(YO_BROWSER_TOOL_NAMES)

const withToolSource = (tools: MCPToolDefinition[], source: 'mcp' | 'agent'): MCPToolDefinition[] =>
  tools.map((tool) => ({
    ...tool,
    source
  }))

const normalizeToolNames = (toolNames?: string[]): string[] => {
  if (!Array.isArray(toolNames)) {
    return []
  }

  return Array.from(
    new Set(
      toolNames
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

/**
 * ToolPresenter - Unified tool routing presenter
 * Manages all tool sources (MCP, Agent) and provides unified interface
 */
export class ToolPresenter implements IToolPresenter {
  private readonly mapper: ToolMapper
  private readonly options: ToolPresenterOptions
  private agentToolManager: AgentToolManager | null = null

  constructor(options: ToolPresenterOptions) {
    this.options = options
    this.mapper = new ToolMapper()
  }

  /**
   * Get all tool definitions from all sources
   * Returns unified MCP-format tool definitions
   */
  async getAllToolDefinitions(context: {
    enabledMcpTools?: string[]
    disabledAgentTools?: string[]
    chatMode?: 'agent' | 'acp agent'
    supportsVision?: boolean
    agentWorkspacePath?: string | null
    conversationId?: string
  }): Promise<MCPToolDefinition[]> {
    const defs: MCPToolDefinition[] = []
    this.mapper.clear()

    const chatMode = context.chatMode || 'agent'
    const supportsVision = context.supportsVision || false
    const agentWorkspacePath = context.agentWorkspacePath || null

    // 1. Get MCP tools
    const mcpDefs = withToolSource(
      (await this.options.mcpPresenter.getAllToolDefinitions(context.enabledMcpTools)).filter(
        (tool) => !RESERVED_AGENT_TOOL_NAMES.has(tool.function.name)
      ),
      'mcp'
    )
    defs.push(...mcpDefs)
    this.mapper.registerTools(mcpDefs, 'mcp')

    // 2. Get Agent tools (always load in agent or acp agent mode)
    // Initialize or update AgentToolManager if workspace path changed
    if (!this.agentToolManager) {
      this.agentToolManager = new AgentToolManager({
        agentWorkspacePath,
        configPresenter: this.options.configPresenter,
        commandPermissionHandler: this.options.commandPermissionHandler,
        runtimePort: this.options.agentToolRuntime
      })
    }

    try {
      const agentDefs = withToolSource(
        await this.agentToolManager.getAllToolDefinitions({
          chatMode,
          supportsVision,
          agentWorkspacePath,
          conversationId: context.conversationId
        }),
        'agent'
      )
      const disabledAgentToolSet = new Set(normalizeToolNames(context.disabledAgentTools))
      const dedupedAgentDefs = agentDefs.filter((tool) => {
        if (!this.mapper.hasTool(tool.function.name)) return true
        console.warn(
          `[ToolPresenter] Tool name conflict for '${tool.function.name}', preferring MCP tool.`
        )
        return false
      })
      const filteredAgentDefs = dedupedAgentDefs.filter(
        (tool) => !disabledAgentToolSet.has(tool.function.name)
      )
      defs.push(...filteredAgentDefs)
      this.mapper.registerTools(filteredAgentDefs, 'agent')
    } catch (error) {
      console.warn('[ToolPresenter] Failed to load Agent tool definitions', error)
    }

    return defs
  }

  /**
   * Call a tool, routing to the appropriate source based on mapping
   */
  async callTool(
    request: MCPToolCall,
    options?: {
      onProgress?: (update: AgentToolProgressUpdate) => void
      signal?: AbortSignal
    }
  ): Promise<{ content: unknown; rawData: MCPToolResponse }> {
    const toolName = request.function.name
    const source = this.mapper.getToolSource(toolName)

    if (!source) {
      throw new Error(`Tool ${toolName} not found in any source`)
    }

    if (source === 'agent') {
      if (!this.agentToolManager) {
        throw new Error(`Agent tool manager not initialized for tool ${toolName}`)
      }
      // Route to Agent tool manager
      let args: Record<string, unknown> = {}
      const argsString = request.function.arguments || ''
      if (argsString.trim().length > 0) {
        try {
          args = JSON.parse(argsString) as Record<string, unknown>
        } catch (error) {
          console.warn('[ToolPresenter] Failed to parse tool arguments, trying jsonrepair:', error)
          try {
            args = JSON.parse(jsonrepair(argsString)) as Record<string, unknown>
          } catch (error) {
            console.warn(
              '[ToolPresenter] Failed to repair tool arguments, using empty args.',
              error
            )
            args = {}
          }
        }
      }
      const response = await this.agentToolManager.callTool(
        toolName,
        args,
        request.conversationId,
        {
          toolCallId: request.id,
          onProgress: options?.onProgress,
          signal: options?.signal
        }
      )
      const resolvedResponse = this.resolveAgentToolResponse(response)
      const rawData = resolvedResponse.rawData ?? {}
      return {
        content: resolvedResponse.content,
        rawData: {
          ...rawData,
          toolCallId: request.id,
          content: rawData.content ?? resolvedResponse.content
        }
      }
    }

    // Route to MCP (default)
    return await this.options.mcpPresenter.callTool(request)
  }

  /**
   * Pre-check tool permissions without executing the tool
   * Routes to the appropriate source based on tool mapping
   */
  async preCheckToolPermission(request: MCPToolCall): Promise<PreCheckedPermissionResult | null> {
    const toolName = request.function.name
    const source = this.mapper.getToolSource(toolName)

    if (!source) {
      console.warn(`[ToolPresenter] Tool ${toolName} not found for permission check`)
      return null
    }

    if (source === 'agent') {
      // Agent tools: delegate to AgentToolManager for pre-check
      if (!this.agentToolManager) {
        return null
      }

      let args: Record<string, unknown> = {}
      const argsString = request.function.arguments || ''
      if (argsString.trim().length > 0) {
        try {
          args = JSON.parse(argsString) as Record<string, unknown>
        } catch (error) {
          console.warn(
            '[ToolPresenter] Failed to parse tool arguments for pre-check, trying jsonrepair:',
            error
          )
          try {
            args = JSON.parse(jsonrepair(argsString)) as Record<string, unknown>
          } catch (error) {
            console.warn(
              '[ToolPresenter] Failed to repair tool arguments for pre-check, using empty args.',
              error
            )
            args = {}
          }
        }
      }

      const result = await this.agentToolManager.preCheckToolPermission(
        toolName,
        args,
        request.conversationId
      )
      if (!result) {
        return null
      }
      return result
    }

    // Route to MCP for permission pre-check
    if (this.options.mcpPresenter.preCheckToolPermission) {
      return await this.options.mcpPresenter.preCheckToolPermission(request)
    }

    // If MCP presenter doesn't support preCheckToolPermission, skip it
    return null
  }

  private resolveAgentToolResponse(response: AgentToolCallResult | string): AgentToolCallResult {
    if (typeof response === 'string') {
      return { content: response }
    }
    return response
  }

  buildToolSystemPrompt(context: {
    conversationId?: string
    toolDefinitions?: MCPToolDefinition[]
  }): string {
    const conversationId = context.conversationId || '<conversationId>'
    const offloadPath =
      resolveToolOffloadTemplatePath(conversationId) ??
      '~/.deepchat/sessions/<conversationId>/tool_<toolCallId>.offload'
    const toolDefinitions =
      context.toolDefinitions?.filter((tool) => tool.source === 'agent') ?? this.getFallbackTools()
    const toolNames = new Set(toolDefinitions.map((tool) => tool.function.name))
    const groupedTools = new Map<string, MCPToolDefinition[]>()

    for (const tool of toolDefinitions) {
      const existing = groupedTools.get(tool.server.name) ?? []
      existing.push(tool)
      groupedTools.set(tool.server.name, existing)
    }

    const sections = [
      this.buildFilesystemPrompt(toolNames, offloadPath),
      this.buildQuestionPrompt(toolNames),
      this.buildSkillsPrompt(toolNames),
      this.buildSettingsPrompt(groupedTools.get('deepchat-settings') ?? []),
      this.buildYoBrowserPrompt(groupedTools.get('yobrowser') ?? [])
    ]

    return sections.filter(Boolean).join('\n\n')
  }

  private getFallbackTools(): MCPToolDefinition[] {
    return FILESYSTEM_TOOL_ORDER.map((name) => ({
      type: 'function' as const,
      source: 'agent' as const,
      function: {
        name,
        description: '',
        parameters: { type: 'object', properties: {} }
      },
      server: {
        name: 'agent-filesystem',
        icons: '',
        description: ''
      }
    })).concat([
      {
        type: 'function' as const,
        source: 'agent' as const,
        function: {
          name: QUESTION_TOOL_NAME,
          description: '',
          parameters: { type: 'object', properties: {} }
        },
        server: {
          name: 'agent-core',
          icons: '',
          description: ''
        }
      }
    ])
  }

  private buildFilesystemPrompt(toolNames: Set<string>, offloadPath: string): string {
    const filesystemTools = FILESYSTEM_TOOL_ORDER.filter((toolName) => toolNames.has(toolName))
    if (filesystemTools.length === 0) {
      return ''
    }

    const lines = [
      '## File and Command Tools',
      `Use canonical Agent tool names only: ${filesystemTools.join(', ')}.`,
      'Legacy or disabled Agent tool names are not available.'
    ]

    if (toolNames.has('exec')) {
      lines.push(
        'Use `exec` for file discovery, content search, git, build, test, lint, package manager, and other CLI workflows.'
      )
      lines.push(
        'Prefer shell patterns like `rg -n`, `rg --files`, `find . -name ...`, `ls`, and `tree` inside `exec`.'
      )
      lines.push(
        'Use `background: true` when you know a command should detach immediately; otherwise a foreground `exec` may yield a running `sessionId` after `yieldMs`.'
      )
    }
    if (toolNames.has('read')) {
      lines.push(
        'When `read` targets an image file, it returns an English description of the visible content and any legible text.'
      )
    }
    if (toolNames.has('exec') && toolNames.has('read') && toolNames.has('edit')) {
      lines.push(
        'Recommended file task flow: `exec` for discovery/search -> `read` -> `edit`/`write`.'
      )
    }
    if (toolNames.has('process')) {
      lines.push(
        'Use `process` to monitor, write to, or terminate long-running `exec` tasks that returned a running `sessionId`.'
      )
    }

    const hasOffloadTools = Array.from(toolNames).some((toolName) =>
      OFFLOAD_TOOL_NAMES.has(toolName)
    )
    if (hasOffloadTools) {
      lines.push('Tool outputs may be offloaded when large.')
      lines.push(`When you see an offload stub, the full output is stored at: ${offloadPath}`)
      if (toolNames.has('read')) {
        lines.push('Use `read` to inspect that path when you need the full output.')
      }
    }

    return lines.join('\n')
  }

  private buildQuestionPrompt(toolNames: Set<string>): string {
    if (!toolNames.has(QUESTION_TOOL_NAME)) {
      return ''
    }

    return [
      '## User Interaction',
      `Use \`${QUESTION_TOOL_NAME}\` when missing user preferences, implementation direction, output shape, or risk decisions would materially change the result.`,
      'If the answer would meaningfully change the work, prefer asking instead of guessing.',
      'Do not ask for facts you can discover from the repo, tools, or existing conversation context.',
      `Ask exactly one question per \`${QUESTION_TOOL_NAME}\` call. If multiple clarifications are needed, split them into multiple tool calls.`,
      'Use only the existing fields `header`, `question`, `options`, `multiple`, and `custom`.',
      'Do not send `questions`, `allowOther`, or stringified `options` JSON.'
    ].join('\n')
  }

  private buildSkillsPrompt(toolNames: Set<string>): string {
    const lines = ['## Skill Tools']
    let hasContent = false

    if (toolNames.has('skill_list')) {
      lines.push('- Use `skill_list` to inspect installed skills and pinned status.')
      hasContent = true
    }
    if (toolNames.has('skill_view')) {
      lines.push(
        '- Use `skill_view` to inspect a skill or one of its linked files before relying on it.'
      )
      hasContent = true
    }
    if (toolNames.has('skill_manage')) {
      lines.push(
        '- Use `skill_manage` only for temporary draft skills after the main task is complete.'
      )
      hasContent = true
    }
    if (toolNames.has('skill_run')) {
      lines.push('- Use `skill_run` to execute bundled scripts from pinned skills.')
      hasContent = true
    }

    return hasContent ? lines.join('\n') : ''
  }

  private buildSettingsPrompt(tools: MCPToolDefinition[]): string {
    if (tools.length === 0) {
      return ''
    }

    const names = tools.map((tool) => `\`${tool.function.name}\``).join(', ')
    return [
      '## DeepChat Settings Tools',
      `DeepChat settings tools are available in this session: ${names}.`,
      'Prefer these tools over describing manual settings steps when a direct change is possible.'
    ].join('\n')
  }

  private buildYoBrowserPrompt(tools: MCPToolDefinition[]): string {
    if (tools.length === 0) {
      return ''
    }

    const toolNames = new Set(tools.map((tool) => tool.function.name))
    const lines = [
      '## YoBrowser Tools',
      `Available YoBrowser tools: ${tools.map((tool) => `\`${tool.function.name}\``).join(', ')}.`
    ]

    if (toolNames.has('get_browser_status')) {
      lines.push('- Use `get_browser_status` to inspect the current session browser state.')
    }
    if (toolNames.has('load_url')) {
      lines.push('- Prefer `load_url` to create the session browser and handle navigation.')
    }
    if (toolNames.has('cdp_send')) {
      lines.push(
        '- Use `cdp_send` for DOM inspection, scripted interaction, screenshots, and low-level CDP commands.'
      )
      lines.push('- Avoid using `cdp_send` `Page.navigate` for normal navigation unless needed.')
    }

    return lines.join('\n')
  }
}
