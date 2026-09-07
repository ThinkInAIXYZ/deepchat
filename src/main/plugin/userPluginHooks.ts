import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createMinimalProcessEnvironment } from '@/mcp/processEnvironment'
import { terminateProcessTree } from '@/agent/shared/process/processTree'
import type {
  TapeAnchorWriter,
  TapeNonContextEntryReader,
  TapeIncarnationReader
} from '@/tape/ports/capabilities'
import type {
  PluginContextContribution,
  PluginContextEvent,
  PluginContextInput,
  PluginContextPort,
  UserPluginHook,
  UserPluginHookDiagnostic
} from '@shared/types/userPlugin'

interface HookOwner {
  pluginId: string
  digest: string
  root: string
  data: string
  hooks: UserPluginHook[]
  verify?: (signal: AbortSignal) => Promise<void>
  controller: AbortController
}

interface Invocation extends UserPluginHookDiagnostic {
  pluginId: string
  digest: string
  hookId: string
  boundaryId: string
  messageId: string
  content?: string
  entryId?: number
  input?: Omit<PluginContextInput, 'signal'>
  source?: string
  promptHash?: string
}

type HookTape = TapeAnchorWriter & TapeNonContextEntryReader & TapeIncarnationReader

export class UserPluginHooks implements PluginContextPort {
  private readonly owners = new Map<string, HookOwner>()
  private readonly sessions = new Map<
    string,
    { incarnationId: string; history: Map<string, Invocation> }
  >()
  private readonly launchId = randomUUID()
  private queue: Promise<void> = Promise.resolve()
  private activeRuns = new Map<string, number>()
  private updating = false

  beginRun(sessionId: string): void {
    if (this.updating) throw new Error('A plugin update is being applied; retry after it completes')
    this.activeRuns.set(sessionId, (this.activeRuns.get(sessionId) ?? 0) + 1)
  }

  endRun(sessionId: string): void {
    const count = (this.activeRuns.get(sessionId) ?? 1) - 1
    if (count > 0) this.activeRuns.set(sessionId, count)
    else this.activeRuns.delete(sessionId)
  }

  beginUpdate(): () => void {
    if (this.updating || this.activeRuns.size)
      throw new Error('Finish or stop active DeepChat turns before updating a plugin')
    this.updating = true
    return () => {
      this.updating = false
    }
  }

  constructor(
    private readonly tape: HookTape,
    private readonly environment: () => Record<string, string> = () =>
      createMinimalProcessEnvironment(process.env, process.platform)
  ) {}

  register(input: Omit<HookOwner, 'controller'>): void {
    this.unregister(input.pluginId)
    this.owners.set(input.pluginId, { ...input, controller: new AbortController() })
  }

  unregister(pluginId: string): void {
    this.owners.get(pluginId)?.controller.abort()
    this.owners.delete(pluginId)
  }

  hasHooks(): boolean {
    return this.owners.size > 0
  }

  private history(sessionId: string): Map<string, Invocation> {
    const incarnationId = this.tape.getTapeIncarnationId(sessionId)
    const cached = this.sessions.get(sessionId)
    let history = cached?.incarnationId === incarnationId ? cached.history : undefined
    if (!history) {
      history = new Map()
      for (const row of this.tape.getBySession(sessionId, 'plugin/context-hook')) {
        let invocation: Invocation
        try {
          invocation = JSON.parse(row.payload_json)?.state
          if (!invocation || typeof invocation.invocationId !== 'string') continue
        } catch {
          continue
        }
        history.set(invocation.invocationId, {
          ...invocation,
          promptHash:
            invocation.promptHash ??
            (typeof invocation.input?.prompt === 'string'
              ? createHash('sha256').update(invocation.input.prompt).digest('hex')
              : undefined),
          input: invocation.status === 'completed' ? undefined : invocation.input,
          entryId: row.entry_id,
          status: invocation.status === 'started' ? 'uncertain' : invocation.status
        })
      }
    }
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, { incarnationId, history })
    // Keep recent sessions only; completed invocations do not retain retry payloads.
    while (this.sessions.size > 16) {
      this.sessions.delete(this.sessions.keys().next().value!)
    }
    return history
  }

  private persist(invocation: Invocation): void {
    const row = this.tape.appendAnchor({
      sessionId: invocation.sessionId,
      name: 'plugin/context-hook',
      source: {
        type: 'runtime_event',
        id: invocation.invocationId,
        seq: invocation.status === 'started' ? 0 : 1
      },
      provenanceKey: `plugin-hook:${invocation.invocationId}:${invocation.status}`,
      state: { ...invocation, entryId: undefined },
      idempotent: false
    })
    this.history(invocation.sessionId).set(invocation.invocationId, {
      ...invocation,
      input: invocation.status === 'completed' ? undefined : invocation.input,
      entryId: row.entry_id
    })
  }

  async accept(input: PluginContextInput): Promise<void> {
    if (!this.hasHooks()) return
    const incarnationId = this.tape.getTapeIncarnationId(input.sessionId)
    const operation = this.queue.then(async () => {
      if (this.tape.getTapeIncarnationId(input.sessionId) !== incarnationId) return
      const deadline = AbortSignal.timeout(10000)
      const signal = input.signal ? AbortSignal.any([deadline, input.signal]) : deadline
      const promptHash = createHash('sha256').update(input.prompt).digest('hex')
      const history = this.history(input.sessionId)
      for (const owner of this.owners.values()) {
        const previous = [...history.values()].filter(
          (item) => item.pluginId === owner.pluginId && item.digest === owner.digest
        )
        if (
          !input.source &&
          previous.some(
            (item) =>
              item.event === 'UserPromptSubmit' &&
              item.messageId === input.messageId &&
              item.promptHash === promptHash
          )
        ) {
          // An edit can return to an earlier prompt on the same message.
          for (const item of previous) {
            if (
              item.event === 'UserPromptSubmit' &&
              item.messageId === input.messageId &&
              item.promptHash === promptHash
            ) {
              history.delete(item.invocationId)
              history.set(item.invocationId, item)
            }
          }
          continue
        }
        if (input.source === 'compact') {
          await this.event(
            owner,
            input,
            'SessionStart',
            `compact:${input.boundaryId}`,
            'compact',
            signal
          )
          if (this.tape.getTapeIncarnationId(input.sessionId) !== incarnationId) return
          continue
        }
        if (input.parentSessionId) {
          await this.event(owner, input, 'SubagentStart', 'child-start', undefined, signal)
        } else if (previous.length === 0) {
          await this.event(owner, input, 'SessionStart', 'startup', 'startup', signal)
        } else if (!previous.some((item) => item.source === this.launchId)) {
          await this.event(
            owner,
            input,
            'SessionStart',
            `resume:${this.launchId}`,
            'resume',
            signal
          )
        }
        if (this.tape.getTapeIncarnationId(input.sessionId) !== incarnationId) return
        await this.event(
          owner,
          input,
          'UserPromptSubmit',
          `input:${input.messageId}:${promptHash}`,
          undefined,
          signal
        )
        if (this.tape.getTapeIncarnationId(input.sessionId) !== incarnationId) return
        // Remember admission even when every handler matcher skips this boundary.
        if (
          ![...history.values()].some(
            (item) => item.pluginId === owner.pluginId && item.digest === owner.digest
          )
        ) {
          this.persist({
            invocationId: createHash('sha256')
              .update(JSON.stringify([owner.pluginId, owner.digest, input.sessionId, '$session']))
              .digest('hex'),
            pluginId: owner.pluginId,
            digest: owner.digest,
            hookId: '$session',
            boundaryId: 'session-observed',
            messageId: input.messageId,
            sessionId: input.sessionId,
            event: 'SessionStart',
            status: 'completed',
            at: Date.now(),
            source: this.launchId
          })
        }
      }
    })
    this.queue = operation.catch(() => undefined)
    await operation
  }

  private async event(
    owner: HookOwner,
    input: PluginContextInput,
    event: PluginContextEvent,
    boundaryId: string,
    source: string | undefined,
    signal: AbortSignal,
    onlyHookId?: string
  ): Promise<void> {
    const matcherValue =
      event === 'SessionStart'
        ? (source ?? '')
        : event === 'SubagentStart'
          ? (input.agentId ?? '')
          : ''
    for (const hook of owner.hooks) {
      if (
        (onlyHookId && hook.id !== onlyHookId) ||
        hook.event !== event ||
        (hook.matcher && !new RegExp(hook.matcher).test(matcherValue))
      )
        continue
      const invocationId = createHash('sha256')
        .update(
          JSON.stringify([owner.pluginId, owner.digest, input.sessionId, hook.id, boundaryId])
        )
        .digest('hex')
      if (this.history(input.sessionId).has(invocationId)) continue
      const { signal: _signal, ...storedInput } = input
      const incarnationId = this.tape.getTapeIncarnationId(input.sessionId)
      const invocation: Invocation = {
        invocationId,
        pluginId: owner.pluginId,
        digest: owner.digest,
        hookId: hook.id,
        boundaryId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        event,
        at: Date.now(),
        status: 'started',
        source: this.launchId,
        promptHash: createHash('sha256').update(input.prompt).digest('hex'),
        ...(Buffer.byteLength(input.prompt) <= 1024 * 1024 ? { input: storedInput } : {})
      }
      this.persist(invocation)
      try {
        if (signal.aborted || owner.controller.signal.aborted)
          throw new Error('Hook boundary cancelled or exceeded its 10 second budget')
        await owner.verify?.(AbortSignal.any([signal, owner.controller.signal]))
        signal.throwIfAborted()
        const payload = {
          session_id:
            input.parentSessionId && event === 'SubagentStart'
              ? input.parentSessionId
              : input.sessionId,
          hook_event_name: event,
          cwd: input.cwd,
          transcript_path: null,
          model: input.model,
          ...(source ? { source } : {}),
          ...(event === 'UserPromptSubmit' ? { prompt: input.prompt } : {}),
          ...(event === 'SubagentStart'
            ? { agent_id: input.sessionId, agent_type: input.agentId ?? 'deepchat' }
            : {})
        }
        const result = await runContextHook(
          owner,
          hook,
          payload,
          AbortSignal.any([signal, owner.controller.signal]),
          this.environment()
        )
        if (this.owners.get(owner.pluginId) !== owner || signal.aborted)
          throw new Error('Hook owner revoked or boundary cancelled')
        if (this.tape.getTapeIncarnationId(input.sessionId) !== incarnationId) return
        const consumed = [...this.history(input.sessionId).values()]
          .filter(
            (item) =>
              item.messageId === input.messageId &&
              item.promptHash === invocation.promptHash &&
              item.status === 'completed'
          )
          .reduce((sum, item) => sum + Buffer.byteLength(item.content ?? ''), 0)
        if (consumed + Buffer.byteLength(result.content ?? '') > 8192)
          throw new Error('Hook context exceeded its 8 KiB boundary budget')
        this.persist({
          ...invocation,
          status: 'completed',
          content: result.content,
          message: result.message,
          at: Date.now()
        })
      } catch (error) {
        if (this.tape.getTapeIncarnationId(input.sessionId) !== incarnationId) return
        this.persist({
          ...invocation,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
          at: Date.now()
        })
      }
    }
  }

  getContext(sessionId: string, messageId: string): PluginContextContribution[] {
    if (!this.hasHooks()) return []
    const active = new Map<string, Invocation>()
    for (const invocation of this.history(sessionId).values()) {
      const owner = this.owners.get(invocation.pluginId)
      if (!owner || owner.digest !== invocation.digest) continue
      if (invocation.event === 'UserPromptSubmit' && invocation.messageId !== messageId) continue
      active.set(`${invocation.pluginId}:${invocation.hookId}`, invocation)
    }
    return [...active.values()]
      .filter((item) => item.status === 'completed' && item.content)
      .map((item) => ({
        pluginId: item.pluginId,
        digest: item.digest,
        invocationId: item.invocationId,
        content: item.content!,
        entryId: item.entryId
      }))
  }

  diagnostics(pluginId: string): UserPluginHookDiagnostic[] {
    return [...this.sessions.keys()]
      .flatMap((sessionId) => [...this.history(sessionId).values()])
      .filter((item) => item.pluginId === pluginId && item.hookId !== '$session')
      .sort((a, b) => b.at - a.at)
      .slice(0, 20)
      .map(({ invocationId, event, sessionId, status, message, at }) => ({
        invocationId,
        event,
        sessionId,
        status,
        message,
        at
      }))
  }

  async retry(pluginId: string, invocationId: string): Promise<void> {
    const invocation = [...this.sessions.keys()]
      .map((sessionId) => this.history(sessionId).get(invocationId))
      .find(Boolean)
    const owner = this.owners.get(pluginId)
    if (
      !invocation ||
      !owner ||
      invocation.pluginId !== pluginId ||
      invocation.digest !== owner.digest ||
      !invocation.input ||
      !['failed', 'uncertain'].includes(invocation.status)
    )
      throw new Error('Hook retry is unavailable or belongs to an inactive revision')
    if (this.activeRuns.size || this.updating)
      throw new Error('Finish active turns and plugin updates before retrying a hook')
    const sessionId = invocation.sessionId
    const incarnationId = this.tape.getTapeIncarnationId(sessionId)
    const expectedInput = JSON.stringify(invocation.input)
    const expectedStatus = invocation.status
    const operation = this.queue.then(() => {
      if (this.tape.getTapeIncarnationId(sessionId) !== incarnationId)
        throw new Error('Hook retry is unavailable after the session was cleared')
      const current = this.history(sessionId).get(invocationId)
      const currentOwner = this.owners.get(pluginId)
      if (
        !current?.input ||
        currentOwner !== owner ||
        current.pluginId !== pluginId ||
        current.digest !== owner.digest ||
        current.status !== expectedStatus ||
        JSON.stringify(current.input) !== expectedInput
      )
        throw new Error('Hook retry is unavailable or belongs to an inactive revision')
      if (this.activeRuns.size || this.updating)
        throw new Error('Finish active turns and plugin updates before retrying a hook')
      return this.event(
        currentOwner,
        current.input,
        current.event,
        `${current.boundaryId}:retry:${randomUUID()}`,
        current.event === 'SessionStart' ? current.boundaryId.split(':')[0] : undefined,
        AbortSignal.timeout(10000),
        current.hookId
      )
    })
    this.queue = operation.catch(() => undefined)
    await operation
  }
}

async function runContextHook(
  owner: HookOwner,
  hook: UserPluginHook,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  environment: Record<string, string>
): Promise<{ content?: string; message?: string }> {
  const stdin = JSON.stringify(payload)
  if (Buffer.byteLength(stdin) > 1024 * 1024) throw new Error('Hook input exceeds 1 MiB')
  const command =
    process.platform === 'win32' ? (hook.commandWindows ?? hook.command) : hook.command
  if (process.platform === 'win32' && !hook.commandWindows && /\$\{|\$[A-Za-z_]/.test(command))
    throw new Error('This hook requires a commandWindows override for the Windows shell')
  const stdout = await new Promise<string>((resolve, reject) => {
    signal.throwIfAborted()
    const child = spawn(command, [], {
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      cwd: typeof payload.cwd === 'string' && fs.existsSync(payload.cwd) ? payload.cwd : owner.data,
      env: {
        ...environment,
        PLUGIN_ROOT: owner.root,
        PLUGIN_DATA: owner.data,
        CLAUDE_PLUGIN_ROOT: owner.root,
        CLAUDE_PLUGIN_DATA: owner.data,
        DEEPCHAT_PLUGIN_ID: owner.pluginId
      }
    })
    const out: Buffer[] = []
    let outBytes = 0
    let errBytes = 0
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* The group already exited. */
        }
      }
      if (error) void terminateProcessTree(child, { graceMs: 100 }).finally(() => reject(error))
      else resolve(Buffer.concat(out).toString('utf8'))
    }
    const abort = () => finish(new Error('Hook cancelled'))
    const timer = setTimeout(
      () => finish(new Error(`Hook timed out after ${hook.timeout}s`)),
      hook.timeout * 1000
    )
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length
      if (outBytes > 65536) finish(new Error('Hook stdout exceeds 64 KiB'))
      else out.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errBytes += chunk.length
      if (errBytes > 65536) finish(new Error('Hook stderr exceeds 64 KiB'))
    })
    child.stdin.on('error', () => undefined)
    child.on('error', (error) => finish(error))
    child.on('close', (code) =>
      finish(code === 0 ? undefined : new Error(`Hook exited with status ${code}`))
    )
    child.stdin.end(stdin)
  })
  if (!stdout.trim()) return {}
  const output = JSON.parse(stdout.replace(/^\uFEFF/, ''))
  if (!output || typeof output !== 'object' || Array.isArray(output))
    throw new Error('Hook output must be a JSON object')
  if (
    Object.keys(output).some(
      (key) => !['hookSpecificOutput', 'systemMessage', 'suppressOutput'].includes(key)
    )
  )
    throw new Error('Hook returned unsupported decision or control fields')
  const specific = output.hookSpecificOutput
  if (
    specific &&
    (specific.hookEventName !== payload.hook_event_name ||
      Object.keys(specific).some((key) => !['hookEventName', 'additionalContext'].includes(key)))
  )
    throw new Error('Hook output has a mismatched event or unsupported control fields')
  if (specific?.additionalContext !== undefined && typeof specific.additionalContext !== 'string')
    throw new Error('Hook additionalContext must be text')
  return {
    content: specific?.additionalContext,
    message:
      typeof output.systemMessage === 'string' ? output.systemMessage.slice(0, 1024) : undefined
  }
}
