import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { selectAgent } from '../helpers/chat'
import { waitForAppReady } from '../helpers/wait'

test('ACP composer keeps warmup feedback, responsive options and workspace recovery @smoke', async ({
  app
}, testInfo) => {
  const workspace = join(app.userDataDir, 'acp-workspace')
  const missingWorkspace = join(app.userDataDir, 'missing-workspace')
  const release = join(app.userDataDir, 'release-initialize')
  const requests = join(app.userDataDir, 'acp-requests.txt')
  const script = join(app.userDataDir, 'acp-warmup-fixture.mjs')
  const longModelId = 'openrouter/' + 'longmodelidentifier'.repeat(10)
  const models = [
    { modelId: 'fixture-model', name: 'Fixture Model' },
    ...[
      'openrouter/poolside/laguna-xs-2.1',
      'openrouter/anthropic/claude-sonnet-5',
      'openrouter/google/gemini-3.1-flash-lite-image',
      'openrouter/nex-agi/nex-n2-mini',
      'openrouter/sakana/fugu-ultra',
      'openrouter/google/gemini-3.1-flash-image',
      longModelId
    ].map((modelId) => ({ modelId, name: modelId })),
    ...Array.from({ length: 4 }, (_, index) => ({
      modelId: `fixture-extra-${index}`,
      name: `Extra Model ${index}`
    }))
  ]
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
      models: { currentModelId: 'fixture-model', availableModels: ${JSON.stringify(models)} },
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

  const modelTrigger = app.page.locator('.acp-inline-option').first()
  const modelMenu = app.page.locator('[data-slot="popover-content"]').filter({
    has: app.page.locator('.acp-inline-option-title').filter({ hasText: 'Model' })
  })
  for (const [width, theme] of [
    [1280, 'light'],
    [480, 'dark']
  ] as const) {
    await app.page.setViewportSize({ width, height: 800 })
    await app.page.evaluate(async (theme) => {
      await window.deepchat.invoke('config.setTheme', { theme })
    }, theme)
    await expect(modelTrigger).toBeEnabled()
    await modelTrigger.click()
    await expect(modelMenu).toBeVisible()
    const longOption = modelMenu.locator(`button[data-value="${longModelId}"]`)
    await longOption.scrollIntoViewIfNeeded()
    await expect(async () => {
      const menuBox = await modelMenu.boundingBox()
      expect(menuBox).not.toBeNull()
      expect(menuBox!.width).toBeGreaterThan(224)
      expect(menuBox!.x).toBeGreaterThanOrEqual(7)
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width - 7)
      const scroll = await modelMenu.locator('.dc-overscroll-contain').evaluate((element) => ({
        horizontal: element.scrollWidth > element.clientWidth,
        vertical: element.scrollHeight > element.clientHeight
      }))
      expect(scroll).toEqual({ horizontal: false, vertical: true })
      expect(
        await longOption.evaluate((element) => {
          const style = getComputedStyle(element)
          return (
            style.whiteSpace === 'nowrap' &&
            style.textOverflow === 'ellipsis' &&
            element.scrollWidth > element.clientWidth
          )
        })
      ).toBe(true)
    }).toPass()
    await longOption.hover()
    const tooltip = app.page
      .locator('[data-slot="tooltip-content"]')
      .filter({ hasText: longModelId })
    await expect(tooltip).toBeVisible()
    await expect(tooltip.getByRole('tooltip', { includeHidden: true })).toHaveText(longModelId)
    expect(await tooltip.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    )
    await app.page.screenshot({ path: testInfo.outputPath(`acp-models-${width}-${theme}.png`) })
    await app.page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()
    await app.page.keyboard.press('Escape')
    await expect(modelMenu).toBeHidden()
    await expect(modelTrigger).toBeFocused()
  }
  await modelTrigger.press('Enter')
  const selectedModelId = longModelId
  await modelMenu.locator(`button[data-value="${selectedModelId}"]`).click()
  await expect(modelMenu).toBeHidden()
  await expect(modelTrigger).toContainText(selectedModelId)
  await modelTrigger.click()
  const selectedOption = modelMenu.locator(`button[data-value="${selectedModelId}"]`)
  await expect(selectedOption).toBeDisabled()
  await selectedOption.hover()
  const selectedTooltip = app.page.locator('[data-slot="tooltip-content"]').filter({
    hasText: selectedModelId
  })
  await expect(selectedTooltip).toBeVisible()
  await expect(selectedTooltip.getByRole('tooltip', { includeHidden: true })).toHaveText(
    selectedModelId
  )
  await app.page.mouse.move(0, 0)
  await expect(selectedTooltip).toBeHidden()
  await app.page.keyboard.press('Escape')

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
  await expect(modelTrigger).toBeVisible()
  expect(routeErrors).toEqual([])
  expect(app.consoleLogs.filter((line) => line.includes('DeepChat Agent not found'))).toEqual([])
  expect(app.pageErrors).toEqual([])
})
