import { createHash, randomUUID } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type {
  PluginContextEvent,
  UserPluginHook,
  UserPluginHookDiagnostic,
  UserPluginHookSource
} from '@shared/types/userPlugin'
import type { UserPluginHooks } from '@/plugin/userPluginHooks'
import type { SessionDatabase } from '@/session/data/database'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import { DimContent } from './content'
import type { DimProductContextReply, DimProductContextRequest } from './productGateway'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimAuthorizedScope } from './scopes'
import type { DimSessionRef } from './sessionConnection'
import { dimSequence } from './sessionConnection'
import { readLegacyPluginHooks, type DimHookInvocation as Invocation } from './legacyPluginHooks'

const equal = (path: string, value: JsonValue): JsonValue => ({
  op: 'compare',
  left: { kind: 'field', path },
  comparison: 'eq',
  right: { kind: 'value', value }
})

/** Product protocol adaptation only. Commands, process lifetime and audit belong to dim. */
export class DimPluginHooks {
  private readonly launchId = randomUUID()
  private readonly content: DimContent
  private readonly inFlight = new Set<string>()

  constructor(
    private readonly options: {
      database: SessionDatabase
      host: DimRuntimeSupervisor
      hooks: UserPluginHooks
      resolve(request: DimProductContextRequest, signal: AbortSignal): Promise<DimAuthorizedScope>
      prepareLegacy?(sessionId: string): Promise<void>
    }
  ) {
    this.content = new DimContent(options.host)
  }

  async contribute(
    _binding: Readonly<DimSessionBinding>,
    request: DimProductContextRequest,
    signal: AbortSignal
  ): Promise<DimProductContextReply> {
    if (!this.options.hooks.hasHooks()) return { messages: [] }
    const scope = await this.options.resolve(request, signal)
    const sources = await this.options.hooks.nativeSources(signal)
    scope.assertCurrent()
    const compaction = await this.content.latest(
      scope.ref,
      ['context/compaction'],
      equal('data.status', 'completed')
    )
    scope.assertCurrent()
    const reply: DimProductContextReply = { messages: [], receipts: [] }
    const caller = signal
    const deadline = AbortSignal.timeout(10000)
    signal = AbortSignal.any([signal, deadline])
    let bytes = 0
    const append = (invocation: Invocation) => {
      if (invocation.status !== 'completed' || !invocation.content) return
      if (bytes + Buffer.byteLength(invocation.content) > 8192) return
      bytes += Buffer.byteLength(invocation.content)
      reply.messages.push({
        role: 'user',
        content: `[Plugin ${invocation.pluginId}; revision ${invocation.digest}; invocation ${invocation.invocationId}]\n${invocation.content}`
      })
      reply.receipts!.push({
        source: 'deepchat/plugin-hook',
        pluginId: invocation.pluginId,
        digest: invocation.digest,
        invocationId: invocation.invocationId,
        ...scope.ref
      })
    }
    this.options.hooks.beginRun(scope.binding.sessionId)
    try {
      for (const source of sources) {
        // Only the root continuation imports its product archive; an internal child never
        // borrows its parent's startup receipts or executable retry payloads.
        if (scope.description.origin !== 'internal')
          await this.importLegacy(scope.binding, source, signal, scope.assertCurrent)
        const ownerFilter: JsonValue = {
          op: 'and',
          conditions: [equal('data.pluginId', source.pluginId), equal('data.digest', source.digest)]
        }
        const marker = await this.content.latest(
          scope.ref,
          ['deepchat/plugin-hook-session'],
          ownerFilter
        )
        const observed = marker.event
          ? marker
          : await this.content.latest(scope.ref, ['deepchat/plugin-hook'], ownerFilter)
        scope.assertCurrent()
        const parent =
          scope.description.origin === 'internal' ? scope.description.parentSessionId : null
        const compact = !!(
          observed.event &&
          compaction.event &&
          dimSequence(compaction.event.sequence) > dimSequence(observed.event.sequence)
        )
        const sourceName = compact
          ? 'compact'
          : observed.event?.data.launchId === this.launchId
            ? undefined
            : observed.event
              ? 'resume'
              : 'startup'
        const order = { SessionStart: 0, SubagentStart: 1, UserPromptSubmit: 2 }
        for (const hook of [...source.hooks].sort((a, b) => order[a.event] - order[b.event])) {
          scope.assertCurrent()
          const previous = await this.latest(scope.ref, source, hook)
          scope.assertCurrent()
          let event: PluginContextEvent
          let boundary: string
          let matcher: string
          let hookSource: string | undefined
          if (hook.event === 'UserPromptSubmit') {
            event = hook.event
            boundary = `input:${request.turnId}:${createHash('sha256')
              .update(request.hookPrompt ?? request.query)
              .digest('hex')}`
            matcher = ''
          } else if (hook.event === 'SubagentStart') {
            if (!parent) continue
            event = hook.event
            boundary = 'child-start'
            matcher = request.nativeAgentId ?? 'deepchat'
          } else {
            if (parent) continue
            event = hook.event
            if (compact) {
              hookSource = 'compact'
              boundary = `compact:${compaction.event!.id}`
            } else if (!sourceName) {
              if (previous) append(previous.invocation)
              continue
            } else {
              hookSource = sourceName
              boundary = `${hookSource}:${this.launchId}`
            }
            matcher = hookSource
          }
          if (hook.matcher && !new RegExp(hook.matcher).test(matcher)) {
            if (hook.event !== 'UserPromptSubmit' && previous) append(previous.invocation)
            continue
          }
          const payload: Record<string, JsonValue> = {
            session_id:
              parent && event === 'SubagentStart'
                ? scope.binding.sessionId
                : parent
                  ? request.sessionId
                  : scope.binding.sessionId,
            hook_event_name: event,
            cwd: scope.description.cwd,
            transcript_path: null,
            model: request.modelId,
            ...(hookSource ? { source: hookSource } : {}),
            ...(event === 'UserPromptSubmit'
              ? { prompt: request.hookPrompt ?? request.query }
              : {}),
            ...(event === 'SubagentStart'
              ? { agent_id: request.sessionId, agent_type: matcher }
              : {})
          }
          const invocation = await this.run(
            scope.ref,
            source,
            hook,
            boundary,
            request.turnId,
            matcher,
            payload,
            signal,
            undefined,
            8192 - bytes,
            event === 'UserPromptSubmit' && request.hookPromptTooLarge === true
          )
          scope.assertCurrent()
          append(invocation)
        }
        if (
          !parent &&
          source.hooks.some((hook) => hook.event === 'SessionStart') &&
          (!marker.event || marker.event.data.launchId !== this.launchId || compact)
        ) {
          signal.throwIfAborted()
          await (
            await this.options.host.start()
          ).call('session.deepchat_hooks.observe', {
            ...scope.ref,
            pluginId: source.pluginId,
            digest: source.digest,
            launchId: this.launchId,
            compactionId: compaction.event?.id ?? null
          })
          scope.assertCurrent()
        }
      }
      return this.combined(reply)
    } catch (error) {
      caller.throwIfAborted()
      if (deadline.aborted) return this.combined(reply)
      throw error
    } finally {
      this.options.hooks.endRun(scope.binding.sessionId)
    }
  }

  private combined(reply: DimProductContextReply): DimProductContextReply {
    return {
      ...reply,
      receipts: reply.receipts?.length
        ? [{ source: 'deepchat/plugin-hooks', invocations: reply.receipts }]
        : [],
      messages: reply.messages.length
        ? [{ role: 'user', content: reply.messages.map((message) => message.content).join('\n\n') }]
        : []
    }
  }

  private async importLegacy(
    binding: Readonly<DimSessionBinding>,
    source: UserPluginHookSource,
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<void> {
    const current = await this.content.latest(
      { sessionId: binding.dimSessionId, branchId: binding.branchId },
      ['deepchat/plugin-hook', 'deepchat/plugin-hook-session'],
      {
        op: 'and',
        conditions: [equal('data.pluginId', source.pluginId), equal('data.digest', source.digest)]
      }
    )
    assertCurrent()
    if (current.event && !current.event.data.legacy) return
    const migration = await this.content.latest(
      { sessionId: binding.dimSessionId, branchId: binding.branchId },
      ['deepchat/history-sealed']
    )
    assertCurrent()
    // New migration snapshots carry this state, including an explicit empty state after clear.
    // Only an older snapshot may still need a read-only Tape archive upgrade.
    if (migration.event?.data.pluginHooksImported === true) return
    const archived = readLegacyPluginHooks(this.options.database, binding.sessionId).filter(
      (row) =>
        row.pluginId === source.pluginId &&
        row.digest === source.digest &&
        (row.hookId === '$session' ||
          source.hooks.some((hook) => hook.id === row.hookId && hook.event === row.event))
    )
    if (!archived.length || !source.hooks.length) return
    const client = await this.options.host.start()
    for (const invocation of archived) {
      signal.throwIfAborted()
      assertCurrent()
      const result = await client.call<{ imported: boolean }>('session.deepchat_hooks.import', {
        sessionId: binding.dimSessionId,
        branchId: binding.branchId,
        configurationEvent:
          invocation.hookId === '$session' ? source.hooks[0].event : invocation.event,
        invocation: invocation as unknown as JsonValue
      })
      assertCurrent()
      if (!result.imported) break
    }
  }

  private async latest(ref: DimSessionRef, source: UserPluginHookSource, hook: UserPluginHook) {
    const page = await this.content.events(ref, ['deepchat/plugin-hook'], 1, {
      op: 'and',
      conditions: [
        equal('data.pluginId', source.pluginId),
        equal('data.digest', source.digest),
        equal('data.hookId', hook.id)
      ]
    })
    const row = page.events[0]
    return row
      ? { invocation: row.event.data as unknown as Invocation, sequence: row.position.sequence }
      : undefined
  }

  private async run(
    ref: DimSessionRef,
    source: UserPluginHookSource,
    hook: UserPluginHook,
    boundaryId: string,
    messageId: string,
    matcher: string,
    payload: Record<string, JsonValue>,
    signal: AbortSignal,
    retryOf?: string,
    contextBudget = 8192,
    inputTooLarge = false
  ): Promise<Invocation> {
    signal.throwIfAborted()
    const invocationId = createHash('sha256')
      .update(
        JSON.stringify([
          source.pluginId,
          source.digest,
          ref.sessionId,
          ref.branchId,
          hook.id,
          boundaryId
        ])
      )
      .digest('hex')
    const client = await this.options.host.start()
    signal.throwIfAborted()
    inputTooLarge ||= Buffer.byteLength(JSON.stringify(payload)) > 1024 * 1024
    // Keep the failed receipt bounded; the original user input remains in dim's history.
    if (inputTooLarge) payload = { ...payload, prompt: '' }
    const cancel = () => {
      void client
        .call('session.deepchat_hooks.cancel', { ...ref, invocationId })
        .catch(() => undefined)
    }
    signal.addEventListener('abort', cancel, { once: true })
    this.inFlight.add(invocationId)
    try {
      const result = await client.call<Invocation>('session.deepchat_hooks.run', {
        ...ref,
        invocationId,
        pluginId: source.pluginId,
        digest: source.digest,
        hookId: hook.id,
        boundaryId,
        messageId,
        launchId: this.launchId,
        event: hook.event,
        matcher,
        payload,
        contextBudget,
        inputTooLarge,
        ...(retryOf ? { retryOf } : {})
      })
      signal.throwIfAborted()
      return result
    } finally {
      signal.removeEventListener('abort', cancel)
      this.inFlight.delete(invocationId)
    }
  }

  private async records(pluginId: string, invocationId?: string) {
    const result: Array<{
      invocation: Invocation
      ref: DimSessionRef
      sessionId: string
      generation: number
    }> = []
    for (const session of this.options.database.newSessionsTable.list({ includeSubagents: true })) {
      for (const owned of this.options.database.dimSessionScopesTable.list(session.id)) {
        const ref = { sessionId: owned.dimSessionId, branchId: owned.branchId }
        const conditions = [
          equal('data.pluginId', pluginId),
          ...(invocationId ? [equal('data.invocationId', invocationId)] : [])
        ]
        const page = await this.content.events(
          ref,
          ['deepchat/plugin-hook'],
          invocationId ? 1 : 40,
          { op: 'and', conditions }
        )
        if (
          !this.options.database.dimSessionScopesTable
            .list(session.id)
            .some(
              (current) =>
                current.generation === owned.generation &&
                current.dimSessionId === ref.sessionId &&
                current.branchId === ref.branchId
            )
        )
          throw new Error('Plugin hook diagnostics belong to a removed native scope')
        const seen = new Set<string>()
        for (const row of page.events) {
          const invocation = row.event.data as unknown as Invocation
          if (seen.has(invocation.invocationId)) continue
          seen.add(invocation.invocationId)
          result.push({ invocation, ref, sessionId: session.id, generation: owned.generation })
        }
      }
    }
    const latest = new Map<string, (typeof result)[number]>()
    for (const row of result)
      latest.set(JSON.stringify([row.sessionId, row.invocation.invocationId]), row)
    return [...latest.values()]
  }

  readonly diagnostics = async (pluginId: string): Promise<UserPluginHookDiagnostic[]> => {
    const rows = await this.records(pluginId)
    const archived = this.options.database.newSessionsTable
      .list({ includeSubagents: true })
      .flatMap((session) => readLegacyPluginHooks(this.options.database, session.id))
      .filter(
        (invocation) =>
          invocation.pluginId === pluginId &&
          invocation.hookId !== '$session' &&
          !rows.some(
            (row) =>
              row.sessionId === invocation.sessionId &&
              row.invocation.invocationId === invocation.invocationId
          )
      )
      .map((invocation) => ({ invocation, sessionId: invocation.sessionId }))
    return [...rows, ...archived]
      .map(({ invocation, sessionId }) => ({
        invocationId: invocation.invocationId,
        event: invocation.event,
        sessionId,
        status:
          invocation.status === 'started' && !this.inFlight.has(invocation.invocationId)
            ? 'uncertain'
            : invocation.status,
        message: invocation.message,
        at: invocation.at
      }))
      .sort((a, b) => b.at - a.at)
      .slice(0, 20)
  }

  readonly retry = async (pluginId: string, invocationId: string): Promise<void> => {
    if (
      this.options.database.newSessionsTable
        .list({ includeSubagents: true })
        .some(
          (session) =>
            this.options.database.dimSessionBindingsTable.get(session.id)?.status === 'generating'
        )
    )
      throw new Error('Finish active turns before retrying a hook')
    let row = (await this.records(pluginId, invocationId))[0]
    if (!row) {
      const candidates = this.options.database.newSessionsTable
        .list({ includeSubagents: true })
        .flatMap((session) => readLegacyPluginHooks(this.options.database, session.id))
        .filter(
          (invocation) =>
            invocation.pluginId === pluginId && invocation.invocationId === invocationId
        )
      const archived = candidates.length === 1 ? candidates[0] : undefined
      if (
        !archived?.payload ||
        !['failed', 'uncertain'].includes(archived.status) ||
        !this.options.prepareLegacy
      )
        throw new Error('Archived hook retry is unavailable')
      const signal = AbortSignal.timeout(10000)
      const source = (await this.options.hooks.nativeSources(signal)).find(
        (source) => source.pluginId === pluginId && source.digest === archived.digest
      )
      if (!source) throw new Error('Hook retry belongs to an inactive revision')
      await this.options.prepareLegacy(archived.sessionId)
      const binding = this.options.database.dimSessionBindingsTable.get(archived.sessionId)
      if (!binding) throw new Error('Archived hook conversion did not establish its native scope')
      const check = () => {
        const current = this.options.database.dimSessionBindingsTable.get(archived.sessionId)
        if (
          !current ||
          current.dimSessionId !== binding.dimSessionId ||
          current.branchId !== binding.branchId ||
          current.generation !== binding.generation ||
          this.options.database.dimScopeChangesTable.get(archived.sessionId)
        )
          throw new Error('Archived hook retry belongs to a replaced scope')
      }
      await this.importLegacy(binding, source, signal, check)
      row = (await this.records(pluginId, invocationId))[0]
    }
    const binding = row && this.options.database.dimSessionBindingsTable.get(row.sessionId)
    if (
      !row ||
      !binding ||
      binding.dimSessionId !== row.ref.sessionId ||
      binding.branchId !== row.ref.branchId ||
      binding.generation !== row.generation ||
      this.options.database.dimScopeChangesTable.get(row.sessionId) ||
      !row.invocation.payload ||
      !['failed', 'started', 'uncertain'].includes(row.invocation.status)
    )
      throw new Error('Hook retry is unavailable after its native scope changed')
    if (
      this.options.database.newSessionsTable
        .list({ includeSubagents: true })
        .some(
          (session) =>
            this.options.database.dimSessionBindingsTable.get(session.id)?.status === 'generating'
        )
    )
      throw new Error('Finish active turns before retrying a hook')
    const signal = AbortSignal.timeout(10000)
    const source = (await this.options.hooks.nativeSources(signal)).find(
      (source) => source.pluginId === pluginId && source.digest === row.invocation.digest
    )
    const hook = source?.hooks.find(
      (hook) => hook.id === row.invocation.hookId && hook.event === row.invocation.event
    )
    if (!source || !hook) throw new Error('Hook retry belongs to an inactive revision')
    await this.run(
      row.ref,
      source,
      hook,
      `${row.invocation.boundaryId}:retry:${randomUUID()}`,
      row.invocation.messageId,
      row.invocation.matcher,
      row.invocation.payload,
      signal,
      invocationId,
      8192,
      row.invocation.inputTooLarge
    )
  }
}
