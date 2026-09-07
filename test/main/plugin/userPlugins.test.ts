import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { UserPluginSources, snapshotPluginTree } from '@/plugin/userPluginSource'
import { readUserPluginPackage } from '@/plugin/userPluginPackage'
import { UserPluginHooks } from '@/plugin/userPluginHooks'
import { projectPluginContext } from '@/agent/deepchat/runtime/pluginContext'
import { createOpaquePromptAssembly } from '@/agent/deepchat/resources/promptAssembly'
import { resolveMcpEnvironmentBinding } from '@/mcp/environmentBindings'
import type { DeepChatTapeEntryRow, TapeAnchorAppendInput } from '@/tape/domain/entry'
import type { UserPluginHook } from '@shared/types/userPlugin'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, default: actual }
})
vi.unmock('node:child_process')
vi.unmock('child_process')

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
function tape() {
  const rows: DeepChatTapeEntryRow[] = []
  let incarnationId = randomUUID()
  return {
    rows,
    getTapeIncarnationId: () => incarnationId,
    reset: () => {
      rows.length = 0
      incarnationId = randomUUID()
    },
    getBySession: (sessionId: string) => rows.filter((row) => row.session_id === sessionId),
    appendAnchor(input: TapeAnchorAppendInput): DeepChatTapeEntryRow {
      const row: DeepChatTapeEntryRow = {
        session_id: input.sessionId,
        entry_id: rows.length + 1,
        kind: 'anchor',
        name: input.name,
        source_type: 'runtime_event',
        source_id: input.source?.id ?? null,
        source_seq: input.source?.seq ?? null,
        provenance_key: input.provenanceKey ?? null,
        payload_json: JSON.stringify({ state: input.state }),
        meta_json: '{}',
        created_at: Date.now()
      }
      rows.push(row)
      return row
    }
  }
}
function commandHook(event: UserPluginHook['event'], timeout = 5): UserPluginHook {
  return {
    id: event,
    event,
    command: `"${process.execPath}" "\${PLUGIN_ROOT}/hook.cjs"`,
    commandWindows: `"${process.execPath}" "%PLUGIN_ROOT%/hook.cjs"`,
    timeout
  }
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

describe('reviewed context hook execution', () => {
  it('reuses only the matching prompt and restarts hooks after the Tape is cleared', async () => {
    const root = fixture()
    write(
      root,
      'hook.cjs',
      `let input='';process.stdin.on('data', c=>input+=c);process.stdin.on('end',()=>{const data=JSON.parse(input);console.log(JSON.stringify({hookSpecificOutput:{hookEventName:data.hook_event_name,additionalContext:data.prompt||data.source}}))})`
    )
    const history = tape()
    history.appendAnchor({ sessionId: 's', name: 'plugin/context-hook', state: {} })
    history.rows[0].payload_json = '{broken'
    const host = new UserPluginHooks(history)
    const owner = {
      pluginId: 'user.edit',
      digest: 'a'.repeat(64),
      root,
      data: root,
      hooks: [commandHook('SessionStart'), commandHook('UserPromptSubmit')]
    }
    host.register(owner)
    const input = { sessionId: 's', messageId: 'm', prompt: 'First', model: 'test', cwd: root }
    await host.accept(input)
    await host.accept({ ...input, prompt: 'Edited' })
    expect(host.getContext('s', 'm').map((item) => item.content)).toEqual(['startup', 'Edited'])
    const count = history.rows.length
    await host.accept(input)
    expect(history.rows).toHaveLength(count)
    expect(host.getContext('s', 'm').map((item) => item.content)).toEqual(['startup', 'First'])
    const restored = new UserPluginHooks(history)
    restored.register(owner)
    await restored.accept({ ...input, prompt: 'Edited' })
    expect(history.rows).toHaveLength(count)
    expect(restored.getContext('s', 'm').map((item) => item.content)).toEqual(['startup', 'Edited'])
    history.reset()
    expect(host.getContext('s', 'm')).toEqual([])
    expect(host.diagnostics(owner.pluginId)).toEqual([])
    await host.accept(input)
    expect(history.rows).toHaveLength(4)
    expect(host.getContext('s', 'm').map((item) => item.content)).toEqual(['startup', 'First'])
  })

  it('starts the boundary budget after queue admission and records cancellation', async () => {
    const root = fixture()
    write(
      root,
      'hook.cjs',
      `console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'ready'}}))`
    )
    const deadlines: AbortController[] = []
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController()
      deadlines.push(controller)
      return controller.signal
    })
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const admission = new Promise<void>((resolve) => {
      entered = resolve
    })
    const host = new UserPluginHooks(tape())
    host.register({
      pluginId: 'user.queue',
      digest: 'a'.repeat(64),
      root,
      data: root,
      hooks: [commandHook('UserPromptSubmit')],
      verify: async () => {
        entered()
        await gate
      }
    })
    const input = { sessionId: 's', messageId: 'm', prompt: 'Task', model: 'test', cwd: root }
    const first = host.accept(input)
    await admission
    const second = host.accept({ ...input, sessionId: 'queued' })
    for (const deadline of deadlines) deadline.abort()
    release()
    await Promise.all([first, second])
    expect(host.getContext('s', 'm')).toEqual([])
    expect(host.getContext('queued', 'm').map((item) => item.content)).toEqual(['ready'])
    await host.accept({ ...input, sessionId: 'cancelled', signal: AbortSignal.abort() })
    expect(host.diagnostics('user.queue')).toContainEqual(
      expect.objectContaining({ sessionId: 'cancelled', status: 'failed' })
    )
  })

  it('does not publish an in-flight result or subsequent hooks into a cleared Tape', async () => {
    const root = fixture()
    write(
      root,
      'hook.cjs',
      `console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'stale'}}))`
    )
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const admission = new Promise<void>((resolve) => {
      entered = resolve
    })
    const history = tape()
    const host = new UserPluginHooks(history)
    host.register({
      pluginId: 'user.clear',
      digest: 'a'.repeat(64),
      root,
      data: root,
      hooks: [commandHook('SessionStart'), commandHook('UserPromptSubmit')],
      verify: async () => {
        entered()
        await gate
      }
    })
    const input = { sessionId: 's', messageId: 'm', prompt: 'Task', model: 'test', cwd: root }
    const running = host.accept(input)
    await admission
    const queued = host.accept({ ...input, messageId: 'queued' })
    history.reset()
    release()
    await Promise.all([running, queued])
    expect(history.rows).toEqual([])
    expect(host.getContext('s', 'm')).toEqual([])
  })

  it('decodes UTF-8 output split across process chunks', async () => {
    const root = fixture()
    write(
      root,
      'hook.cjs',
      `const data=Buffer.from(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'中文上下文'}}));const offset=data.indexOf(Buffer.from('中'))+1;process.stdout.write(data.subarray(0,offset));setTimeout(()=>process.stdout.write(data.subarray(offset)),30)`
    )
    const host = new UserPluginHooks(tape())
    host.register({
      pluginId: 'user.utf8',
      digest: 'a'.repeat(64),
      root,
      data: root,
      hooks: [commandHook('UserPromptSubmit')]
    })
    await host.accept({ sessionId: 's', messageId: 'm', prompt: 'Task', model: 'test', cwd: root })
    expect(host.getContext('s', 'm').map((item) => item.content)).toEqual(['中文上下文'])
  })

  it('orders startup before the initial prompt, reuses output on retries, isolates children and revokes provider context', async () => {
    const root = fixture()
    write(
      root,
      'hook.cjs',
      `const fs = require('node:fs'); let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { const data = JSON.parse(input); fs.appendFileSync(process.env.PLUGIN_DATA + '/events', data.hook_event_name + ':' + (data.prompt || data.session_id) + '\\n'); console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: data.hook_event_name, additionalContext: data.prompt || data.hook_event_name } })); });`
    )
    const history = tape()
    const host = new UserPluginHooks(history)
    const owner = {
      pluginId: 'user.example',
      digest: 'a'.repeat(64),
      root,
      data: root,
      hooks: [
        commandHook('SessionStart'),
        commandHook('UserPromptSubmit'),
        commandHook('SubagentStart')
      ]
    }
    host.register(owner)
    const input = {
      sessionId: 'parent',
      messageId: 'one',
      prompt: '/example off',
      model: 'test',
      cwd: root
    }
    await host.accept(input)
    await host.accept(input)
    await host.accept({ ...input, messageId: 'two', prompt: 'Continue' })
    await host.accept({
      ...input,
      sessionId: 'child',
      parentSessionId: 'parent',
      messageId: 'child-one',
      prompt: 'Child task'
    })
    expect(fs.readFileSync(path.join(root, 'events'), 'utf8').trim().split('\n')).toEqual([
      'SessionStart:parent',
      'UserPromptSubmit:/example off',
      'UserPromptSubmit:Continue',
      'SubagentStart:parent',
      'UserPromptSubmit:Child task'
    ])
    expect(host.getContext('parent', 'two').map((item) => item.content)).toEqual([
      'SessionStart',
      'Continue'
    ])
    expect(host.getContext('child', 'child-one').map((item) => item.content)).toEqual([
      'SubagentStart',
      'Child task'
    ])
    const base = createOpaquePromptAssembly('Host instructions')
    const projected = projectPluginContext(base, host, 'parent', 'two')
    expect(projected.prompt).toContain('Continue')
    expect(projected.sections.at(-1)?.kind).toBe('plugin_context')
    host.unregister(owner.pluginId)
    expect(projectPluginContext(projected, host, 'parent', 'two').prompt).toBe(base.prompt)
    expect(history.rows.length).toBe(10)
  })

  it('parks uncertain invocations after restart and discards late output on revoke', async () => {
    const root = fixture()
    write(
      root,
      'hook.cjs',
      `setTimeout(() => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'late' } })), 1000)`
    )
    const history = tape()
    const host = new UserPluginHooks(history)
    const owner = {
      pluginId: 'user.example',
      digest: 'b'.repeat(64),
      root,
      data: root,
      hooks: [commandHook('UserPromptSubmit')]
    }
    host.register(owner)
    const input = {
      sessionId: 'session',
      messageId: 'message',
      prompt: 'Hello',
      model: 'test',
      cwd: root
    }
    const running = host.accept(input)
    await new Promise((resolve) => setTimeout(resolve, 40))
    host.unregister(owner.pluginId)
    await running
    expect(host.getContext('session', 'message')).toEqual([])
    const started = history.rows.find(
      (row) => JSON.parse(row.payload_json).state.status === 'started'
    )!
    history.rows.splice(0, history.rows.length, started)
    const recovered = new UserPluginHooks(history)
    recovered.register(owner)
    await recovered.accept(input)
    expect(history.rows.length).toBe(1)
    expect(recovered.diagnostics(owner.pluginId)[0].status).toBe('uncertain')
  })

  it('rejects decisions, oversized context and hung commands while allowing the turn to continue', async () => {
    const root = fixture()
    const host = new UserPluginHooks(tape())
    const owner = {
      pluginId: 'user.example',
      digest: 'c'.repeat(64),
      root,
      data: root,
      hooks: [commandHook('UserPromptSubmit', 0.1)]
    }
    host.register(owner)
    for (const [index, script] of [
      `console.log(JSON.stringify({ decision: 'allow' }))`,
      `console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'x'.repeat(8193) } }))`,
      `setInterval(() => {}, 1000)`
    ].entries()) {
      write(root, 'hook.cjs', script)
      await host.accept({
        sessionId: 's',
        messageId: String(index),
        prompt: 'Hello',
        model: 'test',
        cwd: root
      })
      expect(host.getContext('s', String(index))).toEqual([])
    }
    expect(host.diagnostics(owner.pluginId).map((item) => item.status)).toEqual([
      'failed',
      'failed',
      'failed'
    ])
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

it('explicit retry executes only the failed handler and keeps its sibling output', async () => {
  const root = fixture()
  write(
    root,
    'hook.cjs',
    `const fs=require('node:fs');fs.appendFileSync(process.env.PLUGIN_DATA+'/calls',process.argv[2]);if(process.argv[2]==='b'&&!fs.existsSync(process.env.PLUGIN_DATA+'/retry'))process.exit(1);console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:process.argv[2]}}))`
  )
  const host = new UserPluginHooks(tape())
  const base = commandHook('UserPromptSubmit')
  host.register({
    pluginId: 'user.example',
    digest: 'd'.repeat(64),
    root,
    data: root,
    hooks: [
      {
        ...base,
        id: 'a',
        command: base.command + ' a',
        commandWindows: base.commandWindows + ' a'
      },
      { ...base, id: 'b', command: base.command + ' b', commandWindows: base.commandWindows + ' b' }
    ]
  })
  await host.accept({ sessionId: 's', messageId: 'm', prompt: 'task', model: 'test', cwd: root })
  const failed = host.diagnostics('user.example').find((item) => item.status === 'failed')!
  write(root, 'retry', 'yes')
  await host.retry('user.example', failed.invocationId)
  expect(fs.readFileSync(path.join(root, 'calls'), 'utf8')).toBe('abb')
  expect(host.getContext('s', 'm').map((item) => item.content)).toEqual(['a', 'b'])
})

it.each(['clear', 'replace owner', 'active turn', 'plugin update'])(
  'rejects a queued retry after %s without executing its stale input',
  async (change) => {
    const root = fixture()
    write(
      root,
      'hook.cjs',
      `let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{require('node:fs').appendFileSync(process.env.PLUGIN_DATA+'/calls',JSON.parse(input).prompt+'\\n');process.exit(1)})`
    )
    const history = tape()
    const host = new UserPluginHooks(history)
    const verify = vi.fn(async (): Promise<void> => {})
    const owner = {
      pluginId: 'user.retry',
      digest: 'f'.repeat(64),
      root,
      data: root,
      hooks: [commandHook('UserPromptSubmit')],
      verify
    }
    host.register(owner)
    const input = { sessionId: 's', messageId: 'm', prompt: 'stale', model: 'test', cwd: root }
    await host.accept(input)
    const failed = host.diagnostics(owner.pluginId)[0]
    expect(failed.status).toBe('failed')
    let release!: () => void
    let admitted!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      admitted = resolve
    })
    verify.mockImplementationOnce(async () => {
      admitted()
      await gate
    })
    const running = host.accept({ ...input, sessionId: 'busy', prompt: 'busy' })
    await entered
    const retry = host.retry(owner.pluginId, failed.invocationId)
    const rejected = expect(retry).rejects.toThrow(/Hook retry is unavailable|Finish active turns/)
    let finishUpdate: (() => void) | undefined
    if (change === 'clear') history.reset()
    else if (change === 'replace owner') host.register(owner)
    else if (change === 'active turn') host.beginRun('active')
    else finishUpdate = host.beginUpdate()
    release()
    await Promise.all([running, rejected])
    finishUpdate?.()
    host.endRun('active')
    expect(
      fs
        .readFileSync(path.join(root, 'calls'), 'utf8')
        .split('\n')
        .filter((value) => value === 'stale')
    ).toHaveLength(1)
    expect(history.getBySession('s')).toHaveLength(change === 'clear' ? 0 : 2)
    expect(host.getContext('s', 'm')).toEqual([])
  }
)

it('runs resume-only handlers once after restart even when startup matched no command', async () => {
  const root = fixture()
  write(
    root,
    'hook.cjs',
    `console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'resumed'}}))`
  )
  const history = tape()
  const owner = {
    pluginId: 'user.resume',
    digest: 'e'.repeat(64),
    root,
    data: root,
    hooks: [{ ...commandHook('SessionStart'), matcher: '^resume$' }]
  }
  const input = { sessionId: 's', messageId: 'first', prompt: 'Start', model: 'test', cwd: root }
  const initial = new UserPluginHooks(history)
  initial.register(owner)
  await initial.accept(input)
  expect(initial.diagnostics(owner.pluginId)).toEqual([])
  const restored = new UserPluginHooks(history)
  restored.register(owner)
  await restored.accept({ ...input, messageId: 'second' })
  await restored.accept({ ...input, messageId: 'third' })
  expect(restored.diagnostics(owner.pluginId)).toHaveLength(1)
  expect(restored.getContext('s', 'third').map((item) => item.content)).toEqual(['resumed'])
})
