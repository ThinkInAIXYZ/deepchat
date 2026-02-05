/**
 * ACP Presenter - 独立的 ACP 服务层
 *
 * 核心原则：
 * 1. 不依赖 LLM Provider 体系
 * 2. 零持久化（Session 状态只在内存中）
 * 3. 职责清晰（只负责 UI 展示和进程管理）
 * 4. 协议正确性（严格遵循 ACP 协议）
 */

import type {
  AcpSessionInfo,
  AcpPromptInput,
  AcpPermissionResponse,
  AcpSessionUpdatePayload,
  AcpPermissionRequestPayload
} from './types'
import type { AcpAgentConfig } from '@shared/presenter'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import { eventBus, SendTarget } from '@/eventbus'
import { ACP_EVENTS } from './events'
import { presenter } from '@/presenter'
import { AcpProcessManager } from './managers/processManager'
import { AcpSessionManager } from './managers/sessionManager'
import { AcpInputFormatter } from './formatters/inputFormatter'
import { acpCleanupHook } from './hooks/lifecycleHook'
import { nanoid } from 'nanoid'
import type {
  IAgentPresenter as IAgenticAgentPresenter,
  SessionInfo,
  MessageContent,
  SessionConfig,
  LoadContext,
  AgenticEventEmitter
} from '../agenticPresenter/types'
import { agenticPresenter } from '../agenticPresenter'
import { normalizeAndEmit } from './normalizer'

// ============================================================================
// ACP Agent Presenter Wrapper (for Agentic Unified Layer)
// ============================================================================

/**
 * AcpAgentPresenter - Wrapper for individual ACP agents
 * Each ACP agent (e.g., 'acp.anthropic.claude-code') gets its own wrapper
 * that implements IAgenticPresenter and registers with AgenticPresenter
 */
class AcpAgentPresenter implements IAgenticAgentPresenter {
  readonly agentId: string
  private acpPresenter: AcpPresenter

  constructor(agentId: string, acpPresenter: AcpPresenter) {
    this.agentId = agentId
    this.acpPresenter = acpPresenter
  }

  /**
   * Set the emitter provider callback (called by AgenticPresenter during registration)
   * @param provider - The provider callback function
   */
  setEmitterProvider(provider: (sessionId: string) => AgenticEventEmitter | undefined): void {
    // Propagate to AcpPresenter since that's where getEmitter is called
    this.acpPresenter.setEmitterProvider(provider)
  }

  async createSession(config: SessionConfig): Promise<string> {
    // Extract workdir from config or use current working directory as default
    // ACP agents require a working directory for their operations
    const workdir = (config as any).workdir || process.cwd()
    const sessionInfo = await this.acpPresenter.createSession(this.agentId, workdir)
    return sessionInfo.sessionId
  }

  getSession(sessionId: string): SessionInfo | null {
    const acpSessionInfo = this.acpPresenter.getSessionInfo(sessionId)
    if (!acpSessionInfo) {
      return null
    }

    // Map ACP status to agentic status
    const statusMap: Record<string, 'idle' | 'generating' | 'paused' | 'error'> = {
      idle: 'idle',
      active: 'generating',
      error: 'error'
    }

    return {
      sessionId: acpSessionInfo.sessionId,
      agentId: this.agentId,
      status: statusMap[acpSessionInfo.status] || 'idle',
      availableModes: acpSessionInfo.availableModes,
      availableModels: acpSessionInfo.availableModels,
      currentModeId: acpSessionInfo.currentModeId,
      currentModelId: acpSessionInfo.currentModelId,
      capabilities: {
        supportsVision: false,
        supportsTools: true,
        supportsModes: true
      }
    }
  }

  async loadSession(sessionId: string, context: LoadContext): Promise<void> {
    // Extract workdir from context or use current working directory as default
    // ACP agents require a working directory for their operations
    const workdir = (context as any).workdir || process.cwd()
    await this.acpPresenter.loadSession(this.agentId, sessionId, workdir)
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.acpPresenter.closeSession(sessionId)
  }

  async sendMessage(sessionId: string, content: MessageContent): Promise<void> {
    const input: AcpPromptInput = {
      text: content.text,
      images: content.images?.map((img) => ({
        type: img.type as 'url' | 'base64' | 'file',
        data: img.data
      })),
      files: content.files?.map((file) => ({
        path: file.path,
        name: file.name
      }))
    }
    await this.acpPresenter.sendPrompt(sessionId, input)
  }

  async cancelMessage(sessionId: string, _messageId: string): Promise<void> {
    await this.acpPresenter.cancelPrompt(sessionId)
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.acpPresenter.setSessionModel(sessionId, modelId)
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.acpPresenter.setSessionMode(sessionId, modeId)
  }
}

/**
 * ACP Presenter 接口
 */
export interface IAcpPresenter {
  // 初始化
  initialize(): Promise<void>

  // Agent 管理
  getAgents(): Promise<AcpAgentConfig[]>
  getAgentById(agentId: string): Promise<AcpAgentConfig | null>

  // Session 管理（核心）
  createSession(agentId: string, workdir: string): Promise<AcpSessionInfo>
  loadSession(agentId: string, sessionId: string, workdir: string): Promise<AcpSessionInfo>
  getSessionInfo(sessionId: string): AcpSessionInfo | null
  closeSession(sessionId: string): Promise<void>
  listSessions(): AcpSessionInfo[]

  // 消息发送（支持多模态）
  sendPrompt(sessionId: string, input: AcpPromptInput): Promise<void>
  cancelPrompt(sessionId: string): Promise<void>

  // Mode/Model 管理
  setSessionMode(sessionId: string, modeId: string): Promise<void>
  setSessionModel(sessionId: string, modelId: string): Promise<void>

  // 权限处理
  resolvePermission(response: AcpPermissionResponse): Promise<void>

  // 进程管理
  warmupProcess(agentId: string, workdir: string): Promise<void>
  releaseProcess(agentId: string, workdir: string): Promise<void>

  // 生命周期
  shutdown(): Promise<void>
}

/**
 * ACP Presenter 实现
 */
export class AcpPresenter implements IAcpPresenter {
  private initialized = false
  private processManager!: AcpProcessManager
  private sessionManager!: AcpSessionManager
  private inputFormatter!: AcpInputFormatter
  private pendingPermissions = new Map<
    string,
    {
      resolve: (response: schema.RequestPermissionResponse) => void
      reject: (error: Error) => void
    }
  >()

  // Track sessionId → agentId mapping for Agentic Unified Layer
  private sessionToAgentId = new Map<string, string>()

  // Track registered ACP agent presenters
  private registeredAgentPresenters = new Map<string, IAgenticAgentPresenter>()

  // Emitter provider callback (injected by AgenticPresenter during registration)
  private emitterProvider: (sessionId: string) => AgenticEventEmitter | undefined = () => undefined

  constructor() {
    // 延迟初始化，等待其他 Presenter 就绪
  }

  /**
   * 初始化 ACP Presenter
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    console.info('[ACP] Initializing ACP Presenter...')

    // 初始化 ProcessManager
    this.processManager = new AcpProcessManager({
      providerId: 'acp',
      getUseBuiltinRuntime: async () => presenter.configPresenter.getAcpUseBuiltinRuntime(),
      getNpmRegistry: async () => presenter.mcpPresenter.getNpmRegistry?.() ?? null,
      getUvRegistry: async () => presenter.mcpPresenter.getUvRegistry?.() ?? null
    })

    // 初始化 SessionManager
    this.sessionManager = new AcpSessionManager({
      processManager: this.processManager,
      getEmitter: (sessionId: string) => this.getEmitter(sessionId)
    })

    // 初始化 InputFormatter
    this.inputFormatter = new AcpInputFormatter()

    // 注册生命周期钩子
    presenter.lifecycleManager.registerHook(acpCleanupHook)

    // 注册 ACP Presenter 关闭钩子
    presenter.lifecycleManager.registerHook({
      name: 'acp-presenter-shutdown',
      phase: 'beforeQuit' as any,
      priority: 101,
      critical: false,
      execute: async () => {
        await this.shutdown()
      }
    })

    this.initialized = true
    console.info('[ACP] ACP Presenter initialized successfully')

    // Agentic Unified Layer - Register all ACP agents
    await this.registerAgenticAgents()
  }

  // ============================================================================
  // Agent 管理
  // ============================================================================

  async getAgents(): Promise<AcpAgentConfig[]> {
    return presenter.configPresenter.getAcpAgents()
  }

  async getAgentById(agentId: string): Promise<AcpAgentConfig | null> {
    const agents = await this.getAgents()
    return agents.find((agent) => agent.id === agentId) ?? null
  }

  // ============================================================================
  // Session 管理
  // ============================================================================

  async createSession(agentId: string, workdir: string): Promise<AcpSessionInfo> {
    this.ensureInitialized()

    const agent = await this.getAgentById(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    // 创建 Session 钩子
    const hooks = {
      onSessionUpdate: (notification: schema.SessionNotification) => {
        this.handleSessionUpdate(notification)
      },
      onPermission: async (request: schema.RequestPermissionRequest) => {
        return this.handlePermissionRequest(agentId, request)
      }
    }

    const session = await this.sessionManager.createSession(nanoid(), agent, hooks, workdir)

    // Track sessionId → agentId mapping for Agentic Unified Layer
    this.sessionToAgentId.set(session.sessionId, agentId)

    return this.sessionManager.getSessionInfo(session.sessionId)!
  }

  async loadSession(agentId: string, sessionId: string, workdir: string): Promise<AcpSessionInfo> {
    this.ensureInitialized()

    const agent = await this.getAgentById(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    // 创建 Session 钩子
    const hooks = {
      onSessionUpdate: (notification: schema.SessionNotification) => {
        this.handleSessionUpdate(notification)
      },
      onPermission: async (request: schema.RequestPermissionRequest) => {
        return this.handlePermissionRequest(agentId, request)
      }
    }

    const session = await this.sessionManager.loadSession(
      sessionId,
      agent,
      sessionId,
      hooks,
      workdir
    )

    // Track sessionId → agentId mapping for Agentic Unified Layer
    this.sessionToAgentId.set(session.sessionId, agentId)

    return this.sessionManager.getSessionInfo(session.sessionId)!
  }

  getSessionInfo(sessionId: string): AcpSessionInfo | null {
    this.ensureInitialized()
    return this.sessionManager.getSessionInfo(sessionId)
  }

  async closeSession(sessionId: string): Promise<void> {
    this.ensureInitialized()
    await this.sessionManager.closeSession(sessionId)

    // Clean up sessionId → agentId mapping
    this.sessionToAgentId.delete(sessionId)
  }

  listSessions(): AcpSessionInfo[] {
    this.ensureInitialized()
    return this.sessionManager.listSessions()
  }

  // ============================================================================
  // 消息发送
  // ============================================================================

  async sendPrompt(sessionId: string, input: AcpPromptInput): Promise<void> {
    this.ensureInitialized()

    const session = this.sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // 验证输入
    const validation = this.inputFormatter.validate(input)
    if (!validation.valid) {
      throw new Error(`Invalid input: ${validation.error}`)
    }

    // 格式化输入为 ContentBlock[]（只处理当前输入，不涉及历史）
    const contentBlocks = this.inputFormatter.format(input)

    console.info(`[ACP] Sending prompt to session ${sessionId}, blocks: ${contentBlocks.length}`)

    // 发送 Prompt 开始事件
    this.sendEvent(ACP_EVENTS.PROMPT_STARTED, SendTarget.ALL_WINDOWS, {
      sessionId
    })

    try {
      // 调用 ACP SDK 发送消息
      await session.connection.prompt({
        sessionId: session.sessionId,
        prompt: contentBlocks
      })

      // 发送 Prompt 完成事件
      this.sendEvent(ACP_EVENTS.PROMPT_COMPLETED, SendTarget.ALL_WINDOWS, {
        sessionId
      })
    } catch (error) {
      console.error(`[ACP] Failed to send prompt to session ${sessionId}:`, error)

      // 发送错误事件
      this.sendEvent(ACP_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  async cancelPrompt(sessionId: string): Promise<void> {
    this.ensureInitialized()

    const session = this.sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    await session.connection.cancel({ sessionId: session.sessionId })

    this.sendEvent(ACP_EVENTS.PROMPT_CANCELLED, SendTarget.ALL_WINDOWS, {
      sessionId
    })
  }

  // ============================================================================
  // Mode/Model 管理
  // ============================================================================

  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    this.ensureInitialized()

    const session = this.sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // TODO: Implement setMode when ACP SDK supports it
    // await session.connection.setMode({ sessionId: session.sessionId, modeId })

    this.sendEvent(ACP_EVENTS.MODE_CHANGED, SendTarget.ALL_WINDOWS, {
      sessionId,
      modeId
    })
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    this.ensureInitialized()

    const session = this.sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // TODO: Implement setModel when ACP SDK supports it
    // await session.connection.setModel({ sessionId: session.sessionId, modelId })

    this.sendEvent(ACP_EVENTS.MODEL_CHANGED, SendTarget.ALL_WINDOWS, {
      sessionId,
      modelId
    })
  }

  // ============================================================================
  // 权限处理
  // ============================================================================

  async resolvePermission(response: AcpPermissionResponse): Promise<void> {
    this.ensureInitialized()

    const pending = this.pendingPermissions.get(response.requestId)
    if (!pending) {
      console.warn(`[ACP] Permission request not found: ${response.requestId}`)
      return
    }

    this.pendingPermissions.delete(response.requestId)

    const permissionResponse: schema.RequestPermissionResponse = {
      selectedOptionId: response.selectedOptionId || (response.granted ? 'allow' : 'deny')
    } as any

    pending.resolve(permissionResponse)

    this.sendEvent(ACP_EVENTS.PERMISSION_RESOLVED, SendTarget.ALL_WINDOWS, {
      requestId: response.requestId,
      granted: response.granted
    })
  }

  // ============================================================================
  // 进程管理
  // ============================================================================

  async warmupProcess(agentId: string, workdir: string): Promise<void> {
    this.ensureInitialized()

    const agent = await this.getAgentById(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    await this.processManager.warmupProcess(agent, workdir)
  }

  async releaseProcess(agentId: string, _workdir: string): Promise<void> {
    this.ensureInitialized()

    await this.processManager.release(agentId)
  }

  // ============================================================================
  // 生命周期
  // ============================================================================

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return
    }

    console.info('[ACP] Shutting down ACP Presenter...')

    // 清理所有 Session
    await this.sessionManager.clearAllSessions()

    // 关闭所有进程
    await this.processManager.shutdown()

    this.initialized = false
    console.info('[ACP] ACP Presenter shut down successfully')
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[ACP] ACP Presenter not initialized. Call initialize() first.')
    }
  }

  private sendEvent(event: string, target: SendTarget, payload: unknown): void {
    // Try to use emitter for ACP_EVENTS when sessionId is available
    if (event.startsWith('acp:') && payload && typeof payload === 'object') {
      const data = payload as Record<string, unknown>
      const sessionId = data.sessionId as string
      if (sessionId) {
        const emitter = this.getEmitter(sessionId)
        if (emitter) {
          normalizeAndEmit(event as keyof typeof ACP_EVENTS, payload, sessionId, emitter)
          return
        }
      }
    }
    // Fallback to direct eventBus call
    eventBus.sendToRenderer(event, target, payload)
  }

  /**
   * 处理 Session 更新通知
   */
  private handleSessionUpdate(notification: schema.SessionNotification): void {
    const payload: AcpSessionUpdatePayload = {
      sessionId: notification.sessionId,
      notification
    }

    this.sendEvent(ACP_EVENTS.SESSION_UPDATE, SendTarget.ALL_WINDOWS, payload)
  }

  /**
   * 处理权限请求
   */
  private async handlePermissionRequest(
    agentId: string,
    request: schema.RequestPermissionRequest
  ): Promise<schema.RequestPermissionResponse> {
    const requestId = nanoid()

    // 发送权限请求事件到 UI
    const payload: AcpPermissionRequestPayload = {
      requestId,
      sessionId: '', // TODO: 从 request 中获取 sessionId
      agentId,
      title: (request as any).title,
      description: (request as any).description,
      options: request.options.map((opt: any) => ({
        optionId: opt.optionId,
        label: opt.label,
        kind: opt.kind,
        description: opt.description
      }))
    }

    this.sendEvent(ACP_EVENTS.PERMISSION_REQUEST, SendTarget.ALL_WINDOWS, payload)

    // 等待 UI 响应
    return new Promise((resolve, reject) => {
      this.pendingPermissions.set(requestId, { resolve, reject })

      // 设置超时（10 分钟）
      setTimeout(
        () => {
          if (this.pendingPermissions.has(requestId)) {
            this.pendingPermissions.delete(requestId)
            reject(new Error('Permission request timeout'))
          }
        },
        10 * 60 * 1000
      )
    })
  }

  // ============================================================================
  // Agentic Unified Layer - Agent Registration
  // ============================================================================

  /**
   * Register all ACP agents with AgenticPresenter
   * Called during initialization to register each ACP agent config
   */
  async registerAgenticAgents(): Promise<void> {
    const agents = await this.getAgents()
    for (const agent of agents) {
      // Check if already registered
      if (this.registeredAgentPresenters.has(agent.id)) {
        continue
      }

      // Create wrapper for this ACP agent
      const wrapper = new AcpAgentPresenter(agent.id, this)
      this.registeredAgentPresenters.set(agent.id, wrapper)

      // Register with AgenticPresenter
      agenticPresenter.registerAgent(wrapper)
      console.info(`[ACP] Registered ACP agent with AgenticPresenter: ${agent.id}`)
    }
  }

  /**
   * Get a registered ACP agent presenter by agent ID
   */
  getRegisteredAgent(agentId: string): IAgenticAgentPresenter | undefined {
    return this.registeredAgentPresenters.get(agentId)
  }

  /**
   * Get or create an AgenticEventEmitter for a given session
   */
  getEmitter(sessionId: string): AgenticEventEmitter | undefined {
    return this.emitterProvider(sessionId)
  }

  /**
   * Set the emitter provider callback (called by AgenticPresenter during registration)
   * @param provider - The provider callback function
   */
  setEmitterProvider(provider: (sessionId: string) => AgenticEventEmitter | undefined): void {
    this.emitterProvider = provider
  }
}

// 导出单例
export const acpPresenter = new AcpPresenter()
