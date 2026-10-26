import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { selectAgent } from '../helpers/chat'
import { waitForAppReady } from '../helpers/wait'

test('ACP composer keeps warmup feedback, workspace recovery and local Skills boundaries @smoke', async ({
  app
}) => {
  const workspace = join(app.userDataDir, 'acp-workspace')
  const missingWorkspace = join(app.userDataDir, 'missing-workspace')
  const release = join(app.userDataDir, 'release-initialize')
  const requests = join(app.userDataDir, 'acp-requests.txt')
  const script = join(app.userDataDir, 'acp-warmup-fixture.mjs')
  mkdirSync(workspace)
  writeFileSync(requests, '')
  writeFileSync(
    script,
    String.raw`
import { createInterface } from 'node:readline'
import { appendFileSync, existsSync } from 'node:fs'
const [release, requests] = process.argv.slice(2)
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method } = JSON.parse(line)
  if (!method) return
  appendFileSync(requests, method + '\n')
  if (method === 'initialize') {
    const timer = setInterval(() => {
      if (!existsSync(release)) return
      clearInterval(timer)
      reply(id, { protocolVersion: 1, agentInfo: { name: 'warmup fixture', version: '1' }, agentCapabilities: {}, authMethods: [] })
    }, 25)
  } else if (method === 'session/new') {
    reply(id, {
      sessionId: 'fixture-' + Math.random(),
      models: { currentModelId: 'fixture-model', availableModels: [{ modelId: 'fixture-model', name: 'Fixture Model' }] },
      modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }] }
    })
  } else if (id !== undefined) reply(id, {})
})
`
  )
  const routeErrors: string[] = []
  const captureError = (data: Buffer) => {
    if (data.toString().includes('DeepChat Agent not found')) routeErrors.push(data.toString())
  }
  app.electronApp.process().stderr?.on('data', captureError)
  await waitForAppReady(app.page)
  const agentId = await app.page.evaluate(
    async ({ workspace, script, release, requests, command }) => {
      await window.deepchat.invoke('config.setDefaultProjectPath', { path: workspace })
      await window.deepchat.invoke('config.setAcpEnabled', { enabled: true })
      const { agent } = await window.deepchat.invoke('config.addManualAcpAgent', {
        name: 'Warmup fixture',
        command,
        args: [script, release, requests],
        enabled: true
      })
      return agent.id
    },
    { workspace, script, release, requests, command: process.execPath }
  )
  await selectAgent(app.page, agentId)
  const selector = app.page.getByTestId('new-thread-agent-selector')
  await expect(selector).toHaveAttribute('aria-busy', 'true')
  await expect(app.page.getByTestId('new-thread-agent-loading')).toBeVisible()
  writeFileSync(release, '')
  await expect(selector).not.toHaveAttribute('aria-busy', 'true')
  await expect(
    app.page.locator('.acp-inline-option').filter({ hasText: 'Fixture Model' })
  ).toBeVisible()
  await expect.poll(() => readFileSync(requests, 'utf8')).toContain('session/new')

  const selectWorkspace = (path: string) =>
    app.page.evaluate((path) => {
      const root = document.querySelector('#app') as HTMLElement & { __vue_app__?: any }
      root.__vue_app__.config.globalProperties.$pinia._s
        .get('project')
        .selectProject(path, 'manual')
    }, path)
  await selectWorkspace(missingWorkspace)
  await expect(app.page.getByTestId('new-thread-acp-workdir-status')).toContainText(
    missingWorkspace
  )
  await expect(app.page.getByTestId('chat-send-button')).toBeDisabled()
  await expect(selector).not.toHaveAttribute('aria-busy', 'true')
  await selectWorkspace(workspace)
  await expect(app.page.getByTestId('new-thread-acp-workdir-status')).toHaveCount(0)
  await expect(
    app.page.locator('.acp-inline-option').filter({ hasText: 'Fixture Model' })
  ).toBeVisible()
  expect(routeErrors).toEqual([])
  expect(app.consoleLogs.filter((line) => line.includes('DeepChat Agent not found'))).toEqual([])
  expect(app.pageErrors).toEqual([])
})
