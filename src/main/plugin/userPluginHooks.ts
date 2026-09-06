import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createMinimalProcessEnvironment } from '@/mcp/processEnvironment'
import { terminateProcessTree } from '@/agent/shared/process/processTree'
import type { TapeAnchorWriter, TapeNonContextEntryReader } from '@/tape/ports/capabilities'
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
}

type HookTape = TapeAnchorWriter & TapeNonContextEntryReader

export class UserPluginHooks implements PluginContextPort {
  private readonly owners = new Map<string, HookOwner>()
  private readonly sessions = new Map<string, Map<string, Invocation>>()
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
    let history = this.sessions.get(sessionId)
    if (!history) {
      history = new Map()
      for (const row of this.tape.getBySession(sessionId)) {
        if (row.name !== 'plugin/context-hook') continue
        const invocation = JSON.parse(row.payload_json).state as Invocation
        if (!invocation || typeof invocation.invocationId !== 'string') continue
        history.set(invocation.invocationId, {
          ...invocation,
          entryId: row.entry_id,
          status: invocation.status === 'started' ? 'uncertain' : invocation.status
        })
      }
      this.sessions.set(sessionId, history)
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
      entryId: row.entry_id
    })
  }

  async accept(input: PluginContextInput): Promise<void> {
    if (!this.hasHooks()) return
    const deadline = AbortSignal.timeout(10000)
    const signal = input.signal ? AbortSignal.any([deadline, input.signal]) : deadline
    const operation = this.queue.then(async () => {
      if (signal.aborted) return
      const history = this.history(input.sessionId)
      for (const owner of this.owners.values()) {
        const previous = [...history.values()].filter(
          (item) => item.pluginId === owner.pluginId && item.digest === owner.digest
        )
        if (!input.source && previous.some((item) => item.messageId === input.messageId)) continue
        if (input.source === 'compact') {
          await this.event(
            owner,
            input,
            'SessionStart',
            `compact:${input.boundaryId}`,
            'compact',
            signal
          )
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
        await this.event(
          owner,
          input,
          'UserPromptSubmit',
          `input:${input.messageId}`,
          undefined,
          signal
        )
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
        const consumed = [...this.history(input.sessionId).values()]
          .filter((item) => item.messageId === input.messageId && item.status === 'completed')
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
    return [...this.sessions.values()]
      .flatMap((history) => [...history.values()])
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
    const invocation = [...this.sessions.values()]
      .map((history) => history.get(invocationId))
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
    const input = invocation.input
    const operation = this.queue.then(() =>
      this.event(
        owner,
        input,
        invocation.event,
        `${invocation.boundaryId}:retry:${randomUUID()}`,
        invocation.event === 'SessionStart' ? invocation.boundaryId.split(':')[0] : undefined,
        AbortSignal.timeout(10000),
        invocation.hookId
      )
    )
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
    let out = ''
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
      else resolve(out)
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
      else out += chunk.toString('utf8')
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
