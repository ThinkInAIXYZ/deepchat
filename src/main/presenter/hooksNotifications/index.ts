import { app } from 'electron'
import log from 'electron-log'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { IConfigPresenter, ISessionPresenter } from '@shared/presenter'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import {
  HookCommandResult,
  HookEventName,
  HookEventPayload,
  HookTestResult,
  HooksNotificationsSettings
} from '@shared/hooksNotifications'

const HOOK_PAYLOAD_VERSION = 1 as const
const COMMAND_TIMEOUT_MS = 30_000
const PREVIEW_TEXT_LIMIT = 1200
const DIAGNOSTIC_TEXT_LIMIT = 2000
const TRUNCATION_SUFFIX = ' ...(truncated)'
const MAX_RETRIES = 2
const CONFIRMO_HOOK_RELATIVE_PATH = path.join('.confirmo', 'hooks', 'confirmo-hook.js')

type HookDispatchContext = {
  conversationId?: string
  messageId?: string
  promptPreview?: string
  providerId?: string
  modelId?: string
  agentId?: string | null
  workdir?: string | null
  tool?: {
    callId?: string
    name?: string
    params?: string
    response?: string
    error?: string
  }
  permission?: Record<string, unknown> | null
  stop?: {
    reason?: string
    userStop?: boolean
  } | null
  usage?: Record<string, number> | null
  error?: {
    message?: string
    stack?: string
  } | null
  isTest?: boolean
}

class SerialQueue {
  private chain: Promise<unknown> = Promise.resolve()

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task)
    this.chain = next.catch(() => {})
    return next
  }
}

export const truncateText = (value: string, limit: number): string => {
  if (!value || limit <= 0) return ''
  if (value.length <= limit) return value
  const suffix = TRUNCATION_SUFFIX
  const sliceLength = Math.max(0, limit - suffix.length)
  return value.slice(0, sliceLength) + suffix
}

export const parseRetryAfterMs = (response: Response, body?: unknown): number | undefined => {
  const header = response.headers.get('retry-after')
  if (header) {
    const parsed = Number(header)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed < 1000 ? Math.ceil(parsed * 1000) : Math.ceil(parsed)
    }
  }

  if (body && typeof body === 'object') {
    const retryAfter =
      typeof (body as { retry_after?: number }).retry_after === 'number'
        ? (body as { retry_after: number }).retry_after
        : typeof (body as { parameters?: { retry_after?: number } }).parameters?.retry_after ===
            'number'
          ? (body as { parameters: { retry_after: number } }).parameters.retry_after
          : undefined
    if (retryAfter && retryAfter > 0) {
      return retryAfter < 1000 ? Math.ceil(retryAfter * 1000) : Math.ceil(retryAfter)
    }
  }

  return undefined
}

const extractPromptPreview = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!content || typeof content !== 'object') return ''
  const candidate = content as {
    text?: string
    content?: Array<{ content?: string }>
  }
  if (typeof candidate.text === 'string') return candidate.text
  if (Array.isArray(candidate.content)) {
    return candidate.content.map((block) => block.content || '').join('')
  }
  return ''
}

const redactSensitiveText = (text: string, secrets: string[]): string => {
  if (!text) return ''
  let output = text
  for (const secret of secrets) {
    if (!secret) continue
    output = output.split(secret).join('***REDACTED***')
  }
  output = output.replace(
    /https?:\/\/(discord(?:app)?\.com)\/api\/webhooks\/\S+/gi,
    '***REDACTED***'
  )
  output = output.replace(/https?:\/\/api\.telegram\.org\/bot\S+/gi, '***REDACTED***')
  output = output.replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: ***REDACTED***')
  return output
}

export class HooksNotificationsService {
  private readonly runtimeHelper = RuntimeHelper.getInstance()
  private readonly telegramQueue = new SerialQueue()
  private readonly discordQueue = new SerialQueue()

  constructor(
    private readonly configPresenter: IConfigPresenter,
    private readonly deps: {
      sessionPresenter: ISessionPresenter
      resolveWorkspaceContext: (
        conversationId?: string,
        modelId?: string
      ) => Promise<{ agentWorkspacePath: string | null }>
    }
  ) {}

  getConfigSnapshot(): HooksNotificationsSettings {
    return this.configPresenter.getHooksNotificationsConfig()
  }

  dispatchEvent(event: HookEventName, context: HookDispatchContext): void {
    queueMicrotask(() => {
      this.dispatchEventAsync(event, context).catch((error) => {
        log.warn('[HooksNotifications] Dispatch failed:', error)
      })
    })
  }

  async testTelegram(): Promise<HookTestResult> {
    const payload = await this.buildPayload('SessionStart', {
      isTest: true,
      promptPreview: 'Test message'
    })
    return await this.sendTelegram(payload, true)
  }

  async testDiscord(): Promise<HookTestResult> {
    const payload = await this.buildPayload('SessionStart', {
      isTest: true,
      promptPreview: 'Test message'
    })
    return await this.sendDiscord(payload, true)
  }

  async testConfirmo(): Promise<HookTestResult> {
    const payload = await this.buildPayload('SessionStart', {
      isTest: true,
      promptPreview: 'Test message'
    })
    return await this.sendConfirmo(payload)
  }

  async testHookCommand(event: HookEventName): Promise<HookTestResult> {
    const payload = await this.buildPayload(event, {
      isTest: true,
      promptPreview: 'Test message'
    })
    const config = this.getConfigSnapshot()
    const commandConfig = config.commands.events[event]
    if (!commandConfig?.command?.trim()) {
      return {
        success: false,
        durationMs: 0,
        error: 'Command is not configured'
      }
    }
    const result = await this.executeHookCommand(commandConfig.command, payload)
    return {
      success: result.success,
      durationMs: result.durationMs,
      exitCode: result.exitCode ?? undefined,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error
    }
  }

  private async dispatchEventAsync(
    event: HookEventName,
    context: HookDispatchContext
  ): Promise<void> {
    const config = this.getConfigSnapshot()
    const payload = await this.buildPayload(event, context)

    if (config.commands.enabled) {
      const commandConfig = config.commands.events[event]
      if (commandConfig?.enabled && commandConfig.command?.trim()) {
        void this.executeHookCommand(commandConfig.command, payload).catch((error) => {
          log.warn('[HooksNotifications] Command hook failed:', error)
        })
      }
    }

    if (config.telegram.enabled && config.telegram.events.includes(event)) {
      void this.sendTelegram(payload, false).catch((error) => {
        log.warn('[HooksNotifications] Telegram hook failed:', error)
      })
    }

    if (config.discord.enabled && config.discord.events.includes(event)) {
      void this.sendDiscord(payload, false).catch((error) => {
        log.warn('[HooksNotifications] Discord hook failed:', error)
      })
    }

    if (config.confirmo.enabled && config.confirmo.events.includes(event)) {
      void this.sendConfirmo(payload).catch((error) => {
        log.warn('[HooksNotifications] Confirmo hook failed:', error)
      })
    }
  }

  getConfirmoHookStatus(): { available: boolean; path: string } {
    const hookPath = this.getConfirmoHookPath()
    return { available: this.isConfirmoHookAvailable(hookPath), path: hookPath }
  }

  private async buildPayload(
    event: HookEventName,
    context: HookDispatchContext
  ): Promise<HookEventPayload> {
    const now = new Date().toISOString()
    let conversationId = context.conversationId
    let providerId = context.providerId
    let modelId = context.modelId
    let agentId = context.agentId
    let workdir = context.workdir

    if (conversationId && (!providerId || !modelId)) {
      try {
        const conversation = await this.deps.sessionPresenter.getConversation(conversationId)
        providerId = providerId ?? conversation.settings.providerId
        modelId = modelId ?? conversation.settings.modelId
        if (!agentId && conversation.settings.providerId === 'acp') {
          agentId = conversation.settings.modelId
        }
      } catch (error) {
        log.warn('[HooksNotifications] Failed to load conversation info:', error)
      }
    }

    if (conversationId && !workdir) {
      try {
        const resolved = await this.deps.resolveWorkspaceContext(conversationId, modelId)
        workdir = resolved.agentWorkspacePath ?? null
      } catch (error) {
        log.warn('[HooksNotifications] Failed to resolve workdir:', error)
      }
    }

    let promptPreview = context.promptPreview
    if (!promptPreview && context.messageId) {
      try {
        const message = await this.deps.sessionPresenter.getMessage(context.messageId)
        promptPreview = extractPromptPreview(message.content)
      } catch (error) {
        log.warn('[HooksNotifications] Failed to read message for preview:', error)
      }
    }

    const hasUser = Boolean(promptPreview || context.messageId)
    const payload: HookEventPayload = {
      payloadVersion: HOOK_PAYLOAD_VERSION,
      event,
      time: now,
      isTest: Boolean(context.isTest),
      app: {
        version: app.getVersion(),
        platform: process.platform
      },
      session: {
        conversationId,
        agentId: agentId ?? null,
        workdir: workdir ?? null,
        providerId,
        modelId
      },
      user: hasUser
        ? {
            messageId: context.messageId,
            promptPreview: truncateText(promptPreview || '', PREVIEW_TEXT_LIMIT)
          }
        : null,
      tool: context.tool
        ? {
            callId: context.tool.callId,
            name: context.tool.name,
            paramsPreview: context.tool.params
              ? truncateText(context.tool.params, PREVIEW_TEXT_LIMIT)
              : undefined,
            responsePreview: context.tool.response
              ? truncateText(context.tool.response, PREVIEW_TEXT_LIMIT)
              : undefined,
            error: context.tool.error
              ? truncateText(context.tool.error, PREVIEW_TEXT_LIMIT)
              : undefined
          }
        : null,
      permission: context.permission ?? null,
      stop: context.stop ?? null,
      usage: context.usage ?? null,
      error: context.error ?? null
    }

    return payload
  }

  private escapeTelegramHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  private formatNotificationText(payload: HookEventPayload): string {
    const lines: string[] = []
    const title = `DeepChat${payload.isTest ? ' Test' : ''}`
    const pushLine = (label: string, value: string) => {
      lines.push(`<b>${this.escapeTelegramHtml(label)}</b>: ${this.escapeTelegramHtml(value)}`)
    }

    lines.push(`<b>${this.escapeTelegramHtml(title)}</b>`)
    pushLine('Event', payload.event)
    if (payload.tool?.name) {
      pushLine('Tool', payload.tool.name)
    }
    if (payload.stop?.reason) {
      pushLine('Stop', payload.stop.reason)
    }
    if (payload.error?.message) {
      pushLine('Error', truncateText(payload.error.message, 160))
    }
    pushLine('Time', payload.time)

    return lines.join('\n')
  }

  private resolveCommandCwd(workdir?: string | null): string {
    if (workdir && fs.existsSync(workdir)) {
      try {
        if (fs.statSync(workdir).isDirectory()) return workdir
      } catch {
        return process.cwd()
      }
    }
    return process.cwd()
  }

  private async executeHookCommand(
    command: string,
    payload: HookEventPayload,
    options?: { args?: string[]; shell?: boolean; stdinPayload?: unknown }
  ): Promise<HookCommandResult> {
    const start = Date.now()
    const cwd = this.resolveCommandCwd(payload.session.workdir)
    const env: Record<string, string> = {
      ...process.env,
      DEEPCHAT_HOOK_EVENT: payload.event,
      ...(payload.session.conversationId
        ? { DEEPCHAT_CONVERSATION_ID: payload.session.conversationId }
        : {}),
      ...(payload.session.workdir ? { DEEPCHAT_WORKDIR: payload.session.workdir } : {})
    }

    return await new Promise<HookCommandResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let finished = false
      let timedOut = false

      const child = spawn(command, options?.args ?? [], {
        shell: options?.shell ?? true,
        cwd,
        env,
        windowsHide: true
      })

      const finalize = (result: HookCommandResult) => {
        if (finished) return
        finished = true
        resolve(result)
      }

      const timeout = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, COMMAND_TIMEOUT_MS)

      child.on('error', (error) => {
        clearTimeout(timeout)
        finalize({
          success: false,
          durationMs: Date.now() - start,
          exitCode: null,
          stdout: truncateText(stdout, DIAGNOSTIC_TEXT_LIMIT),
          stderr: truncateText(stderr, DIAGNOSTIC_TEXT_LIMIT),
          error: error instanceof Error ? error.message : String(error)
        })
      })

      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.on('close', (code) => {
        clearTimeout(timeout)
        const secrets = [payload.session.conversationId ?? '', payload.session.workdir ?? '']
        const redactedStdout = redactSensitiveText(
          truncateText(stdout, DIAGNOSTIC_TEXT_LIMIT),
          secrets
        )
        const redactedStderr = redactSensitiveText(
          truncateText(stderr, DIAGNOSTIC_TEXT_LIMIT),
          secrets
        )
        finalize({
          success: !timedOut && code === 0,
          durationMs: Date.now() - start,
          exitCode: code ?? null,
          stdout: redactedStdout,
          stderr: redactedStderr,
          error: timedOut ? 'Command timed out' : code === 0 ? undefined : 'Command failed'
        })
      })

      try {
        const inputPayload = options?.stdinPayload ?? payload
        child.stdin?.write(JSON.stringify(inputPayload))
        child.stdin?.end()
      } catch (error) {
        clearTimeout(timeout)
        finalize({
          success: false,
          durationMs: Date.now() - start,
          exitCode: null,
          stdout: truncateText(stdout, DIAGNOSTIC_TEXT_LIMIT),
          stderr: truncateText(stderr, DIAGNOSTIC_TEXT_LIMIT),
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }

  private async sendTelegram(payload: HookEventPayload, isTest: boolean): Promise<HookTestResult> {
    const config = this.getConfigSnapshot().telegram
    const start = Date.now()
    if (!config.botToken || !config.chatId) {
      return { success: false, durationMs: 0, error: 'Missing Telegram config' }
    }

    const text = this.formatNotificationText(payload)
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`
    const body: Record<string, unknown> = {
      chat_id: config.chatId,
      text,
      parse_mode: 'HTML'
    }
    if (config.threadId) {
      const threadValue = Number(config.threadId)
      if (!Number.isNaN(threadValue)) {
        body.message_thread_id = threadValue
      }
    }

    const task = async (): Promise<HookTestResult> => {
      let lastError: string | undefined
      let statusCode: number | undefined
      let retryAfterMs: number | undefined

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000)
          })
          statusCode = response.status
          const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
          if (response.ok) {
            return { success: true, durationMs: Date.now() - start, statusCode }
          }
          if (response.status === 429) {
            retryAfterMs = parseRetryAfterMs(response, json)
            if (retryAfterMs && attempt < MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, retryAfterMs))
              continue
            }
          }
          lastError = JSON.stringify(json)
          break
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
          break
        }
      }

      return {
        success: false,
        durationMs: Date.now() - start,
        statusCode,
        retryAfterMs,
        error: lastError || 'Telegram request failed'
      }
    }

    const result = isTest ? await task() : await this.telegramQueue.enqueue(task)
    return result
  }

  private async sendDiscord(payload: HookEventPayload, isTest: boolean): Promise<HookTestResult> {
    const config = this.getConfigSnapshot().discord
    const start = Date.now()
    if (!config.webhookUrl) {
      return { success: false, durationMs: 0, error: 'Missing Discord webhookUrl' }
    }

    const embed = this.buildDiscordEmbed(payload)
    let url: URL
    try {
      url = new URL(config.webhookUrl)
    } catch {
      throw new Error('Invalid Discord webhook URL')
    }
    const body = {
      embeds: [embed],
      allowed_mentions: { parse: [] as string[] }
    }

    const task = async (): Promise<HookTestResult> => {
      let lastError: string | undefined
      let statusCode: number | undefined
      let retryAfterMs: number | undefined

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          const response = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000)
          })
          statusCode = response.status
          const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
          if (response.ok) {
            return { success: true, durationMs: Date.now() - start, statusCode }
          }
          if (response.status === 429) {
            retryAfterMs = parseRetryAfterMs(response, json)
            if (retryAfterMs && attempt < MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, retryAfterMs))
              continue
            }
          }
          lastError = JSON.stringify(json)
          break
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
          break
        }
      }

      return {
        success: false,
        durationMs: Date.now() - start,
        statusCode,
        retryAfterMs,
        error: lastError || 'Discord request failed'
      }
    }

    const result = isTest ? await task() : await this.discordQueue.enqueue(task)
    return result
  }

  private buildDiscordEmbed(payload: HookEventPayload): {
    title: string
    fields: Array<{ name: string; value: string; inline?: boolean }>
    timestamp: string
  } {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: 'Event', value: payload.event, inline: true }
    ]

    if (payload.session.conversationId) {
      fields.push({
        name: 'Conversation',
        value: truncateText(payload.session.conversationId, 256)
      })
    }
    if (payload.tool?.name) {
      fields.push({
        name: 'Tool',
        value: truncateText(payload.tool.name, 128),
        inline: true
      })
    }
    if (payload.stop?.reason) {
      fields.push({
        name: 'Stop',
        value: truncateText(payload.stop.reason, 128),
        inline: true
      })
    }
    if (payload.error?.message) {
      fields.push({
        name: 'Error',
        value: truncateText(payload.error.message, 512)
      })
    }

    return {
      title: `DeepChat${payload.isTest ? ' Test' : ''}`,
      fields,
      timestamp: payload.time
    }
  }

  private getConfirmoHookPath(): string {
    return path.join(app.getPath('home'), CONFIRMO_HOOK_RELATIVE_PATH)
  }

  private isConfirmoHookAvailable(hookPath?: string): boolean {
    const targetPath = hookPath ?? this.getConfirmoHookPath()
    try {
      return fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()
    } catch {
      return false
    }
  }

  private resolveConfirmoNodeCommand(): string {
    this.runtimeHelper.initializeRuntimes()
    return this.runtimeHelper.replaceWithRuntimeCommand('node', true)
  }

  private async sendConfirmo(payload: HookEventPayload): Promise<HookTestResult> {
    const { available, path: hookPath } = this.getConfirmoHookStatus()
    if (!available) {
      return { success: false, durationMs: 0, error: 'Confirmo hook not found' }
    }

    const nodeCommand = this.resolveConfirmoNodeCommand()
    const result = await this.executeHookCommand(nodeCommand, payload, {
      args: [hookPath],
      shell: false,
      stdinPayload: this.buildConfirmoInput(payload)
    })

    return {
      success: result.success,
      durationMs: result.durationMs,
      exitCode: result.exitCode ?? undefined,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error
    }
  }

  private buildConfirmoInput(payload: HookEventPayload): Record<string, unknown> {
    const sessionId =
      payload.session.conversationId ??
      (payload.isTest ? 'test' : undefined) ??
      payload.user?.messageId ??
      payload.tool?.callId ??
      'unknown'

    const toolInput = this.resolveConfirmoToolInput(payload.tool?.paramsPreview)
    const reason = payload.stop?.reason ?? payload.error?.message

    return {
      session_id: sessionId,
      cwd: payload.session.workdir ?? undefined,
      hook_event_name: payload.event,
      tool_name: payload.tool?.name,
      tool_input: toolInput,
      prompt: payload.user?.promptPreview,
      source: 'deepchat',
      reason
    }
  }

  private resolveConfirmoToolInput(paramsPreview?: string): Record<string, unknown> | undefined {
    if (!paramsPreview) return undefined
    try {
      const parsed = JSON.parse(paramsPreview) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    } catch {
      // ignore
    }
    return { preview: truncateText(paramsPreview, 400) }
  }
}
