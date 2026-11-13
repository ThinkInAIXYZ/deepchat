import { createHash, randomUUID } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import { DimMethodError, type DimPluginClient } from './pluginClient'

export type DimMcpServer =
  | {
      type: 'stdio'
      command: string
      args: string[]
      env: Record<string, string>
    }
  | {
      type: 'http' | 'sse'
      url: string
      headers: Record<string, string>
    }

interface McpOptions {
  host: Pick<DimRuntimeSupervisor, 'start'>
  isCurrent(binding: DimSessionBinding): boolean
  // DeepChat resolves selection, environment bindings and credentials. No MCP transport or
  // execution handle crosses this port. The returned secrets live only in the native lease.
  resolve(binding: DimSessionBinding): Promise<Record<string, DimMcpServer>>
  failed(sessionId: string, error: unknown): void
}
interface Lease {
  binding: DimSessionBinding
  client: DimPluginClient
  id: string
  fingerprint: string
  timer?: ReturnType<typeof setTimeout>
}

/** Desktop selection and authorization feed dim's native Session MCP tool provider. */
export class DimMcp {
  private readonly leases = new Map<string, Lease>()
  private readonly lanes = new Map<string, Promise<unknown>>()
  private readonly epochs = new Map<string, object>()
  private stopped = false

  constructor(private readonly options: McpOptions) {}

  refresh(binding: DimSessionBinding): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Native MCP owner is closed'))
    let epoch = this.epochs.get(binding.sessionId)
    if (!epoch) this.epochs.set(binding.sessionId, (epoch = {}))
    return this.run(binding.sessionId, () => this.update(binding, epoch))
  }

  async close(sessionId: string): Promise<void> {
    this.epochs.delete(sessionId)
    const lease = this.leases.get(sessionId)
    if (lease?.timer) clearTimeout(lease.timer)
    await this.run(sessionId, () => this.detach(sessionId))
  }

  async stop(): Promise<void> {
    this.stopped = true
    const ids = new Set([...this.epochs.keys(), ...this.leases.keys(), ...this.lanes.keys()])
    await Promise.all([...ids].map((id) => this.close(id)))
  }

  private async update(binding: DimSessionBinding, epoch: object): Promise<void> {
    const current = () =>
      !this.stopped &&
      this.epochs.get(binding.sessionId) === epoch &&
      this.options.isCurrent(binding)
    if (!current()) {
      const stale = this.leases.get(binding.sessionId)
      if (
        stale?.binding.dimSessionId === binding.dimSessionId &&
        stale.binding.generation === binding.generation
      )
        await this.detach(binding.sessionId).catch(() => {})
      throw new Error('Native MCP belongs to a replaced session scope')
    }
    let lease = this.leases.get(binding.sessionId)
    if (lease?.timer) clearTimeout(lease.timer)
    try {
      const client = await this.options.host.start()
      const servers = await this.options.resolve(binding)
      if (!current()) throw new Error('Native MCP belongs to a replaced session scope')
      const fingerprint = createHash('sha256').update(canonical(servers)).digest('hex')
      if (
        lease &&
        (lease.client !== client ||
          lease.binding.dimSessionId !== binding.dimSessionId ||
          lease.binding.generation !== binding.generation ||
          lease.fingerprint !== fingerprint)
      ) {
        await this.detach(binding.sessionId, client)
        lease = undefined
      }
      if (!Object.keys(servers).length) return
      if (lease) {
        try {
          await client.call('session.mcp_temporary.renew', {
            sessionId: binding.dimSessionId,
            bindingId: lease.id
          })
        } catch (error) {
          // Only the native owner's explicit absent-lease answer permits rebuilding it.
          // An unknown outcome is surfaced; no tool invocation is ever retried here.
          if (!(error instanceof DimMethodError) || !isMissing(error.data)) throw error
          await this.detach(binding.sessionId)
          lease = undefined
        }
      }
      if (!lease) {
        lease = { binding, client, id: randomUUID(), fingerprint }
        this.leases.set(binding.sessionId, lease)
        await client.call(
          'session.mcp_temporary.attach',
          {
            sessionId: binding.dimSessionId,
            bindingId: lease.id,
            servers: servers as unknown as JsonValue
          },
          120_000
        )
      }
      if (!current()) throw new Error('Native MCP belongs to a replaced session scope')
      const retained = lease
      // dim owns the 30-second lease. This timer only renews desktop authorization; it never
      // schedules inputs, model calls or tools. A failed renewal removes the native catalog.
      lease.timer = setTimeout(() => {
        if (this.leases.get(binding.sessionId) !== retained) return
        void this.refresh(binding).catch((error) => {
          if (this.options.isCurrent(binding)) this.options.failed(binding.sessionId, error)
        })
      }, 10_000)
      lease.timer.unref()
    } catch (error) {
      await this.detach(binding.sessionId).catch(() => {})
      throw error
    }
  }

  private async detach(sessionId: string, client?: DimPluginClient): Promise<void> {
    const lease = this.leases.get(sessionId)
    if (!lease) return
    this.leases.delete(sessionId)
    if (lease.timer) clearTimeout(lease.timer)
    // Use the existing connection: closing a desktop session must not start a stopped host.
    await (client ?? lease.client).call('session.mcp_temporary.detach', {
      sessionId: lease.binding.dimSessionId,
      bindingId: lease.id
    })
  }

  private run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const task = (this.lanes.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(operation)
    this.lanes.set(sessionId, task)
    void task
      .finally(() => {
        if (this.lanes.get(sessionId) === task) this.lanes.delete(sessionId)
      })
      .catch(() => {})
    return task
  }
}

function isMissing(data: JsonValue | undefined): boolean {
  return (
    !!data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    data.appError === 'mcp_binding_missing'
  )
}
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
