import type { SessionDatabase } from '@/session/data/database'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimHistoryChange } from '@/session/data/tables/dimScopeChanges'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimPluginClient } from './pluginClient'
import { DimSessionControls } from './sessionControls'
import { dimSequence } from './sessionConnection'

interface NativeTitle {
  text: string
  source: 'auto' | 'manual'
}
interface TitleScope {
  sessionId: string
  title: NativeTitle | null
  titleRevision: string
}

/** SessionStore owns titles. The desktop projects metadata and supplies migration seeds only. */
export class DimTitles {
  private readonly refreshing = new Map<string, { dirty: boolean; promise: Promise<void> }>()
  private readonly watches = new Map<
    string,
    { binding: DimSessionBinding; client: DimPluginClient }
  >()
  private readonly lifetimes = new Map<string, object>()

  constructor(
    private readonly options: {
      database: SessionDatabase
      host: DimRuntimeSupervisor
      project(sessionId: string, title: string): void
      failed?(sessionId: string, error: unknown): void
    }
  ) {}

  async open(binding: DimSessionBinding): Promise<void> {
    await this.close(binding.sessionId)
    const lifetime = {}
    this.lifetimes.set(binding.sessionId, lifetime)
    const client = await this.options.host.openConnection()
    if (this.lifetimes.get(binding.sessionId) !== lifetime) {
      client.close()
      throw new Error('Native title watch was closed before attachment')
    }
    const watch = { binding, client }
    this.watches.set(binding.sessionId, watch)
    client.on(
      'notification',
      (notice: {
        method: string
        params: { sessionId?: string; source?: string; kind?: string }
      }) => {
        if (
          this.watches.get(binding.sessionId) !== watch ||
          notice.method !== 'session.notice' ||
          notice.params.sessionId !== binding.dimSessionId ||
          notice.params.source !== 'SessionStore' ||
          notice.params.kind !== 'title'
        )
          return
        void this.refresh(binding).catch((error) => this.options.failed?.(binding.sessionId, error))
      }
    )
    try {
      // The native owner subscribes before the initial metadata read. Titles are not Timeline facts.
      await client.call('session.attach', { sessionId: binding.dimSessionId })
      if (this.watches.get(binding.sessionId) !== watch)
        throw new Error('Native title watch was closed')
      await this.refresh(binding)
    } catch (error) {
      if (this.watches.get(binding.sessionId) === watch) this.watches.delete(binding.sessionId)
      if (this.lifetimes.get(binding.sessionId) === lifetime)
        this.lifetimes.delete(binding.sessionId)
      client.close()
      throw error
    }
  }

  async close(sessionId: string): Promise<void> {
    const watch = this.watches.get(sessionId)
    this.watches.delete(sessionId)
    this.lifetimes.delete(sessionId)
    watch?.client.close()
  }

  refresh(binding: DimSessionBinding): Promise<void> {
    const key = JSON.stringify([binding.sessionId, binding.dimSessionId, binding.generation])
    const existing = this.refreshing.get(key)
    if (existing) {
      existing.dirty = true
      return existing.promise
    }
    const pending = { dirty: false, promise: Promise.resolve() }
    const current = () => {
      const latest = this.options.database.dimSessionBindingsTable.get(binding.sessionId)
      return (
        latest?.dimSessionId === binding.dimSessionId &&
        latest.branchId === binding.branchId &&
        latest.generation === binding.generation &&
        !!this.options.database.newSessionsTable.get(binding.sessionId) &&
        !this.options.database.dimScopeChangesTable.get(binding.sessionId)
      )
    }
    pending.promise = Promise.resolve().then(async () => {
      try {
        do {
          pending.dirty = false
          if (!current()) return
          const metadata = await this.read(binding.dimSessionId)
          if (!current()) return
          if (pending.dirty) continue
          if (
            metadata.title &&
            this.options.database.newSessionsTable.get(binding.sessionId)?.title !==
              metadata.title.text
          )
            this.options.project(binding.sessionId, metadata.title.text)
        } while (pending.dirty)
      } finally {
        this.refreshing.delete(key)
      }
    })
    this.refreshing.set(key, pending)
    return pending.promise
  }

  async rename(sessionId: string, title: string): Promise<void> {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding || this.options.database.dimScopeChangesTable.get(sessionId))
      throw new Error('Native title has no current session owner')
    await new DimSessionControls(this.options.host).call(
      'rename',
      {
        sessionId: binding.dimSessionId,
        branchId: binding.branchId
      },
      { title }
    )
    const current = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (
      current?.dimSessionId !== binding.dimSessionId ||
      current.generation !== binding.generation ||
      this.options.database.dimScopeChangesTable.get(sessionId)
    )
      throw new Error('Native title owner changed during rename')
    await this.refresh(binding)
  }

  async seed(binding: DimSessionBinding, title: NativeTitle): Promise<void> {
    const owned = () => {
      const pending = this.options.database.dimScopeChangesTable.get(binding.sessionId)
      return (
        this.options.database.dimSessionScopesTable
          .list(binding.sessionId)
          .some(
            (scope) =>
              scope.dimSessionId === binding.dimSessionId &&
              scope.branchId === binding.branchId &&
              scope.generation === binding.generation
          ) ||
        (pending?.targetSessionId === binding.dimSessionId &&
          binding.branchId === 'main' &&
          pending.source.generation + 1 === binding.generation)
      )
    }
    if (!owned()) throw new Error('Migrated title has no native session owner')
    const client = await this.options.host.start()
    if (!owned()) throw new Error('Migrated title owner was revoked')
    await client.call('deepchat.storage.seed_title', {
      sessionId: binding.dimSessionId,
      title: { ...title }
    })
    if (!owned()) throw new Error('Migrated title owner was revoked')
  }

  async preserve(
    source: Pick<DimSessionBinding, 'dimSessionId'>,
    target: DimSessionBinding,
    change: DimHistoryChange
  ): Promise<void> {
    const title =
      change.kind === 'fork'
        ? {
            text: this.options.database.newSessionsTable.get(target.sessionId)?.title ?? '',
            source: 'manual' as const
          }
        : (await this.read(source.dimSessionId)).title
    if (title?.text) await this.seed(target, title)
  }

  private async read(sessionId: string): Promise<TitleScope> {
    const client = await this.options.host.start()
    const scope = await client.call<TitleScope>('deepchat.storage.scope', { sessionId })
    if (scope.sessionId !== sessionId || typeof scope.titleRevision !== 'string')
      throw new Error('Invalid native title scope')
    dimSequence(scope.titleRevision)
    if (
      scope.title &&
      (typeof scope.title.text !== 'string' ||
        !scope.title.text.trim() ||
        !['auto', 'manual'].includes(scope.title.source))
    )
      throw new Error('Invalid native title metadata')
    return scope
  }
}
