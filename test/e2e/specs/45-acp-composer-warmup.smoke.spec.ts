import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { selectAgent, sendMessage, getAssistantMessages } from '../helpers/chat'
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
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const reply = (id, result) => send({ id, result })
const configOptions = [
  { id: 'mode', name: 'Mode', type: 'select', currentValue: 'agent', options: [{ value: 'agent', name: 'Agent' }, { value: 'plan', name: 'Plan' }] },
  { id: 'model', name: 'Model', type: 'select', currentValue: 'fixture-model', options: ${JSON.stringify(models.map(({ modelId, name }) => ({ value: modelId, name })))} },
  { id: 'permission', name: 'Permission', type: 'select', currentValue: 'full-access', options: [{ value: 'full-access', name: 'Full Access' }] },
  { id: 'extra', name: 'Extra setting', type: 'boolean', currentValue: false }
]
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line)
  if (!method) return
  appendFileSync(requests, JSON.stringify({ method, params }) + '\n')
  if (method === 'initialize') {
    const timer = setInterval(() => {
      if (!existsSync(release)) return
      clearInterval(timer)
      reply(id, { protocolVersion: 1, agentInfo: { name: 'warmup fixture', version: '1' }, agentCapabilities: { _meta: { lody: { usage: { version: 1 } } } }, authMethods: [] })
    }, 25)
  } else if (method === 'session/new') {
    const sessionId = 'fixture-' + Math.random()
    reply(id, { sessionId, configOptions })
    setTimeout(() => send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'usage_update', used: 1000, size: 100000 } } }), 50)
  } else if (method === 'session/set_config_option') {
    const timer = setInterval(() => {
      if (!existsSync(release)) return
      clearInterval(timer)
      configOptions.find(option => option.id === params.configId).currentValue = params.value
      reply(id, { configOptions })
    }, 25)
  } else if (method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Fixture reply' } } } })
    reply(id, { stopReason: 'end_turn' })
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
  await expect(app.page.getByTestId('context-occupancy')).toBeVisible()
  await expect(app.page.locator('.acp-inline-option')).toHaveCount(3)
  expect(
    await app.page
      .locator('.acp-inline-option')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-option-id')))
  ).toEqual(['model', 'mode', 'permission'])
  await expect(app.page.locator('.acp-overflow-button')).toBeVisible()

  const modelTrigger = app.page.locator('.acp-inline-option').first()
  const modelMenu = app.page.locator('[data-slot="popover-content"]').filter({
    has: app.page.locator('.acp-inline-option-title').filter({ hasText: 'Model' })
  })
  for (const [width, theme] of [
    [1280, 'light'],
    [800, 'light'],
    [480, 'dark']
  ] as const) {
    await app.page.setViewportSize({ width, height: 800 })
    await app.page.evaluate(async (theme) => {
      await window.deepchat.invoke('config.setTheme', { theme })
    }, theme)
    await app.electronApp.evaluate(({ app, BrowserWindow }, url) => {
      app.focus()
      const window = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === url
      )
      window?.focus()
      window?.webContents.focus()
    }, app.page.url())
    await expect.poll(() => app.page.evaluate(() => document.hasFocus())).toBe(true)
    await expect(modelTrigger).toBeEnabled()
    const toolbar = app.page.getByTestId('chat-input-toolbar')
    const editor = app.page.getByTestId('chat-input-editor').locator('[contenteditable="true"]')
    const controls = toolbar.locator('.composer-control')
    await expect(controls).toHaveCount(6)
    await expect(
      app.page.getByTestId('new-thread-context-selectors').getByTestId('new-thread-agent-selector')
    ).toBeVisible()
    await expect(toolbar.getByTestId('new-thread-agent-selector')).toHaveCount(0)
    const contextRow = app.page.getByTestId('new-thread-context-selectors')
    const composerBox = await app.page.getByTestId('chat-input-box').boundingBox()
    const contextBox = await contextRow.boundingBox()
    expect(contextBox!.y).toBeGreaterThanOrEqual(composerBox!.y + composerBox!.height)
    const agentBox = await selector.boundingBox()
    const projectBox = await app.page.getByTestId('new-thread-project-trigger').boundingBox()
    expect(
      Math.abs(agentBox!.y + agentBox!.height / 2 - projectBox!.y - projectBox!.height / 2)
    ).toBeLessThanOrEqual(1)
    await expect(modelTrigger.locator('.composer-control-details')).toHaveCount(0)
    for (const control of await controls.all()) {
      await editor.focus()
      await app.page.mouse.move(0, 0)
      const details = control.locator('.composer-control-details')
      await expect(details).toHaveCSS('opacity', '0')
      await expect(async () => {
        const widths = await controls.evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().width)
        )
        expect(widths.every((width) => width <= 34)).toBe(true)
      }).toPass({ timeout: 5000 })
      const collapsed = await control.boundingBox()
      expect(collapsed!.width).toBeLessThanOrEqual(34)
      await control.hover()
      await expect(details).toHaveCSS('opacity', '1')
      await expect(async () => {
        expect((await control.boundingBox())!.width).toBeGreaterThan(collapsed!.width + 8)
      }).toPass({ timeout: 5000 })
    }
    await editor.focus()
    await app.page.mouse.move(0, 0)
    for (const control of await controls.all()) {
      await control.hover()
      await expect(control.locator('.composer-control-details')).toHaveCSS('opacity', '1')
    }
    await expect(controls.first().locator('.composer-control-details')).toHaveCSS('opacity', '1')
    await editor.focus()
    await app.page.mouse.move(0, 0)
    const occupancy = app.page.getByTestId('context-occupancy')
    await expect(occupancy.locator('.composer-control-details')).toHaveCSS('opacity', '0')
    await app.page.locator('.acp-inline-option[data-option-id="permission"]').focus()
    await app.page.keyboard.press('Tab')
    await expect(occupancy).toBeFocused()
    await expect(occupancy.locator('.composer-control-details')).toHaveCSS('opacity', '1')
    expect(await occupancy.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
    await editor.focus()
    await expect(async () => {
      const metrics = await toolbar.evaluate((element) => {
        const buttons = Array.from(element.querySelectorAll('button'))
        const boxes = buttons
          .map((button) => button.getBoundingClientRect())
          .filter((box) => box.width > 0)
        return {
          centerSpread:
            Math.max(...boxes.map((box) => box.y + box.height / 2)) -
            Math.min(...boxes.map((box) => box.y + box.height / 2)),
          horizontalOverflow: element.scrollWidth > element.clientWidth
        }
      })
      expect(metrics.centerSpread).toBeLessThanOrEqual(1)
      expect(metrics.horizontalOverflow).toBe(false)
      await expect(toolbar.getByRole('button').first()).toBeInViewport()
      await expect(app.page.getByTestId('chat-send-button')).toBeInViewport()
    }).toPass({ timeout: 5000 })
    const lastSettingsButton = toolbar.locator(':scope > div').nth(1).getByRole('button').last()
    await lastSettingsButton.focus()
    await expect(lastSettingsButton).toBeInViewport({ ratio: 1 })
    await modelTrigger.click()
    await expect(modelMenu).toBeVisible()
    await app.page.mouse.move(0, 0)
    const longOption = modelMenu.locator(`button[data-value="${longModelId}"]`)
    await longOption.scrollIntoViewIfNeeded()
    await expect(async () => {
      const menuBox = await modelMenu.boundingBox()
      expect(menuBox).not.toBeNull()
      expect(menuBox!.width).toBeGreaterThan(224)
      expect(menuBox!.width).toBeLessThanOrEqual(320)
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
    }).toPass({ timeout: 5000 })
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
    await expect(tooltip).toHaveCount(0)
    await modelMenu.focus()
    await expect(app.page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)
    await app.page.keyboard.press('Escape')
    await expect(modelMenu).toBeHidden()
    await expect(modelTrigger).toBeFocused()
  }
  await modelTrigger.focus()
  await expect(modelTrigger).toBeFocused()
  await app.page.keyboard.press('Tab')
  const modeTrigger = app.page.locator('.acp-inline-option[data-option-id="mode"]')
  await expect(modeTrigger).toBeFocused()
  await expect(modeTrigger.locator('.composer-control-details')).toHaveCSS('opacity', '1')
  await modeTrigger.press('Enter')
  await app.page.mouse.move(0, 0)
  await expect(modeTrigger).toHaveAttribute('aria-expanded', 'true')
  await expect(modeTrigger.locator('.composer-control-details')).toHaveCSS('opacity', '1')
  unlinkSync(release)
  await app.page
    .locator('.acp-inline-option-item[data-option-id="mode"][data-value="plan"]')
    .click()
  await expect(modeTrigger).toBeDisabled()
  await app.page.getByTestId('chat-input-editor').locator('[contenteditable="true"]').focus()
  await app.page.mouse.move(0, 0)
  await expect(modeTrigger.locator('.composer-control-details')).toHaveCSS('opacity', '1')
  writeFileSync(release, '')
  await expect(modeTrigger).toBeEnabled()
  await expect(modeTrigger).toContainText('Plan')
  await modelTrigger.focus()
  await expect(modelTrigger).toBeFocused()
  await modelTrigger.press('Enter')
  const selectedModelId = longModelId
  await modelMenu.locator(`button[data-value="${selectedModelId}"]`).click()
  await expect(modelMenu).toBeHidden()
  await expect(modelTrigger).toContainText(selectedModelId)
  await modelTrigger.click()
  const selectedOption = modelMenu.locator(`button[data-value="${selectedModelId}"]`)
  await expect(selectedOption).toBeDisabled()
  const selectedOptionTrigger = modelMenu.getByRole('button', {
    name: selectedModelId,
    exact: true
  })
  await expect(selectedOptionTrigger).toHaveAttribute('aria-disabled', 'true')
  await selectedOptionTrigger.hover()
  const selectedTooltip = app.page.locator('[data-slot="tooltip-content"]').filter({
    hasText: selectedModelId
  })
  await expect(selectedTooltip).toBeVisible()
  await expect(selectedTooltip.getByRole('tooltip', { includeHidden: true })).toHaveText(
    selectedModelId
  )
  await app.page.mouse.move(0, 0)
  await expect(selectedTooltip).toHaveCount(0)
  await modelMenu.focus()
  await expect(app.page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)
  await selectedOptionTrigger.focus()
  await expect(selectedOptionTrigger).toBeFocused()
  await expect(selectedTooltip).toBeVisible()
  await selectedOptionTrigger.press('Enter')
  await expect(selectedOption).toBeDisabled()
  await expect(modelMenu).toBeVisible()
  await modelMenu.focus()
  await expect(app.page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)
  await app.page.keyboard.press('Escape')

  await app.page.emulateMedia({ reducedMotion: 'reduce' })
  expect(
    await modeTrigger.locator('.composer-control-details').evaluate((element) =>
      getComputedStyle(element)
        .transitionDuration.split(',')
        .every((duration) => parseFloat(duration) <= 0.001)
    )
  ).toBe(true)
  await app.page.emulateMedia({ reducedMotion: null })

  const selectWorkspace = (path: string | null) =>
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
  await app.page.evaluate(() => {
    const project = (
      document.querySelector('#app') as any
    ).__vue_app__.config.globalProperties.$pinia._s.get('project')
    const ensureChatWorkspace = project.ensureChatWorkspace
    project.ensureChatWorkspace = async () => {
      project.ensureChatWorkspace = ensureChatWorkspace
      throw new Error('Workspace is read-only')
    }
    project.defaultChatWorkspacePath = null
    project.selectProject(null, 'manual')
  })
  const retryWorkspace = app.page.getByTestId('new-thread-chat-workspace-retry')
  await expect(retryWorkspace).toHaveAccessibleName(/Workspace is read-only/)
  await expect(app.page.getByTestId('chat-send-button')).toBeDisabled()
  await expect(app.page.getByTestId('new-thread-acp-workdir-status')).toHaveCount(0)
  await retryWorkspace.hover()
  await expect(
    app.page.locator('[data-slot="tooltip-content"]').filter({ hasText: 'Workspace is read-only' })
  ).toBeVisible()
  await retryWorkspace.click()
  await expect(retryWorkspace).toHaveCount(0)
  await expect(app.page.getByTestId('new-thread-project-trigger-icon')).toHaveAttribute(
    'data-icon',
    'lucide:message-square'
  )
  await expect(app.page.getByTestId('new-thread-acp-workdir-status')).toHaveCount(0)
  await expect(modelTrigger).toBeEnabled()
  const chatWorkspace = await app.page.evaluate(
    () =>
      (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get(
        'project'
      ).defaultChatWorkspacePath
  )
  expect(chatWorkspace).toBeTruthy()
  const sessionRequests = readFileSync(requests, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(
    sessionRequests.filter((request) => request.method === 'session/new').at(-1)?.params.cwd
  ).toBe(chatWorkspace)
  await sendMessage(app.page, 'Hello from Chats')
  await expect(getAssistantMessages(app.page)).toHaveCount(1)
  await expect(getAssistantMessages(app.page).last()).toContainText('Fixture reply')
  await expect(app.page.getByTestId('chat-page-shell')).toHaveAttribute('data-generating', 'false')
  await sendMessage(app.page, 'Continue chatting')
  await expect(getAssistantMessages(app.page)).toHaveCount(2)
  await expect(getAssistantMessages(app.page).last()).toContainText('Fixture reply')
  await expect(app.page.getByTestId('chat-page-shell')).toHaveAttribute('data-generating', 'false')
  expect(routeErrors).toEqual([])
  expect(app.consoleLogs.filter((line) => line.includes('DeepChat Agent not found'))).toEqual([])
  expect(app.pageErrors).toEqual([])
})
