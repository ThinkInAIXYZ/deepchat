import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('MCP stdio preserves host identity, toolchain, environment and child cleanup @smoke', async ({
  launchApp
}) => {
  const first = await launchApp()
  expect(first.ownsUserDataDir).toBe(true)
  await waitForAppReady(first.page)
  const workspace = join(first.userDataDir, 'mcp-workspace')
  const firstPath = join(workspace, 'first-path')
  mkdirSync(firstPath, { recursive: true })
  const script = join(workspace, 'server.cjs')
  const journal = join(workspace, 'journal.jsonl')
  writeFileSync(
    script,
    `const fs = require('node:fs')
const readline = require('node:readline')
const record = (entry) => fs.appendFileSync(process.argv[2], JSON.stringify(entry) + '\\n')
const snapshot = () => ({ pid: process.pid, cwd: process.cwd(), executable: process.execPath,
  homeArgument: process.argv[3], declared: process.env.MCP_DECLARED,
  hostSecret: process.env.DEEPCHAT_MCP_HOST_SECRET ?? null,
  path: process.env.PATH ?? process.env.Path ?? process.env.path })
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  let result = {}
  if (message.method === 'initialize') {
    record({ event: 'initialize', client: message.params.clientInfo, ...snapshot() })
    result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'runtime-fixture', version: '1.0.0' } }
  } else if (message.method === 'tools/list') {
    result = { tools: [{ name: 'inspect_runtime', description: 'Inspect the owned runtime',
      inputSchema: { type: 'object', properties: {} } }] }
  } else if (message.method === 'tools/call') {
    record({ event: 'call', ...snapshot() })
    result = { content: [{ type: 'text', text: JSON.stringify(snapshot()) }] }
  } else if (message.method === 'prompts/list') result = { prompts: [] }
  else if (message.method === 'resources/list') result = { resources: [] }
  else if (message.method === 'resources/templates/list') result = { resourceTemplates: [] }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
})
process.stdin.on('end', () => process.exit(0))
`
  )
  const expectedHost = await first.electronApp.evaluate(({ app }) => ({
    home: app.getPath('home'),
    version: app.getVersion()
  }))
  await first.electronApp.evaluate(() => {
    process.env.DEEPCHAT_MCP_HOST_SECRET = 'fixture-host-only'
  })
  const serverName = 'runtime-host-fixture'
  const controls = await openSettings(first)
  await controls.evaluate(
    async ({ node, serverName, script, journal, workspace, firstPath }) => {
      await window.deepchat.invoke('toolchains.setSource', {
        kind: 'node',
        selection: { source: 'custom', customPath: node }
      })
      await window.deepchat.invoke('mcp.setEnabled', { enabled: true })
      await window.deepchat.invoke('mcp.addServer', {
        serverName,
        config: {
          type: 'stdio',
          enabled: true,
          command: 'node',
          args: [script, journal, '~/mcp-runtime-marker'],
          cwd: workspace,
          inheritEnv: 'minimal',
          env: { MCP_DECLARED: 'owned-value', PATH: firstPath },
          descriptions: 'Disposable runtime fixture',
          icons: ''
        }
      })
    },
    { node: process.execPath, serverName, script, journal, workspace, firstPath }
  )
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw error
    }
  }
  const records = () =>
    readFileSync(journal, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)) as Array<{
      event: string
      pid: number
      client: { name: string; version: string }
      executable: string
      homeArgument: string
      cwd: string
      declared: string
      hostSecret: string | null
      path: string
    }>
  for (const phase of ['first', 'reopen'] as const) {
    const active = phase === 'first' ? first : await launchApp()
    await waitForAppReady(active.page)
    await active.electronApp.evaluate(() => {
      process.env.DEEPCHAT_MCP_HOST_SECRET = 'fixture-host-only'
    })
    const settings = phase === 'first' ? controls : await openSettings(active)
    await settings.evaluate(
      (serverName) => window.deepchat.invoke('mcp.startServer', { serverName }),
      serverName
    )
    const { tools } = await settings.evaluate(() =>
      window.deepchat.invoke('mcp.listToolDefinitions', {})
    )
    const tool = tools.find((entry) => entry.server.name === serverName)!
    expect(tool).toBeTruthy()
    const result = await settings.evaluate(
      (name) =>
        window.deepchat.invoke('mcp.callTool', {
          request: {
            id: 'inspect-runtime',
            type: 'function',
            function: { name, arguments: '{}' }
          }
        }),
      tool.function.name
    )
    expect(result.rawData.isError).not.toBe(true)
    const current = records()
      .filter((entry) => entry.event === 'call')
      .at(-1)!
    expect(current).toMatchObject({
      executable: realpathSync(process.execPath),
      homeArgument: `${expectedHost.home}/mcp-runtime-marker`,
      cwd: realpathSync(workspace),
      declared: 'owned-value',
      hostSecret: null
    })
    expect(current.path.startsWith(firstPath)).toBe(true)
    expect(current.path).toContain(dirname(process.execPath))
    expect(result.content).toContain('mcp-runtime-marker')
    expect(
      records()
        .filter((entry) => entry.event === 'initialize')
        .at(-1)?.client
    ).toEqual({
      name: 'DeepChat',
      version: expectedHost.version
    })
    expect(records().every((entry) => entry.hostSecret === null)).toBe(true)
    if (phase === 'first') {
      await settings.evaluate(
        (serverName) => window.deepchat.invoke('mcp.stopServer', { serverName }),
        serverName
      )
      await expect.poll(() => alive(current.pid)).toBe(false)
      await settings.evaluate(
        (serverName) => window.deepchat.invoke('mcp.startServer', { serverName }),
        serverName
      )
    }
    const pids = records().map((entry) => entry.pid)
    expect(await active.close()).toBe('graceful')
    for (const pid of new Set(pids)) await expect.poll(() => alive(pid)).toBe(false)
    expect(active.pageErrors).toEqual([])
  }
  expect(records().filter((entry) => entry.event === 'call')).toHaveLength(2)
})
