import { createMinimalProcessEnvironment } from '@/mcp/processEnvironment'
import type {
  UserPluginHook,
  UserPluginHookDiagnostic,
  UserPluginHookSource
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

/** Product registry and update fences; dim owns command execution and audit. */
export class UserPluginHooks {
  private readonly owners = new Map<string, HookOwner>()
  private activeRuns = new Map<string, number>()
  private updating = false
  private native?: {
    diagnostics(pluginId: string): Promise<UserPluginHookDiagnostic[]>
    retry(pluginId: string, invocationId: string): Promise<void>
  }

  useNative(runtime: NonNullable<UserPluginHooks['native']>): void {
    this.native = runtime
  }

  async readDiagnostics(pluginId: string): Promise<UserPluginHookDiagnostic[]> {
    return this.native ? this.native.diagnostics(pluginId) : []
  }

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

  /** Verified configuration only; the native plugin owns execution and its audit. */
  async nativeSources(signal: AbortSignal): Promise<UserPluginHookSource[]> {
    const sources: UserPluginHookSource[] = []
    // Pin registry membership across asynchronous verification.
    const owners = [...this.owners.values()]
    for (const owner of owners) {
      const active = AbortSignal.any([signal, owner.controller.signal])
      active.throwIfAborted()
      await owner.verify?.(active)
      active.throwIfAborted()
      if (this.owners.get(owner.pluginId) !== owner)
        throw new Error('Plugin hook configuration changed during admission')
      sources.push({
        pluginId: owner.pluginId,
        digest: owner.digest,
        root: owner.root,
        data: owner.data,
        environment: this.environment(),
        hooks: owner.hooks.map((hook) => ({ ...hook }))
      })
    }
    signal.throwIfAborted()
    return sources
  }

  async retry(pluginId: string, invocationId: string): Promise<void> {
    if (!this.native) throw new Error('Native plugin hooks are unavailable')
    if (this.activeRuns.size || this.updating)
      throw new Error('Finish active turns and plugin updates before retrying a hook')
    return this.native.retry(pluginId, invocationId)
  }
}
