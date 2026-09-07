import { spawn, type ChildProcess } from 'child_process'
import { app } from 'electron'
import fs from 'fs'
import type {
  HookCommandItem,
  HookCommandResult,
  HookEventName,
  HookEventPayload,
  HookTestResult,
  HooksNotificationsSettings
} from '@shared/hooksNotifications'
import type { HookEvent, HookSessionFacts } from './events'
import type { HookObserver } from './observer'

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

type HookSessionLookup = {
  providerId?: string
  modelId?: string
  projectDir?: string | null
}

export interface HookSettingsPort {
  getHooksNotificationsConfig(): HooksNotificationsSettings
  setHooksNotificationsConfig(config: HooksNotificationsSettings): HooksNotificationsSettings
}

export interface HookQueryPort {
  getSession(sessionId: string): Promise<HookSessionLookup | null>
}

/** Configuration and its derived subscription index, rebuilt as one unit so they cannot disagree. */
type HookConfigSnapshot = {
  readonly config: HooksNotificationsSettings
  readonly subscribedEvents: ReadonlySet<HookEventName>
}

/** Identity of a hook as it stood when the event was accepted. */
type AcceptedHook = {
  readonly id: string
  readonly command: string
}

/** An accepted event together with the subscribers that were eligible at that moment. */
type HookDelivery = {
  readonly projection: HookEventProjection
  readonly accepted: readonly AcceptedHook[]
}

/** One event reduced to detached, already-truncated wire facts. */
type HookEventProjection = {
  readonly event: HookEventName
  readonly time: string
  readonly session: HookSessionFacts
  readonly user: HookEventPayload['user']
  readonly tool: HookEventPayload['tool']
  readonly permission: HookEventPayload['permission']
  readonly stop: HookEventPayload['stop']
  readonly usage: HookEventPayload['usage']
  readonly error: HookEventPayload['error']
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

/**
 * Diagnostics are truncated to DIAGNOSTIC_TEXT_LIMIT anyway, so a command that streams for its
 * whole timeout window must not be able to hold more than that in the main process.
 */
const captureDiagnostic = (current: string, chunk: unknown): string =>
  current.length >= DIAGNOSTIC_TEXT_LIMIT ? current : current + String(chunk)

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

const projectUser = (
  messageId: string | undefined,
  promptPreview: string | undefined
): HookEventPayload['user'] =>
  promptPreview || messageId
    ? { messageId, promptPreview: truncateText(promptPreview || '', PREVIEW_TEXT_LIMIT) }
    : null

const projectTool = (tool: {
  callId?: string
  name?: string
  params?: string
  response?: string
  error?: string
}): HookEventPayload['tool'] => ({
  callId: tool.callId,
  name: tool.name,
  paramsPreview: tool.params ? truncateText(tool.params, PREVIEW_TEXT_LIMIT) : undefined,
  responsePreview: tool.response ? truncateText(tool.response, PREVIEW_TEXT_LIMIT) : undefined,
  error: tool.error ? truncateText(tool.error, PREVIEW_TEXT_LIMIT) : undefined
})

/** Truncates before the only clone, so a multi-megabyte tool argument never reaches structuredClone. */
const projectHookEvent = (event: HookEvent, time: string): HookEventProjection => {
  const base = {
    event: event.event,
    time,
    session: { ...event.session },
    user: projectUser(event.session.messageId, undefined),
    tool: null,
    permission: null,
    stop: null,
    usage: null,
    error: null
  } satisfies HookEventProjection

  switch (event.event) {
    case 'SessionStart':
    case 'UserPromptSubmit':
      return { ...base, user: projectUser(event.session.messageId, event.promptPreview) }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return { ...base, tool: projectTool(event.tool) }
    case 'PermissionRequest':
      return {
        ...base,
        tool: projectTool(event.tool),
        permission: structuredClone(event.permission) as Record<string, unknown>
      }
    case 'Stop':
      return { ...base, stop: { reason: event.stop.reason, userStop: event.stop.userStop } }
    case 'SessionEnd':
      return {
        ...base,
        usage: event.usage ? { ...event.usage } : null,
        error: event.error ? { message: event.error.message, stack: event.error.stack } : null
      }
    default: {
      const unreachable: never = event
      throw new Error(`Unhandled hook event: ${JSON.stringify(unreachable)}`)
    }
  }
}

export class HookService implements HookObserver {
  private accepting = true
  private readonly activeChildren = new Set<ChildProcess>()
  /** Per-session delivery chain: emission order within a session, no coupling across sessions. */
  private readonly sessionChains = new Map<string, Promise<void>>()
  private snapshot: HookConfigSnapshot | null = null

  constructor(
    private readonly settings: HookSettingsPort,
    private readonly query: HookQueryPort
  ) {}

  getConfigSnapshot(): HooksNotificationsSettings {
    return cloneConfig(this.readSnapshot().config)
  }

  /** Store write and subscription refresh happen together so the index is never behind the config. */
  updateConfig(config: HooksNotificationsSettings): HooksNotificationsSettings {
    const stored = this.settings.setHooksNotificationsConfig(config)
    this.snapshot = buildConfigSnapshot(stored)
    return stored
  }

  /** Drops the cached snapshot for writers that reach the settings store directly. */
  refreshSubscriptions(): void {
    this.snapshot = null
  }

  start(): void {
    this.accepting = true
    this.refreshSubscriptions()
  }

  async stop(): Promise<void> {
    this.accepting = false
    for (const child of this.activeChildren) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Process may already be closing.
      }
    }
    await Promise.allSettled(Array.from(this.sessionChains.values()))
  }

  isObserved(event: HookEventName): boolean {
    if (!this.accepting) {
      return false
    }
    return this.readSnapshot().subscribedEvents.has(event)
  }

  notify(event: HookEvent): void {
    try {
      if (!this.isObserved(event.event)) {
        return
      }
      const accepted = this.acceptSubscribers(event.event)
      if (accepted.length === 0) {
        return
      }
      this.enqueue({
        projection: projectHookEvent(event, new Date().toISOString()),
        accepted
      })
    } catch (error) {
      console.warn('[Hook] Notification observer failed:', error)
    }
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
    return await this.runHookCommand(hook, {
      payloadVersion: HOOK_PAYLOAD_VERSION,
      event,
      time: new Date().toISOString(),
      isTest: true,
      app: { version: app.getVersion(), platform: process.platform },
      session: { conversationId: undefined, agentId: null, workdir: null },
      user: { messageId: undefined, promptPreview: 'Test message' },
      tool: null,
      permission: null,
      stop: null,
      usage: null,
      error: null
    })
  }

  private readSnapshot(): HookConfigSnapshot {
    this.snapshot ??= buildConfigSnapshot(this.settings.getHooksNotificationsConfig())
    return this.snapshot
  }

  private acceptSubscribers(event: HookEventName): readonly AcceptedHook[] {
    return this.readSnapshot()
      .config.hooks.filter((hook) => shouldDispatchHook(hook, event))
      .map((hook) => ({ id: hook.id, command: hook.command }))
  }

  private enqueue(delivery: HookDelivery): void {
    const sessionId = delivery.projection.session.sessionId
    const previous = this.sessionChains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(async () => {
      try {
        await this.deliver(delivery)
      } catch (error) {
        console.warn('[Hook] Dispatch failed:', error)
      }
    })

    this.sessionChains.set(sessionId, next)
    void next.finally(() => {
      if (this.sessionChains.get(sessionId) === next) {
        this.sessionChains.delete(sessionId)
      }
    })
  }

  private async deliver({ projection, accepted }: HookDelivery): Promise<void> {
    if (!this.accepting) {
      return
    }

    // Skip enrichment entirely when nothing can run any more.
    if (this.runnableHooks(projection.event, accepted).length === 0) {
      return
    }

    const payload = await this.buildPayload(projection)
    if (!this.accepting) {
      return
    }

    // Authoritative revalidation: enrichment is asynchronous, so eligibility is settled here
    // rather than before it.
    for (const hook of this.runnableHooks(projection.event, accepted)) {
      // Per-command isolation: one failing hook must not affect its siblings or the next event.
      void this.runHookCommand(hook, payload).catch((error) => {
        console.warn(`[HooksNotifications] Hook "${hook.name}" failed:`, error)
      })
    }
  }

  /**
   * A hook runs only if it was eligible when the event happened and is still eligible now under
   * the same command, so a hook enabled or edited afterwards never receives an earlier event and
   * one disabled meanwhile stops receiving queued ones.
   */
  private runnableHooks(
    event: HookEventName,
    accepted: readonly AcceptedHook[]
  ): readonly HookCommandItem[] {
    return this.readSnapshot().config.hooks.filter(
      (hook) =>
        shouldDispatchHook(hook, event) &&
        accepted.some((item) => item.id === hook.id && item.command === hook.command)
    )
  }

  private async buildPayload(projection: HookEventProjection): Promise<HookEventPayload> {
    const { sessionId, agentId, providerId, modelId, projectDir } = projection.session
    let resolvedAgentId = agentId
    let resolvedProviderId = providerId
    let resolvedModelId = modelId
    let resolvedWorkdir = projectDir

    // Only an unanswered field triggers a lookup; an explicit null is already a resolved answer.
    if (
      sessionId &&
      (providerId === undefined || modelId === undefined || projectDir === undefined)
    ) {
      try {
        const session = await this.query.getSession(sessionId)
        if (session) {
          resolvedProviderId = resolvedProviderId ?? session.providerId
          resolvedModelId = resolvedModelId ?? session.modelId
          resolvedWorkdir = resolvedWorkdir ?? session.projectDir
          if (!resolvedAgentId && session.providerId === 'acp') {
            resolvedAgentId = session.modelId
          }
        }
      } catch (error) {
        console.warn('[HooksNotifications] Failed to load session info:', error)
      }
    }

    return {
      payloadVersion: HOOK_PAYLOAD_VERSION,
      event: projection.event,
      time: projection.time,
      isTest: false,
      app: {
        version: app.getVersion(),
        platform: process.platform
      },
      session: {
        conversationId: sessionId,
        agentId: resolvedAgentId ?? null,
        workdir: resolvedWorkdir ?? null,
        providerId: resolvedProviderId,
        modelId: resolvedModelId
      },
      user: projection.user,
      tool: projection.tool,
      permission: projection.permission,
      stop: projection.stop,
      usage: projection.usage,
      error: projection.error
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

    const secrets = [payload.session.conversationId ?? '', payload.session.workdir ?? '']

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
      this.activeChildren.add(child)

      const finalize = (result: HookCommandResult) => {
        if (finished) {
          return
        }
        finished = true
        resolve(result)
      }

      // Every settlement path reports diagnostics through here, so redaction cannot be forgotten
      // on one of them.
      const diagnostics = () => ({
        stdout: redactSensitiveText(truncateText(stdout, DIAGNOSTIC_TEXT_LIMIT), secrets),
        stderr: redactSensitiveText(truncateText(stderr, DIAGNOSTIC_TEXT_LIMIT), secrets)
      })

      const timeout = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
        // A killed shell can keep its process tree alive and never emit `close`, so the timeout
        // settles the result itself instead of waiting for an exit that may never arrive.
        finalize({
          success: false,
          durationMs: Date.now() - start,
          exitCode: null,
          ...diagnostics(),
          error: 'Command timed out'
        })
      }, COMMAND_TIMEOUT_MS)

      child.on('error', (error) => {
        this.activeChildren.delete(child)
        clearTimeout(timeout)
        finalize({
          success: false,
          durationMs: Date.now() - start,
          exitCode: null,
          ...diagnostics(),
          error: error instanceof Error ? error.message : String(error)
        })
      })

      child.stdout?.on('data', (chunk) => {
        stdout = captureDiagnostic(stdout, chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr = captureDiagnostic(stderr, chunk)
      })

      child.on('close', (code) => {
        this.activeChildren.delete(child)
        clearTimeout(timeout)
        finalize({
          success: !timedOut && code === 0,
          durationMs: Date.now() - start,
          exitCode: code ?? null,
          ...diagnostics(),
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
          ...diagnostics(),
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }
}

const isHookRunnable = (hook: HookCommandItem): boolean =>
  Boolean(hook.enabled && hook.command.trim())

const shouldDispatchHook = (hook: HookCommandItem, event: HookEventName): boolean =>
  isHookRunnable(hook) && hook.events.includes(event)

const cloneConfig = (config: HooksNotificationsSettings): HooksNotificationsSettings => ({
  hooks: config.hooks.map((hook) => ({ ...hook, events: [...hook.events] }))
})

// Owns a private copy so the settings port never observes the delivery path freezing its result.
const buildConfigSnapshot = (source: HooksNotificationsSettings): HookConfigSnapshot => {
  const config = cloneConfig(source)
  const subscribedEvents = new Set<HookEventName>()
  for (const hook of config.hooks) {
    Object.freeze(hook.events)
    Object.freeze(hook)
    if (!isHookRunnable(hook)) {
      continue
    }
    for (const event of hook.events) {
      subscribedEvents.add(event)
    }
  }
  Object.freeze(config.hooks)
  Object.freeze(config)
  return { config, subscribedEvents }
}
