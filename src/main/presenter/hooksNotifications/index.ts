import { spawn } from 'child_process'
import { app } from 'electron'
import log from 'electron-log'
import fs from 'fs'
import type { IConfigPresenter } from '@shared/presenter'
import type {
  HookCommandItem,
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
const HOOK_COMMAND_PLACEHOLDER_ENV_MAP = {
  event: 'DEEPCHAT_HOOK_EVENT',
  time: 'DEEPCHAT_HOOK_TIME',
  isTest: 'DEEPCHAT_HOOK_IS_TEST',
  conversationId: 'DEEPCHAT_CONVERSATION_ID',
  workdir: 'DEEPCHAT_WORKDIR',
  agentId: 'DEEPCHAT_AGENT_ID',
  providerId: 'DEEPCHAT_PROVIDER_ID',
  modelId: 'DEEPCHAT_MODEL_ID',
  messageId: 'DEEPCHAT_MESSAGE_ID',
  toolName: 'DEEPCHAT_TOOL_NAME',
  toolCallId: 'DEEPCHAT_TOOL_CALL_ID'
} as const

export type HookDispatchContext = {
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

type HookConversationLookup = {
  providerId?: string
  modelId?: string
  projectDir?: string | null
}

type HookMessageLookup = {
  content: unknown
}

type HooksNotificationsDeps = {
  getSession?: (sessionId: string) => Promise<HookConversationLookup | null>
  getMessage?: (messageId: string) => Promise<HookMessageLookup | null>
}

export const truncateText = (value: string, limit: number): string => {
  if (!value || limit <= 0) {
    return ''
  }
  if (value.length <= limit) {
    return value
  }

  const sliceLength = Math.max(0, limit - TRUNCATION_SUFFIX.length)
  return value.slice(0, sliceLength) + TRUNCATION_SUFFIX
}

export const expandHookCommandPlaceholders = (
  command: string,
  platform: NodeJS.Platform = process.platform
): string =>
  command.replace(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g, (match, key: string) => {
    const envName =
      HOOK_COMMAND_PLACEHOLDER_ENV_MAP[key as keyof typeof HOOK_COMMAND_PLACEHOLDER_ENV_MAP]
    if (!envName) {
      return match
    }

    return platform === 'win32' ? `"%${envName}%"` : `"\${${envName}}"`
  })

const extractPromptPreview = (content: unknown): string => {
  if (typeof content === 'string') {
    try {
      return extractPromptPreview(JSON.parse(content) as unknown)
    } catch {
      return content
    }
  }

  if (!content || typeof content !== 'object') {
    return ''
  }

  const userCandidate = content as { text?: string }
  if (typeof userCandidate.text === 'string') {
    return userCandidate.text
  }

  if (Array.isArray(content)) {
    return content
      .filter((block) => typeof block === 'object' && block && 'type' in block)
      .map((block) => {
        const contentBlock = block as { type?: string; content?: string }
        return contentBlock.type === 'content' ? contentBlock.content || '' : ''
      })
      .join('')
  }

  return ''
}

const redactSensitiveText = (text: string, secrets: string[]): string => {
  if (!text) {
    return ''
  }

  let output = text
  for (const secret of secrets) {
    if (!secret) {
      continue
    }
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
  constructor(
    private readonly configPresenter: IConfigPresenter,
    private readonly deps: HooksNotificationsDeps
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

  async testHookCommand(hookId: string): Promise<HookTestResult> {
    const hook = this.getConfigSnapshot().hooks.find((item) => item.id === hookId)
    if (!hook) {
      return {
        success: false,
        durationMs: 0,
        error: 'Hook is not configured'
      }
    }

    if (!hook.command.trim()) {
      return {
        success: false,
        durationMs: 0,
        error: 'Command is not configured'
      }
    }

    const event = hook.events[0] ?? 'SessionStart'
    const payload = await this.buildPayload(event, {
      isTest: true,
      promptPreview: 'Test message'
    })

    return await this.runHookCommand(hook, payload)
  }

  private async dispatchEventAsync(
    event: HookEventName,
    context: HookDispatchContext
  ): Promise<void> {
    const config = this.getConfigSnapshot()
    const payload = await this.buildPayload(event, context)

    for (const hook of config.hooks) {
      if (!this.shouldDispatchHook(hook, event)) {
        continue
      }

      void this.runHookCommand(hook, payload).catch((error) => {
        log.warn(`[HooksNotifications] Hook "${hook.name}" failed:`, error)
      })
    }
  }

  private shouldDispatchHook(hook: HookCommandItem, event: HookEventName): boolean {
    return Boolean(hook.enabled && hook.command.trim() && hook.events.includes(event))
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

    if (conversationId && (!providerId || !modelId || !workdir)) {
      try {
        const session = this.deps.getSession ? await this.deps.getSession(conversationId) : null
        if (session) {
          providerId = providerId ?? session.providerId
          modelId = modelId ?? session.modelId
          workdir = workdir ?? session.projectDir
          if (!agentId && session.providerId === 'acp') {
            agentId = session.modelId
          }
        }
      } catch (error) {
        log.warn('[HooksNotifications] Failed to load session info:', error)
      }
    }

    let promptPreview = context.promptPreview
    if (!promptPreview && context.messageId) {
      try {
        const message = this.deps.getMessage ? await this.deps.getMessage(context.messageId) : null
        if (message) {
          promptPreview = extractPromptPreview(message.content)
        }
      } catch (error) {
        log.warn('[HooksNotifications] Failed to read message for preview:', error)
      }
    }

    const hasUser = Boolean(promptPreview || context.messageId)
    return {
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
  }

  private resolveCommandCwd(workdir?: string | null): string {
    if (workdir && fs.existsSync(workdir)) {
      try {
        if (fs.statSync(workdir).isDirectory()) {
          return workdir
        }
      } catch {
        return process.cwd()
      }
    }
    return process.cwd()
  }

  private async runHookCommand(
    hook: HookCommandItem,
    payload: HookEventPayload
  ): Promise<HookTestResult> {
    const result = await this.executeHookCommand(hook.command, payload)
    return {
      success: result.success,
      durationMs: result.durationMs,
      exitCode: result.exitCode ?? undefined,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error
    }
  }

  private async executeHookCommand(
    command: string,
    payload: HookEventPayload
  ): Promise<HookCommandResult> {
    const start = Date.now()
    const cwd = this.resolveCommandCwd(payload.session.workdir)
    const expandedCommand = expandHookCommandPlaceholders(command)
    const env: Record<string, string> = {
      ...process.env,
      DEEPCHAT_HOOK_EVENT: payload.event,
      DEEPCHAT_HOOK_TIME: payload.time,
      DEEPCHAT_HOOK_IS_TEST: payload.isTest ? 'true' : 'false',
      DEEPCHAT_CONVERSATION_ID: payload.session.conversationId ?? '',
      DEEPCHAT_WORKDIR: payload.session.workdir ?? '',
      DEEPCHAT_AGENT_ID: payload.session.agentId ?? '',
      DEEPCHAT_PROVIDER_ID: payload.session.providerId ?? '',
      DEEPCHAT_MODEL_ID: payload.session.modelId ?? '',
      DEEPCHAT_MESSAGE_ID: payload.user?.messageId ?? '',
      DEEPCHAT_TOOL_NAME: payload.tool?.name ?? '',
      DEEPCHAT_TOOL_CALL_ID: payload.tool?.callId ?? ''
    }

    return await new Promise<HookCommandResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let finished = false
      let timedOut = false

      const child = spawn(expandedCommand, [], {
        shell: true,
        cwd,
        env,
        windowsHide: true
      })

      const finalize = (result: HookCommandResult) => {
        if (finished) {
          return
        }
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
        finalize({
          success: !timedOut && code === 0,
          durationMs: Date.now() - start,
          exitCode: code ?? null,
          stdout: redactSensitiveText(truncateText(stdout, DIAGNOSTIC_TEXT_LIMIT), secrets),
          stderr: redactSensitiveText(truncateText(stderr, DIAGNOSTIC_TEXT_LIMIT), secrets),
          error: timedOut ? 'Command timed out' : code === 0 ? undefined : 'Command failed'
        })
      })

      try {
        child.stdin?.write(JSON.stringify(payload))
        child.stdin?.end()
      } catch (error) {
        try {
          child.stdin?.end()
        } catch {
          // ignore
        }
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
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
}
