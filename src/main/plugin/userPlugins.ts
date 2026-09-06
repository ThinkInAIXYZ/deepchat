import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MCPServerConfig, McpServicePort } from '@shared/types/mcp'
import type { SkillServicePort } from '@shared/types/skill'
import type { PluginActionResult, PluginListItem } from '@shared/types/plugin'
import type {
  PreparedUserPlugin,
  UserPluginInstallInput,
  UserPluginPackage,
  UserPluginSelection,
  UserPluginSource
} from '@shared/types/userPlugin'
import type { McpSettings } from '@/mcp/settings'
import type { PluginRuntimeSupervisor } from './runtimeSupervisor'
import { UserPluginSources, snapshotPluginTree } from './userPluginSource'
import { UserPluginHooks } from './userPluginHooks'
import { pluginRelativePath } from './userPluginPackage'

export interface UserPluginRecord {
  pluginId: string
  digest: string
  source: UserPluginSource
  package: UserPluginPackage
  selection: UserPluginSelection
  enabled: boolean
  previousDigest?: string
  installedAt: number
  updatedAt: number
  error?: string
  mcpDigests: Record<string, string>
}

export interface UserPluginStore {
  read(): UserPluginRecord[]
  write(records: UserPluginRecord[]): void
  pending(): { previous: UserPluginRecord; next: UserPluginRecord } | null
  writePending(operation: { previous: UserPluginRecord; next: UserPluginRecord } | null): void
}

interface UserPluginDependencies {
  root: string
  store: UserPluginStore
  hooks: UserPluginHooks
  skillService: Pick<SkillServicePort, 'registerPluginSkill' | 'unregisterPluginSkillsByOwner'>
  mcpSettings: Pick<
    McpSettings,
    | 'getMcpServers'
    | 'addMcpServer'
    | 'updateMcpServer'
    | 'removeMcpServer'
    | 'preparePluginUpdate'
    | 'restorePluginUpdate'
    | 'commitPluginUpdate'
  >
  mcpService: Pick<McpServicePort, 'isReady' | 'isServerRunning' | 'getServerLastError'> & {
    revokeMcpAppsByServer?(serverId: string): void
  }
  supervisor: Pick<
    PluginRuntimeSupervisor,
    | 'registerServer'
    | 'commitPluginRegistration'
    | 'reconcilePlugin'
    | 'unregisterPlugin'
    | 'getState'
  >
}

export class UserPlugins {
  readonly sources: UserPluginSources
  private mutation: Promise<unknown> = Promise.resolve()
  private readonly revoked = new Set<string>()

  constructor(private readonly deps: UserPluginDependencies) {
    this.sources = new UserPluginSources(deps.root)
  }

  private record(pluginId: string): UserPluginRecord {
    const record = this.deps.store.read().find((item) => item.pluginId === pluginId)
    if (!record) throw new Error('User plugin is not installed')
    return record
  }

  has(pluginId: string): boolean {
    return this.deps.store.read().some((item) => item.pluginId === pluginId)
  }

  private save(record: UserPluginRecord): void {
    this.deps.store.write([
      ...this.deps.store.read().filter((item) => item.pluginId !== record.pluginId),
      record
    ])
  }

  private root(record: UserPluginRecord): string {
    if (!/^user\.[a-f0-9-]{36}$/.test(record.pluginId) || !/^[a-f0-9]{64}$/.test(record.digest))
      throw new Error('Invalid installed plugin identity')
    return path.join(this.deps.root, 'user', record.pluginId.slice(5), 'versions', record.digest)
  }

  private data(record: UserPluginRecord): string {
    return path.join(this.root(record), '..', '..', 'data')
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.mutation.then(work)
    this.mutation = operation.catch(() => undefined)
    return operation
  }

  async initialize(): Promise<void> {
    await this.sources.cleanupInterrupted()
    const pending = this.deps.store.pending()
    if (pending) {
      try {
        // Publication was interrupted. Restore the complete prior revision before any execution.
        await this.deps.mcpSettings.restorePluginUpdate(pending.previous.pluginId)
        this.save({
          ...pending.previous,
          error: 'An interrupted update was rolled back; inspect and apply the update again'
        })
        this.deps.store.writePending(null)
        this.deps.mcpSettings.commitPluginUpdate(pending.previous.pluginId)
      } catch (error) {
        this.save({
          ...pending.previous,
          enabled: false,
          error: `Plugin update recovery failed: ${error instanceof Error ? error.message : String(error)}`
        })
      }
    }
    for (const record of this.deps.store.read()) {
      try {
        await this.deactivate(record, false)
        if (record.enabled && this.deps.store.pending()?.previous.pluginId !== record.pluginId)
          await this.activate(record)
      } catch (error) {
        this.save({ ...record, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  inspect(source: UserPluginSource, requestId: string): Promise<PreparedUserPlugin> {
    return this.sources.inspect(source, requestId)
  }

  install(input: UserPluginInstallInput): Promise<PluginActionResult> {
    return this.result(async () => {
      if (this.deps.store.pending())
        throw new Error(
          'Restart DeepChat to recover the interrupted plugin update before applying another change'
        )
      const finishUpdate = input.pluginId ? this.deps.hooks.beginUpdate() : () => undefined
      try {
        const prepared = this.sources.get(input.operationId)
        if (
          !(input.selection.skills && prepared.package.skills.length) &&
          !(input.selection.hooks && prepared.package.hooks.length) &&
          !(input.selection.mcp && prepared.package.mcpServers.length)
        )
          throw new Error('Select at least one supported plugin capability')
        const previous = input.pluginId ? this.record(input.pluginId) : undefined
        const record: UserPluginRecord = {
          pluginId: previous?.pluginId ?? `user.${randomUUID()}`,
          digest: prepared.digest,
          source: prepared.source,
          package: prepared.package,
          selection: input.selection,
          enabled: previous?.enabled ?? false,
          previousDigest: previous?.digest,
          installedAt: previous?.installedAt ?? Date.now(),
          updatedAt: Date.now(),
          mcpDigests: { ...previous?.mcpDigests }
        }
        if ((await snapshotPluginTree(prepared.root)) !== prepared.digest)
          throw new Error('Prepared plugin changed; inspect the source again')
        const target = this.root(record)
        await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
        let validTarget = false
        if (fs.existsSync(target)) {
          try {
            validTarget = (await snapshotPluginTree(target)) === record.digest
          } catch {
            /* Repair only inactive snapshots below. */
          }
          if (!validTarget && previous?.enabled && previous.digest === record.digest)
            throw new Error('Disable the plugin before repairing its corrupted snapshot')
        }
        if (!validTarget) {
          const publishing = path.join(path.dirname(target), `.publishing-${randomUUID()}`)
          try {
            if ((await snapshotPluginTree(prepared.root, publishing)) !== record.digest)
              throw new Error('Plugin changed while publishing its snapshot')
            await fs.promises.rm(target, { recursive: true, force: true })
            await fs.promises.rename(publishing, target)
          } finally {
            await fs.promises.rm(publishing, { recursive: true, force: true })
          }
        }
        await fs.promises.mkdir(this.data(record), { recursive: true, mode: 0o700 })
        if (previous) {
          await this.deps.mcpSettings.preparePluginUpdate(previous.pluginId)
          this.deps.store.writePending({ previous, next: record })
        }
        try {
          if (previous) {
            await this.deactivate(previous, false)
            await this.deactivate(record, false)
          }
          this.save(record)
          if (record.enabled) await this.activate(record)
          this.save(record)
          this.deps.store.writePending(null)
        } catch (error) {
          await this.deactivate(record, false)
          if (previous) {
            await this.deps.mcpSettings.restorePluginUpdate(previous.pluginId)
            const restored = {
              ...previous,
              enabled: previous.enabled && !this.revoked.has(previous.pluginId)
            }
            this.save(restored)
            if (restored.enabled) await this.activate(restored)
          } else this.save({ ...record, enabled: false })
          this.deps.store.writePending(null)
          throw error
        }
        if (previous) this.deps.mcpSettings.commitPluginUpdate(previous.pluginId)
        await this.pruneVersions(record)
        await this.sources.discard(input.operationId)
        return record.pluginId
      } finally {
        finishUpdate()
      }
    })
  }

  enable(pluginId: string): Promise<PluginActionResult> {
    return this.result(async () => {
      if (this.deps.store.pending())
        throw new Error(
          'Restart DeepChat to recover the interrupted plugin update before enabling plugins'
        )
      const record = this.record(pluginId)
      this.revoked.delete(pluginId)
      await this.deactivate(record, false)
      try {
        await this.activate(record)
        this.save({ ...record, enabled: true, error: undefined, updatedAt: Date.now() })
      } catch (error) {
        await this.deactivate(record, false)
        this.save({
          ...record,
          enabled: false,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
      return pluginId
    })
  }

  disable(pluginId: string): Promise<PluginActionResult> {
    // Revoke context and in-flight command eligibility synchronously, ahead of queued cleanup.
    this.revoked.add(pluginId)
    this.deps.hooks.unregister(pluginId)
    return this.result(async () => {
      const record = this.record(pluginId)
      const pending = this.deps.store.pending()
      if (pending?.previous.pluginId === pluginId)
        this.deps.store.writePending({
          previous: { ...pending.previous, enabled: false },
          next: { ...pending.next, enabled: false }
        })
      this.save({ ...record, enabled: false, updatedAt: Date.now() })
      await this.deactivate(record, false)
      return pluginId
    })
  }

  uninstall(pluginId: string): Promise<PluginActionResult> {
    this.revoked.add(pluginId)
    this.deps.hooks.unregister(pluginId)
    return this.result(async () => {
      const record = this.record(pluginId)
      this.save({ ...record, enabled: false })
      await this.deactivate(record, true)
      if (this.deps.store.pending()?.previous.pluginId === pluginId)
        this.deps.store.writePending(null)
      this.deps.mcpSettings.commitPluginUpdate(pluginId)
      this.deps.store.write(this.deps.store.read().filter((item) => item.pluginId !== pluginId))
      await fs.promises.rm(path.join(this.root(record), '..', '..'), {
        recursive: true,
        force: true
      })
      return undefined
    })
  }

  private async pruneVersions(record: UserPluginRecord): Promise<void> {
    const directory = path.dirname(this.root(record))
    for (const entry of await fs.promises.readdir(directory)) {
      if (entry === record.digest || entry === record.previousDigest) continue
      if (/^[a-f0-9]{64}$/.test(entry) || /^\.publishing-[a-f0-9-]{36}$/.test(entry))
        await fs.promises.rm(path.join(directory, entry), { recursive: true, force: true })
    }
  }

  private async activate(record: UserPluginRecord): Promise<void> {
    const assertEnabled = () => {
      if (this.revoked.has(record.pluginId))
        throw new Error('Plugin activation was cancelled by disable or uninstall')
    }
    assertEnabled()
    const root = this.root(record)
    if ((await snapshotPluginTree(root)) !== record.digest)
      throw new Error('Plugin snapshot integrity check failed; reinstall or inspect an update')
    const registered: string[] = []
    try {
      if (record.selection.skills)
        for (const skill of record.package.skills) {
          await this.deps.skillService.registerPluginSkill({
            ownerPluginId: record.pluginId,
            id: skill.name,
            skillRoot: pluginRelativePath(root, skill.path),
            pluginRoot: root
          })
        }
      if (record.selection.mcp) {
        const existing = await this.deps.mcpSettings.getMcpServers()
        for (const server of record.package.mcpServers) {
          const key = `${record.pluginId}.${server.name}`
          const current = existing[key]
          if (current && current.ownerPluginId !== record.pluginId)
            throw new Error(`MCP server belongs to another owner: ${key}`)
          const variables: Record<string, string> = {
            PLUGIN_ROOT: root,
            CLAUDE_PLUGIN_ROOT: root,
            PLUGIN_DATA: this.data(record),
            CLAUDE_PLUGIN_DATA: this.data(record)
          }
          const expand = (value: string) =>
            value.replace(
              /\$\{(PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT|PLUGIN_DATA|CLAUDE_PLUGIN_DATA)\}/g,
              (_all, name: string) => variables[name]
            )
          const config: MCPServerConfig =
            record.mcpDigests[key] === record.digest && current
              ? { ...current, enabled: false }
              : {
                  type: server.type,
                  authorization: undefined,
                  command: expand(server.command ?? ''),
                  args: (server.args ?? []).map(expand),
                  env: {
                    ...Object.fromEntries(
                      Object.entries(server.env ?? {}).map(([name, value]) => [name, expand(value)])
                    ),
                    ...variables,
                    DEEPCHAT_PLUGIN_ID: record.pluginId
                  },
                  cwd:
                    server.type === 'stdio' ? (server.cwd ? expand(server.cwd) : root) : undefined,
                  baseUrl: server.url,
                  customHeaders: Object.fromEntries(
                    Object.entries(server.headers ?? {}).map(([name, value]) => [
                      name,
                      expand(value)
                    ])
                  ),
                  environmentVariables: server.requiredVariables,
                  inheritEnv: 'minimal',
                  descriptions: `${record.package.name}: ${server.name}`,
                  icons: 'plugin',
                  enabled: false,
                  disable: false,
                  source: 'plugin',
                  sourceId: record.pluginId,
                  ownerPluginId: record.pluginId
                }
          if (config.cwd && !path.isAbsolute(config.cwd) && !config.cwd.includes('${'))
            config.cwd = pluginRelativePath(root, config.cwd)
          if (current?.serverId) this.deps.mcpService.revokeMcpAppsByServer?.(current.serverId)
          if (current) await this.deps.mcpSettings.updateMcpServer(key, config)
          else await this.deps.mcpSettings.addMcpServer(key, config)
          record.mcpDigests[key] = record.digest
          this.deps.supervisor.registerServer(
            {
              pluginId: record.pluginId,
              serverName: key,
              displayName: server.name,
              startMode: 'eager',
              surfaces: ['tools', 'prompts', 'resources']
            },
            { ready: false }
          )
          registered.push(key)
        }
      }
      assertEnabled()
      this.deps.supervisor.commitPluginRegistration(record.pluginId)
      if (record.selection.hooks && record.package.hooks.length)
        this.deps.hooks.register({
          pluginId: record.pluginId,
          digest: record.digest,
          root,
          data: this.data(record),
          hooks: record.package.hooks,
          verify: async (signal) => {
            if ((await snapshotPluginTree(root, undefined, signal)) !== record.digest) {
              this.deps.hooks.unregister(record.pluginId)
              throw new Error('Plugin snapshot changed; hook authorization is no longer valid')
            }
          }
        })
      // Connection failures remain component diagnostics; they do not discard enabled intent.
      if (registered.length && this.deps.mcpService.isReady())
        await this.deps.supervisor.reconcilePlugin(record.pluginId).catch(() => undefined)
      assertEnabled()
    } catch (error) {
      await this.deactivate(record, false)
      throw error
    }
  }

  private async deactivate(record: UserPluginRecord, remove: boolean): Promise<void> {
    this.deps.hooks.unregister(record.pluginId)
    let stopError: unknown
    try {
      await this.deps.supervisor.unregisterPlugin(record.pluginId)
    } catch (error) {
      stopError = error
    }
    await this.deps.skillService.unregisterPluginSkillsByOwner(record.pluginId, {
      preserveAssignments: !remove
    })
    const servers = await this.deps.mcpSettings.getMcpServers()
    for (const [name, server] of Object.entries(servers)) {
      if (server.ownerPluginId !== record.pluginId) continue
      if (server.serverId) this.deps.mcpService.revokeMcpAppsByServer?.(server.serverId)
      if (
        remove ||
        !record.package.mcpServers.some((item) => name === `${record.pluginId}.${item.name}`)
      )
        await this.deps.mcpSettings.removeMcpServer(name)
      else await this.deps.mcpSettings.updateMcpServer(name, { enabled: false })
    }
    if (stopError) throw stopError
  }

  async list(): Promise<PluginListItem[]> {
    return await Promise.all(this.deps.store.read().map((record) => this.item(record)))
  }
  async get(pluginId: string): Promise<PluginListItem> {
    return await this.item(this.record(pluginId))
  }

  private async item(record: UserPluginRecord): Promise<PluginListItem> {
    const configs = await this.deps.mcpSettings.getMcpServers()
    const setup: Record<string, string[]> = {}
    const mcpServers = await Promise.all(
      record.package.mcpServers.map(async (server) => {
        const key = `${record.pluginId}.${server.name}`
        const config = configs[key]
        const unresolved = JSON.stringify(config ?? server)
        setup[key] = server.requiredVariables.filter(
          (name) =>
            !process.env[name] &&
            (unresolved.includes(`\${${name}}`) || unresolved.includes(`\${env:${name}}`))
        )
        const state = this.deps.supervisor.getState(key)
        return {
          serverId: key,
          enabled: Boolean(record.enabled && record.selection.mcp),
          running: await this.deps.mcpService.isServerRunning(key),
          lifecycleState: state?.state,
          lastError: this.deps.mcpService.getServerLastError(key) ?? undefined
        }
      })
    )
    return {
      id: record.pluginId,
      name: record.package.name,
      version: record.package.version,
      publisher: record.package.publisher,
      installed: true,
      enabled: record.enabled,
      trusted: false,
      trustState: 'untrusted',
      official: false,
      capabilities: [
        ...(record.package.skills.length ? ['skills.register' as const] : []),
        ...(record.package.hooks.length ? ['process.execDeclared' as const] : []),
        ...(record.package.mcpServers.length ? ['mcp.register' as const] : [])
      ],
      activationError: record.error,
      mcpServers,
      userPlugin: {
        source: record.source,
        digest: record.digest,
        package: record.package,
        selection: record.selection,
        previousDigest: record.previousDigest,
        setup,
        diagnostics: this.deps.hooks.diagnostics(record.pluginId)
      }
    }
  }

  configureMcp(
    pluginId: string,
    serverName: string,
    values: Record<string, string>
  ): Promise<PluginActionResult> {
    return this.result(async () => {
      if (this.deps.store.pending())
        throw new Error(
          'Restart DeepChat to recover the interrupted plugin update before changing MCP configuration'
        )
      const record = this.record(pluginId)
      const declared = record.package.mcpServers.find(
        (server) => `${pluginId}.${server.name}` === serverName
      )
      const current = (await this.deps.mcpSettings.getMcpServers())[serverName]
      if (!declared || current?.ownerPluginId !== pluginId)
        throw new Error('MCP configuration is unavailable; enable the plugin first')
      if (Object.keys(values).some((name) => !declared.requiredVariables.includes(name)))
        throw new Error('Undeclared MCP variable')
      const expand = (value: string) =>
        value.replace(
          /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g,
          (match, name: string) => values[name] ?? match
        )
      await this.deps.supervisor.unregisterPlugin(pluginId)
      if (current.serverId) this.deps.mcpService.revokeMcpAppsByServer?.(current.serverId)
      await this.deps.mcpSettings.updateMcpServer(serverName, {
        command: expand(current.command),
        args: current.args.map(expand),
        cwd: current.cwd ? expand(current.cwd) : undefined,
        baseUrl: current.baseUrl ? expand(current.baseUrl) : undefined,
        env: Object.fromEntries(
          Object.entries(current.env).map(([name, value]) => [
            name,
            typeof value === 'string' ? expand(value) : value
          ])
        ),
        customHeaders: Object.fromEntries(
          Object.entries(current.customHeaders ?? {}).map(([name, value]) => [name, expand(value)])
        )
      })
      if (record.enabled) await this.activate(record)
      return pluginId
    })
  }

  private result(work: () => Promise<string | undefined>): Promise<PluginActionResult> {
    return this.serialized(async () => {
      try {
        const id = await work()
        return { ok: true, ...(id ? { status: await this.get(id) } : {}) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  shutdown(): void {
    this.sources.shutdown()
    for (const record of this.deps.store.read()) this.deps.hooks.unregister(record.pluginId)
  }
}
