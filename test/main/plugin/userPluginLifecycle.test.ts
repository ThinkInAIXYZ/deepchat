import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { UserPlugins, type UserPluginRecord, type UserPluginStore } from '@/plugin/userPlugins'
import { UserPluginHooks } from '@/plugin/userPluginHooks'
import { McpSettings } from '@/mcp/settings'
import { SecretStore } from '@/config/secretStore'
import { safeStorage } from 'electron'
import type { TapeAnchorAppendInput, DeepChatTapeEntryRow } from '@/tape/domain/entry'

vi.unmock('fs')
vi.unmock('node:fs')
vi.mock('electron-store', () => ({
  default: class {
    private data: Record<string, unknown>
    constructor(options: { defaults?: Record<string, unknown> }) {
      this.data = structuredClone(options.defaults ?? {})
    }
    get(key: string, fallback?: unknown) {
      return this.data[key] ?? fallback
    }
    set(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === 'string') this.data[key] = structuredClone(value)
      else Object.assign(this.data, structuredClone(key))
    }
    delete(key: string) {
      delete this.data[key]
    }
    has(key: string) {
      return key in this.data
    }
  }
}))

const temporary: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-plugin-lifecycle-'))
  temporary.push(root)
  const source = path.join(root, 'source')
  fs.mkdirSync(path.join(source, '.codex-plugin'), { recursive: true })
  fs.mkdirSync(path.join(source, 'skills/example'), { recursive: true })
  fs.writeFileSync(
    path.join(source, 'skills/example/SKILL.md'),
    '---\nname: example\ndescription: Example\n---\nExample instructions'
  )
  const manifest = (url: string) =>
    fs.writeFileSync(
      path.join(source, '.codex-plugin/plugin.json'),
      JSON.stringify({
        name: 'example',
        version: '1.0.0',
        skills: './skills',
        mcpServers: {
          remote: { url, bearer_token_env_var: 'EXAMPLE_PLUGIN_TOKEN' },
          local: { command: 'node', args: ['${PLUGIN_ROOT}/server.cjs'], cwd: '${PLUGIN_ROOT}' }
        }
      })
    )
  manifest('https://old.example/mcp')
  let records: UserPluginRecord[] = []
  let pending: ReturnType<UserPluginStore['pending']> = null
  const store: UserPluginStore = {
    read: () => structuredClone(records),
    write: (next) => {
      records = structuredClone(next)
    },
    pending: () => structuredClone(pending),
    writePending: (next) => {
      pending = structuredClone(next)
    }
  }
  const hooks = new UserPluginHooks({
    getTapeIncarnationId: () => 'test-incarnation',
    getBySession: () => [],
    appendAnchor: (_input: TapeAnchorAppendInput) => {
      throw new Error('Unexpected hook execution')
    }
  } as {
    getTapeIncarnationId: () => string
    getBySession: () => DeepChatTapeEntryRow[]
    appendAnchor: (input: TapeAnchorAppendInput) => DeepChatTapeEntryRow
  })
  const wrappedSecrets = new Map<string, string>()
  vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true)
  const secrets = new SecretStore({
    get: (key: string) => wrappedSecrets.get(key),
    set: (key: string, value: string) => wrappedSecrets.set(key, value),
    delete: (key: string) => wrappedSecrets.delete(key)
  } as never)
  const mcpSettings = new McpSettings(secrets)
  const skills = new Map<string, string>()
  const supervisor = {
    registerServer: vi.fn(),
    commitPluginRegistration: vi.fn(),
    reconcilePlugin: vi.fn(async () => undefined),
    unregisterPlugin: vi.fn(async () => undefined),
    getState: vi.fn(() => undefined)
  }
  const deps: ConstructorParameters<typeof UserPlugins>[0] = {
    root: path.join(root, 'plugins'),
    store,
    hooks,
    mcpSettings,
    supervisor,
    skillService: {
      registerPluginSkill: async (input) => {
        skills.set(input.id, input.ownerPluginId)
      },
      unregisterPluginSkillsByOwner: async (owner) => {
        for (const [name, id] of skills) if (id === owner) skills.delete(name)
      }
    },
    mcpService: {
      isReady: () => true,
      isServerRunning: async () => false,
      getServerLastError: () => undefined,
      revokeMcpAppsByServer: vi.fn()
    }
  }
  const service = new UserPlugins(deps)
  return {
    service,
    deps,
    root,
    source,
    manifest,
    store,
    hooks,
    mcpSettings,
    supervisor,
    skills,
    secrets,
    wrappedSecrets
  }
}

it('installs disabled, preserves host MCP identities across enable cycles, and removes only owned resources', async () => {
  const f = fixture()
  const inspected = await f.service.inspect({ kind: 'directory', path: f.source }, randomUUID())
  const installed = await f.service.install({
    operationId: inspected.operationId,
    selection: { skills: true, hooks: false, mcp: true }
  })
  expect(installed.ok).toBe(true)
  const id = installed.status!.id
  expect(installed.status).toMatchObject({ enabled: false, official: false, trusted: false })
  expect(f.skills.size).toBe(0)
  expect(
    Object.values(await f.mcpSettings.getMcpServers()).some((config) => config.ownerPluginId === id)
  ).toBe(false)
  expect((await f.service.enable(id)).ok).toBe(true)
  const key = `${id}.remote`
  const first = (await f.mcpSettings.getMcpServers())[key]
  expect(first.baseUrl).toBe('https://old.example/mcp')
  expect(first.customHeaders).toEqual({ Authorization: 'Bearer ${EXAMPLE_PLUGIN_TOKEN}' })
  expect((await f.mcpSettings.getMcpServers())[`${id}.local`].cwd).toContain(
    `/versions/${inspected.digest}`
  )
  expect(
    (await f.service.configureMcp(id, key, { EXAMPLE_PLUGIN_TOKEN: 'private-token' })).ok
  ).toBe(true)
  expect(JSON.stringify(f.store.read())).not.toContain('private-token')
  expect((await f.service.disable(id)).ok).toBe(true)
  expect(f.skills.size).toBe(0)
  expect((await f.service.enable(id)).ok).toBe(true)
  const current = (await f.mcpSettings.getMcpServers())[key]
  expect(current.serverId).toBe(first.serverId)
  expect(current.customHeaders).toEqual({ Authorization: 'Bearer ${EXAMPLE_PLUGIN_TOKEN}' })
  expect(f.mcpSettings.getMcpVariableBindings(current)).toEqual({
    EXAMPLE_PLUGIN_TOKEN: 'private-token'
  })
  expect(JSON.stringify(f.mcpSettings.getMigrationSnapshot())).not.toContain('private-token')
  expect(JSON.stringify([...f.wrappedSecrets.values()])).not.toContain('private-token')
  expect(
    (await f.service.configureMcp(id, key, { EXAMPLE_PLUGIN_TOKEN: 'rotated-token' })).ok
  ).toBe(true)
  expect(f.mcpSettings.getMcpVariableBindings(current)).toEqual({
    EXAMPLE_PLUGIN_TOKEN: 'rotated-token'
  })
  const unrelated = Object.entries(await f.mcpSettings.getMcpServers()).find(
    ([, config]) => !config.ownerPluginId
  )!
  expect((await f.service.uninstall(id)).ok).toBe(true)
  expect(
    Object.values(await f.mcpSettings.getMcpServers()).some((config) => config.ownerPluginId === id)
  ).toBe(false)
  expect((await f.mcpSettings.getMcpServers())[unrelated[0]]).toEqual(unrelated[1])
  expect(f.store.read()).toEqual([])
  expect(f.wrappedSecrets.size).toBe(0)
})

it('blocks active-turn updates and rolls failed publication back with the previous MCP setup', async () => {
  const f = fixture()
  const inspected = await f.service.inspect({ kind: 'directory', path: f.source }, randomUUID())
  const installed = await f.service.install({
    operationId: inspected.operationId,
    selection: { skills: true, hooks: false, mcp: true }
  })
  const id = installed.status!.id
  await f.service.enable(id)
  await f.service.configureMcp(id, `${id}.remote`, { EXAMPLE_PLUGIN_TOKEN: 'kept-secret' })
  f.manifest('https://new.example/mcp')
  const update = await f.service.inspect({ kind: 'directory', path: f.source }, randomUUID())
  f.hooks.beginRun('active-session')
  expect(
    (
      await f.service.install({
        operationId: update.operationId,
        pluginId: id,
        selection: { skills: true, hooks: false, mcp: true }
      })
    ).error
  ).toContain('active MioWork turns')
  f.hooks.endRun('active-session')
  f.supervisor.commitPluginRegistration.mockImplementationOnce(() => {
    throw new Error('Publication failed')
  })
  const failed = await f.service.install({
    operationId: update.operationId,
    pluginId: id,
    selection: { skills: true, hooks: false, mcp: true }
  })
  expect(failed.ok).toBe(false)
  expect((await f.service.get(id)).userPlugin?.digest).toBe(inspected.digest)
  expect((await f.mcpSettings.getMcpServers())[`${id}.remote`]).toMatchObject({
    baseUrl: 'https://old.example/mcp',
    customHeaders: { Authorization: 'Bearer ${EXAMPLE_PLUGIN_TOKEN}' }
  })
  expect(
    f.mcpSettings.getMcpVariableBindings((await f.mcpSettings.getMcpServers())[`${id}.remote`])
  ).toEqual({ EXAMPLE_PLUGIN_TOKEN: 'kept-secret' })
  expect(f.store.pending()).toBeNull()
  const success = await f.service.install({
    operationId: update.operationId,
    pluginId: id,
    selection: { skills: true, hooks: false, mcp: true }
  })
  expect(success.ok).toBe(true)
  expect((await f.mcpSettings.getMcpServers())[`${id}.remote`]).toMatchObject({
    baseUrl: 'https://new.example/mcp',
    customHeaders: { Authorization: 'Bearer ${EXAMPLE_PLUGIN_TOKEN}' }
  })
  expect(JSON.stringify(f.store.read())).not.toContain('kept-secret')
})

it('restores an interrupted update and lets a concurrent disable cancel publication', async () => {
  const f = fixture()
  const first = await f.service.inspect({ kind: 'directory', path: f.source }, randomUUID())
  const installed = await f.service.install({
    operationId: first.operationId,
    selection: { skills: true, hooks: false, mcp: true }
  })
  const id = installed.status!.id
  await f.service.enable(id)
  await f.service.configureMcp(id, `${id}.remote`, { EXAMPLE_PLUGIN_TOKEN: 'recovered-secret' })
  const previous = f.store.read()[0]
  await f.mcpSettings.preparePluginUpdate(id)
  await f.mcpSettings.updateMcpServer(`${id}.remote`, {
    baseUrl: 'https://interrupted.example/mcp'
  })
  f.store.writePending({ previous, next: { ...previous, digest: 'f'.repeat(64) } })
  const recovered = new UserPlugins(f.deps)
  await recovered.initialize()
  expect(f.store.pending()).toBeNull()
  expect((await f.mcpSettings.getMcpServers())[`${id}.remote`]).toMatchObject({
    baseUrl: 'https://old.example/mcp',
    customHeaders: { Authorization: 'Bearer ${EXAMPLE_PLUGIN_TOKEN}' }
  })
  expect(
    f.mcpSettings.getMcpVariableBindings((await f.mcpSettings.getMcpServers())[`${id}.remote`])
  ).toEqual({ EXAMPLE_PLUGIN_TOKEN: 'recovered-secret' })
  f.manifest('https://new.example/mcp')
  const update = await recovered.inspect({ kind: 'directory', path: f.source }, randomUUID())
  let disable: Promise<unknown> | undefined
  const register = f.deps.skillService.registerPluginSkill
  f.deps.skillService.registerPluginSkill = async (input) => {
    await register(input)
    disable = recovered.disable(id)
  }
  const applied = await recovered.install({
    operationId: update.operationId,
    pluginId: id,
    selection: { skills: true, hooks: false, mcp: true }
  })
  await disable
  expect(applied.ok).toBe(false)
  expect(f.store.pending()).toBeNull()
  expect((await recovered.get(id)).enabled).toBe(false)
  expect(f.skills.size).toBe(0)
  expect(
    Object.values(await f.mcpSettings.getMcpServers())
      .filter((config) => config.ownerPluginId === id)
      .every((config) => !config.enabled)
  ).toBe(true)
})

it.each(['publication', 'cleanup', 'rollback cleanup'])(
  'releases the update lock when %s and rollback both fail',
  async (failure) => {
    const f = fixture()
    const inspected = await f.service.inspect({ kind: 'directory', path: f.source }, randomUUID())
    const installed = await f.service.install({
      operationId: inspected.operationId,
      selection: { skills: true, hooks: false, mcp: true }
    })
    const id = installed.status!.id
    await f.service.enable(id)
    await f.service.configureMcp(id, `${id}.remote`, { EXAMPLE_PLUGIN_TOKEN: 'rollback-secret' })
    f.manifest('https://new.example/mcp')
    const update = await f.service.inspect({ kind: 'directory', path: f.source }, randomUUID())
    const failing =
      failure === 'publication'
        ? f.supervisor.commitPluginRegistration
        : f.supervisor.unregisterPlugin
    const fail = () => {
      throw new Error('Persistent runtime failure')
    }
    if (failure === 'rollback cleanup') {
      f.supervisor.commitPluginRegistration.mockImplementationOnce(() => {
        f.wrappedSecrets.clear()
        f.supervisor.unregisterPlugin.mockImplementation(fail)
        throw new Error('Publication failed')
      })
    } else failing.mockImplementation(fail)
    const result = await f.service.install({
      operationId: update.operationId,
      pluginId: id,
      selection: { skills: true, hooks: false, mcp: true }
    })
    expect(result.ok).toBe(false)
    expect(f.store.pending()).toBeNull()
    expect((await f.service.get(id)).enabled).toBe(false)
    expect(f.skills.size).toBe(0)
    const restored = (await f.mcpSettings.getMcpServers())[`${id}.remote`]
    expect(restored).toMatchObject({ enabled: false, baseUrl: 'https://old.example/mcp' })
    expect(f.mcpSettings.getMcpVariableBindings(restored)).toEqual({
      EXAMPLE_PLUGIN_TOKEN: 'rollback-secret'
    })
    failing.mockReset()
    const unrelated = await f.service.inspect({ kind: 'directory', path: f.source }, randomUUID())
    expect(
      (
        await f.service.install({
          operationId: unrelated.operationId,
          selection: { skills: false, hooks: false, mcp: true }
        })
      ).ok
    ).toBe(true)
  }
)

it('clears interrupted-update state even when restoring MCP settings fails', async () => {
  const f = fixture()
  const inspected = await f.service.inspect({ kind: 'directory', path: f.source }, randomUUID())
  const installed = await f.service.install({
    operationId: inspected.operationId,
    selection: { skills: true, hooks: false, mcp: true }
  })
  await f.service.enable(installed.status!.id)
  const previous = f.store.read()[0]
  f.store.writePending({ previous, next: { ...previous, digest: 'f'.repeat(64) } })
  vi.spyOn(f.mcpSettings, 'restorePluginUpdate').mockRejectedValue(new Error('Restore failed'))
  const recovered = new UserPlugins(f.deps)
  await recovered.initialize()
  expect(f.store.pending()).toBeNull()
  expect((await recovered.get(previous.pluginId)).enabled).toBe(false)
  await new UserPlugins(f.deps).initialize()
  expect(f.store.pending()).toBeNull()
})
