import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { UserPluginSources, snapshotPluginTree } from '@/plugin/userPluginSource'
import { readUserPluginPackage } from '@/plugin/userPluginPackage'
import { UserPluginHooks } from '@/plugin/userPluginHooks'
import { resolveMcpEnvironmentBinding } from '@/mcp/environmentBindings'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, default: actual }
})

it('returns verified native hook configuration and rejects a revoked owner', async () => {
  const hooks = new UserPluginHooks()
  let release: (() => void) | undefined
  hooks.register({
    pluginId: 'native',
    digest: 'first',
    root: '/plugin',
    data: '/data',
    hooks: [],
    verify: () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  })
  const reading = hooks.nativeSources(new AbortController().signal)
  hooks.unregister('native')
  release!()
  await expect(reading).rejects.toThrow()
  hooks.register({
    pluginId: 'native',
    digest: 'second',
    root: '/plugin',
    data: '/data',
    hooks: []
  })
  expect(await hooks.nativeSources(new AbortController().signal)).toMatchObject([
    { pluginId: 'native', digest: 'second', root: '/plugin', data: '/data', hooks: [] }
  ])
})

const temporary: string[] = []
function directory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-user-plugin-'))
  temporary.push(root)
  return root
}
function write(root: string, relative: string, content: string) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}
function fixture(manifest: Record<string, unknown> = {}) {
  const root = directory()
  write(
    root,
    '.codex-plugin/plugin.json',
    JSON.stringify({ name: 'portable', version: '1.0.0', ...manifest })
  )
  return root
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('portable plugin package contract', () => {
  it('rejects executable Skill metadata during inspection without evaluating it', async () => {
    const root = fixture({ skills: './skills' })
    write(
      root,
      'skills/unsafe/SKILL.md',
      '---js\n(globalThis.deepchatPluginInspectionExecuted = true, {name: "unsafe", description: "Unsafe"})\n---\nBody'
    )
    const host = new UserPluginSources(directory())
    await expect(host.inspect({ kind: 'directory', path: root }, randomUUID())).rejects.toThrow(
      'JavaScript front matter'
    )
    expect(Reflect.get(globalThis, 'deepchatPluginInspectionExecuted')).toBeUndefined()
  })

  it.each([
    ['https://example.com/mcp', true],
    ['http://localhost:8080/mcp', true],
    ['http://127.0.0.1:8080/mcp', true],
    ['http://[::1]:8080/mcp', true],
    ['http://example.com/mcp', false],
    ['http://localhost.example.com/mcp', false]
  ])('enforces encrypted remote MCP transport for %s', (url, allowed) => {
    const root = fixture({ mcpServers: { remote: { url } } })
    if (allowed) expect(readUserPluginPackage(root).mcpServers).toHaveLength(1)
    else expect(() => readUserPluginPackage(root)).toThrow('Invalid MCP URL')
  })

  it('reads Codex metadata, existing Skills and direct/wrapped MCP configurations without executing commands', () => {
    const root = fixture({ skills: './skills/', hooks: './hooks.json' })
    write(root, 'plugin.json', JSON.stringify({ name: 'wrong-host' }))
    write(
      root,
      'skills/example/SKILL.md',
      '---\nname: example\ndescription: Example skill\n---\nUse the example.'
    )
    write(
      root,
      'hooks.json',
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'do-not-run' }] }],
          PreToolUse: []
        }
      })
    )
    for (const wrapper of ['', 'mcp_servers', 'mcpServers']) {
      const servers = {
        local: {
          command: 'node',
          args: ['${PLUGIN_ROOT}/server.cjs'],
          cwd: '${PLUGIN_ROOT}',
          env_vars: ['FORWARDED_TOKEN']
        },
        remote: { url: 'https://example.com/mcp', bearer_token_env_var: 'EXAMPLE_TOKEN' }
      }
      write(root, '.mcp.json', JSON.stringify(wrapper ? { [wrapper]: servers } : servers))
      const parsed = readUserPluginPackage(root)
      expect(parsed.name).toBe('portable')
      expect(parsed.skills.map((skill) => skill.name)).toEqual(['example'])
      expect(parsed.hooks[0].command).toBe('do-not-run')
      expect(parsed.findings).toContain('Unsupported hook event: PreToolUse')
      expect(parsed.mcpServers[0].env).toEqual({ FORWARDED_TOKEN: '${FORWARDED_TOKEN}' })
      expect(parsed.mcpServers[1].headers).toEqual({ Authorization: 'Bearer ${EXAMPLE_TOKEN}' })
      expect(parsed.mcpServers[1].requiredVariables).toEqual(['EXAMPLE_TOKEN'])
    }
  })

  it('does not weaken MCP restrictions or accept unsafe paths and matchers', () => {
    const root = fixture({
      mcpServers: { restricted: { command: 'node', enabled_tools: ['read'] } }
    })
    expect(readUserPluginPackage(root).mcpServers).toEqual([])
    write(root, '.codex-plugin/plugin.json', JSON.stringify({ name: 'bad', skills: '../outside' }))
    expect(() => readUserPluginPackage(root)).toThrow('Invalid plugin path')
    write(
      root,
      '.codex-plugin/plugin.json',
      JSON.stringify({
        name: 'bad',
        hooks: { hooks: { SessionStart: [{ matcher: '(a+)+', hooks: [] }] } }
      })
    )
    expect(() => readUserPluginPackage(root)).toThrow('Unsafe hook matcher')
  })

  it('binds inspection to a private snapshot and rejects links and archive traversal', async () => {
    const root = fixture()
    const host = new UserPluginSources(directory())
    const prepared = await host.inspect({ kind: 'directory', path: root }, randomUUID())
    write(root, '.codex-plugin/plugin.json', JSON.stringify({ name: 'changed' }))
    expect(await snapshotPluginTree(host.get(prepared.operationId).root)).toBe(prepared.digest)
    expect(host.get(prepared.operationId).package.name).toBe('portable')
    await host.discard(prepared.operationId)
    expect(() => host.get(prepared.operationId)).toThrow('expired')
    fs.symlinkSync(os.tmpdir(), path.join(root, 'escape'))
    await expect(host.inspect({ kind: 'directory', path: root }, randomUUID())).rejects.toThrow(
      'file kind'
    )
    const archive = path.join(directory(), 'unsafe.zip')
    fs.writeFileSync(archive, zipSync({ '../escape': Buffer.from('unsafe') }))
    await expect(host.inspect({ kind: 'zip', path: archive }, randomUUID())).rejects.toThrow(
      'invalid path'
    )
  })

  it('accepts an enclosing ZIP folder and rejects symlink ZIP attributes', async () => {
    const archive = path.join(directory(), 'plugin.zip')
    const zip = Buffer.from(
      zipSync({ 'wrapper/.codex-plugin/plugin.json': Buffer.from('{"name":"zip-plugin"}') })
    )
    const firstCentral = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    zip.writeUInt32LE((0o100700 << 16) >>> 0, firstCentral + 38)
    fs.writeFileSync(archive, zip)
    const host = new UserPluginSources(directory())
    const prepared = await host.inspect({ kind: 'zip', path: archive }, randomUUID())
    expect(prepared.package.name).toBe('zip-plugin')
    if (process.platform !== 'win32')
      expect(
        fs.statSync(path.join(host.get(prepared.operationId).root, '.codex-plugin/plugin.json'))
          .mode & 0o111
      ).not.toBe(0)
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    zip.writeUInt32LE((0o120777 << 16) >>> 0, central + 38)
    fs.writeFileSync(archive, zip)
    await expect(host.inspect({ kind: 'zip', path: archive }, randomUUID())).rejects.toThrow(
      'links and special files'
    )
  })
})

it('resolves only named MCP environment bindings without modifying stored configuration', () => {
  const configured = 'Bearer ${TOKEN}'
  expect(resolveMcpEnvironmentBinding(configured, ['TOKEN'], { TOKEN: 'secret' })).toBe(
    'Bearer secret'
  )
  expect(configured).toBe('Bearer ${TOKEN}')
  expect(resolveMcpEnvironmentBinding('${OTHER}', ['TOKEN'], { OTHER: 'hidden' })).toBe('${OTHER}')
  expect(() => resolveMcpEnvironmentBinding(configured, ['TOKEN'], {})).toThrow(
    'requires environment variable TOKEN'
  )
})

it('fences native retries during turns and updates without a Node execution fallback', async () => {
  const hooks = new UserPluginHooks()
  await expect(hooks.retry('plugin', 'missing')).rejects.toThrow('unavailable')
  const retry = vi.fn(async () => {})
  hooks.useNative({ diagnostics: async () => [], retry })
  hooks.beginRun('session')
  await expect(hooks.retry('plugin', 'id')).rejects.toThrow('Finish active turns')
  expect(() => hooks.beginUpdate()).toThrow('Finish or stop')
  hooks.endRun('session')
  const finish = hooks.beginUpdate()
  await expect(hooks.retry('plugin', 'id')).rejects.toThrow('Finish active turns')
  expect(() => hooks.beginRun('session')).toThrow('update')
  finish()
  await hooks.retry('plugin', 'id')
  expect(retry).toHaveBeenCalledExactlyOnceWith('plugin', 'id')
})
