/**
 * ACP Session Manager - 纯内存版本
 *
 * 核心原则：
 * 1. 零持久化：Session 状态只在内存中维护
 * 2. Workdir 不可变：Session 创建后 workdir 不可更改
 * 3. 生命周期管理：Session 与进程生命周期一致
 * 4. 不依赖 conversationId：Session 独立于 DeepChat Conversation
 */

import { app } from 'electron'
import type { AcpAgentConfig } from '@shared/presenter'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import type { AcpSessionRecord, AcpSessionInfo } from '../types'
import type { AcpProcessManager } from './processManager'
import { nanoid } from 'nanoid'
import { eventBus, SendTarget } from '@/eventbus'
import { ACP_EVENTS } from '../events'
import { normalizeAndEmit } from '../normalizer'
import type { AgenticEventEmitter } from '@shared/types/presenters/agentic.presenter.d'

interface AcpSessionManagerOptions {
  processManager: AcpProcessManager
  getEmitter?: (sessionId: string) => AgenticEventEmitter | undefined
}

interface SessionHooks {
  onSessionUpdate: (notification: schema.SessionNotification) => void
  onPermission: (
    request: schema.RequestPermissionRequest
  ) => Promise<schema.RequestPermissionResponse>
}

/**
 * ACP Session Manager
 *
 * 管理 ACP Session 的生命周期，所有状态只在内存中维护
 */
export class AcpSessionManager {
  private readonly processManager: AcpProcessManager
  private readonly getEmitter?: (sessionId: string) => AgenticEventEmitter | undefined
  private readonly sessions = new Map<string, AcpSessionRecord>()
  private readonly pendingSessions = new Map<string, Promise<AcpSessionRecord>>()

  constructor(options: AcpSessionManagerOptions) {
    this.processManager = options.processManager
    this.getEmitter = options.getEmitter

    // 应用退出时清理所有 Session
    app.on('before-quit', () => {
      void this.clearAllSessions()
    })
  }

  /**
   * 创建新的 Session
   *
   * @param agentId Agent ID
   * @param workdir 工作目录（不可变）
   * @param hooks Session 事件钩子
   * @returns Session 记录
   */
  async createSession(
    agentId: string,
    workdir: string,
    hooks: SessionHooks
  ): Promise<AcpSessionRecord> {
    const sessionKey = `${agentId}::${workdir}::${nanoid()}`

    // 检查是否有正在创建的 Session
    const inflight = this.pendingSessions.get(sessionKey)
    if (inflight) {
      return inflight
    }

    const createPromise = this._createSessionInternal(agentId, workdir, hooks)
    this.pendingSessions.set(sessionKey, createPromise)

    try {
      const session = await createPromise
      this.sessions.set(session.sessionId, session)

      // 发送 Session 创建事件
      const emitter = this.getEmitter?.(session.sessionId)
      const payload = {
        sessionId: session.sessionId,
        agentId: session.agentId,
        workdir: session.workdir
      }
      if (emitter) {
        normalizeAndEmit(
          ACP_EVENTS.SESSION_CREATED as keyof typeof ACP_EVENTS,
          payload,
          session.sessionId,
          emitter
        )
      } else {
        eventBus.sendToRenderer(ACP_EVENTS.SESSION_CREATED, SendTarget.ALL_WINDOWS, payload)
      }

      return session
    } finally {
      this.pendingSessions.delete(sessionKey)
    }
  }

  /**
   * 加载已存在的 Session
   *
   * @param agentId Agent ID
   * @param sessionId Session ID（由 Agent 生成）
   * @param workdir 工作目录
   * @param hooks Session 事件钩子
   * @returns Session 记录
   */
  async loadSession(
    agentId: string,
    sessionId: string,
    workdir: string,
    hooks: SessionHooks
  ): Promise<AcpSessionRecord> {
    // 检查是否已经在内存中
    const existing = this.sessions.get(sessionId)
    if (existing) {
      // 更新 hooks
      this._updateSessionHooks(existing, hooks)
      return existing
    }

    // 尝试从 Agent 加载 Session
    try {
      const session = await this._loadSessionInternal(agentId, sessionId, workdir, hooks)
      this.sessions.set(session.sessionId, session)

      // 发送 Session 加载事件
      const emitter = this.getEmitter?.(session.sessionId)
      const payload = {
        sessionId: session.sessionId,
        agentId: session.agentId,
        workdir: session.workdir
      }
      if (emitter) {
        normalizeAndEmit(
          ACP_EVENTS.SESSION_LOADED as keyof typeof ACP_EVENTS,
          payload,
          session.sessionId,
          emitter
        )
      } else {
        eventBus.sendToRenderer(ACP_EVENTS.SESSION_LOADED, SendTarget.ALL_WINDOWS, payload)
      }

      return session
    } catch (error) {
      console.warn(`[ACP] Failed to load session ${sessionId}, will create new session:`, error)

      // 加载失败，创建新 Session
      return this.createSession(agentId, workdir, hooks)
    }
  }

  /**
   * 获取 Session 信息（Plain Object，可通过 IPC 传递）
   */
  getSessionInfo(sessionId: string): AcpSessionInfo | null {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return null
    }

    // 返回 Plain Object，不包含 connection
    return {
      sessionId: session.sessionId,
      agentId: session.agentId,
      workdir: session.workdir,
      status: session.status,
      createdAt: session.createdAt,
      availableModes: session.availableModes,
      currentModeId: session.currentModeId,
      availableModels: session.availableModels,
      currentModelId: session.currentModelId,
      availableCommands: session.availableCommands
    }
  }

  /**
   * 获取 Session 记录（内部使用，包含 connection）
   */
  getSession(sessionId: string): AcpSessionRecord | null {
    return this.sessions.get(sessionId) ?? null
  }

  /**
   * 列出所有活跃的 Session（返回 Plain Object）
   */
  listSessions(): AcpSessionInfo[] {
    return Array.from(this.sessions.values()).map((session) => ({
      sessionId: session.sessionId,
      agentId: session.agentId,
      workdir: session.workdir,
      status: session.status,
      createdAt: session.createdAt,
      availableModes: session.availableModes,
      currentModeId: session.currentModeId,
      availableModels: session.availableModels,
      currentModelId: session.currentModelId,
      availableCommands: session.availableCommands
    }))
  }

  /**
   * 关闭 Session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.delete(sessionId)

    // 清理事件监听器
    session.detachHandlers.forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        console.warn('[ACP] Failed to dispose session handler:', error)
      }
    })

    // 取消 Session
    try {
      await session.connection.cancel({ sessionId: session.sessionId })
    } catch (error) {
      console.warn(`[ACP] Failed to cancel session ${session.sessionId}:`, error)
    }

    // 发送 Session 关闭事件
    const emitter = this.getEmitter?.(session.sessionId)
    const payload = {
      sessionId: session.sessionId
    }
    if (emitter) {
      normalizeAndEmit(
        ACP_EVENTS.SESSION_CLOSED as keyof typeof ACP_EVENTS,
        payload,
        session.sessionId,
        emitter
      )
    } else {
      eventBus.sendToRenderer(ACP_EVENTS.SESSION_CLOSED, SendTarget.ALL_WINDOWS, payload)
    }
  }

  /**
   * 清理指定 Agent 的所有 Session
   */
  async clearSessionsByAgent(agentId: string): Promise<void> {
    const targets = Array.from(this.sessions.values()).filter(
      (session) => session.agentId === agentId
    )
    await Promise.allSettled(targets.map((session) => this.closeSession(session.sessionId)))
  }

  /**
   * 清理所有 Session
   */
  async clearAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys())
    await Promise.allSettled(sessionIds.map((sessionId) => this.closeSession(sessionId)))
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 内部创建 Session 逻辑
   */
  private async _createSessionInternal(
    agentId: string,
    workdir: string,
    hooks: SessionHooks
  ): Promise<AcpSessionRecord> {
    // 获取或创建进程
    const processHandle = await this.processManager.getConnection(
      { id: agentId } as AcpAgentConfig,
      workdir
    )

    // 注册 Session 的 workdir
    this.processManager.registerSessionWorkdir(nanoid(), workdir)

    // 创建 Session
    // TODO: Implement createSession when ACP SDK supports it
    const createResult = { sessionId: nanoid() }
    // const createResult = await processHandle.connection.createSession({ workdir })

    const sessionId = createResult.sessionId

    // 注册事件监听器
    const detachHandlers = this._attachSessionHooks(agentId, sessionId, hooks)

    // 创建 Session 记录
    const session: AcpSessionRecord = {
      sessionId,
      agentId,
      workdir,
      status: 'active',
      createdAt: Date.now(),
      connection: processHandle.connection,
      processId: agentId, // 简化：使用 agentId 作为 processId
      detachHandlers,
      availableModes: processHandle.availableModes,
      currentModeId: processHandle.currentModeId,
      availableModels: processHandle.availableModels,
      currentModelId: processHandle.currentModelId
    }

    return session
  }

  /**
   * 内部加载 Session 逻辑
   */
  private async _loadSessionInternal(
    agentId: string,
    sessionId: string,
    workdir: string,
    hooks: SessionHooks
  ): Promise<AcpSessionRecord> {
    // 获取或创建进程
    const processHandle = await this.processManager.getConnection(
      { id: agentId } as AcpAgentConfig,
      workdir
    )

    // 尝试加载 Session
    // 注意：ACP SDK 可能没有 loadSession 方法，这里假设 Agent 会自动恢复 Session
    // 如果 Agent 不支持，会抛出错误，调用方会回退到创建新 Session

    // 注册事件监听器
    const detachHandlers = this._attachSessionHooks(agentId, sessionId, hooks)

    // 创建 Session 记录
    const session: AcpSessionRecord = {
      sessionId,
      agentId,
      workdir,
      status: 'active',
      createdAt: Date.now(),
      connection: processHandle.connection,
      processId: agentId,
      detachHandlers,
      availableModes: processHandle.availableModes,
      currentModeId: processHandle.currentModeId,
      availableModels: processHandle.availableModels,
      currentModelId: processHandle.currentModelId
    }

    return session
  }

  /**
   * 附加 Session 事件钩子
   */
  private _attachSessionHooks(
    _agentId: string,
    _sessionId: string,
    _hooks: SessionHooks
  ): Array<() => void> {
    const detachHandlers: Array<() => void> = []

    // TODO: Implement event listeners when ProcessManager supports them
    // const detachUpdate = this.processManager.onSessionUpdate(agentId, (notification) => {
    //   if (notification.sessionId === sessionId) {
    //     hooks.onSessionUpdate(notification)
    //   }
    // })
    // detachHandlers.push(detachUpdate)

    // const detachPermission = this.processManager.onPermissionRequest(agentId, async (request) => {
    //   return hooks.onPermission(request)
    // })
    // detachHandlers.push(detachPermission)

    return detachHandlers
  }

  /**
   * 更新 Session 的事件钩子
   */
  private _updateSessionHooks(session: AcpSessionRecord, hooks: SessionHooks): void {
    // 清理旧的监听器
    session.detachHandlers.forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        console.warn('[ACP] Failed to dispose old session handler:', error)
      }
    })

    // 注册新的监听器
    session.detachHandlers = this._attachSessionHooks(session.agentId, session.sessionId, hooks)
  }
}
