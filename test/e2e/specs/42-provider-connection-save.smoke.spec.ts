import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab, selectProvider } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '../../../src/shared/contracts/channels'

test('connection saving does not depend on the fixed probe model @smoke', async ({
  app
}, testInfo) => {
  const calls: Array<{ model: string; authorization: string | undefined }> = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (!request.url?.endsWith('/chat/completions')) {
      response.writeHead(404).end()
      return
    }
    const { model } = JSON.parse(body)
    calls.push({ model, authorization: request.headers.authorization })
    const code =
      request.headers.authorization !== 'Bearer replacement-fixture-key'
        ? 'invalid_api_key'
        : model === 'deepseek-v4-flash'
          ? 'AccessDenied.Unpurchased'
          : null
    response.writeHead(code === 'invalid_api_key' ? 401 : code ? 403 : 200, {
      'Content-Type': 'application/json'
    })
    response.end(
      JSON.stringify(
        code
          ? {
              error: { code, type: code, message: code }
            }
          : {
              id: 'connection-fixture',
              object: 'chat.completion',
              created: 1,
              model,
              choices: [
                { index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }
              ]
            }
      )
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  try {
    await waitForAppReady(app.page)
    const baseline = await app.page.evaluate(async (url) => {
      const { provider } = await window.deepchat.invoke('providers.update', {
        providerId: 'alibaba-token-plan-cn',
        updates: { apiKey: 'old-fixture-key', baseUrl: url, enable: false }
      })
      await window.deepchat.invoke('models.saveCustom', {
        providerId: provider.id,
        config: {
          maxTokens: 2048,
          contextLength: 8192,
          vision: false,
          functionCall: false,
          reasoning: false,
          type: 'chat',
          isUserDefined: true
        },
        model: {
          id: 'custom-text-fixture',
          name: 'Custom text fixture',
          type: 'chat',
          enabled: true
        }
      })
      return await window.deepchat.invoke('providers.validateDraft', {
        provider: { ...provider, apiKey: 'replacement-fixture-key' },
        loadModels: false
      })
    }, baseUrl)
    expect(baseline).toMatchObject({ isOk: false, errorMsg: 'AccessDenied.Unpurchased' })

    const page = await openSettings(app)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openSettingsTab(page, 'settings-tab-model-providers')
    await selectProvider(page, 'alibaba-token-plan-cn')
    await expect(page.getByTestId('provider-api-key-summary')).toBeVisible()
    await page.getByTestId('provider-verify-button').click()
    await page.getByTestId('model-check-select').click()
    await page.locator('[data-model-id="qwen3.8-flash"][data-testid="model-check-option"]').click()
    await page.getByTestId('model-check-submit').click()
    await expect(page.getByTestId('model-check-result')).toHaveAttribute('data-success', 'false')
    expect(calls.at(-1)).toEqual({
      model: 'qwen3.8-flash',
      authorization: 'Bearer old-fixture-key'
    })
    await page
      .getByTestId('model-check-dialog')
      .getByRole('button', { name: /^(Close|关闭)$/ })
      .first()
      .click()

    await page.getByTestId('provider-connection-edit').click()
    await expect(page.getByTestId('provider-current-key')).toContainText('••••••••')
    await expect(page.getByTestId('provider-api-key-input')).toHaveValue('')
    await page.getByTestId('provider-api-key-input').fill('discard-fixture-key')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('provider-connection-dialog')).toHaveCount(0)
    await expect(page.getByTestId('provider-connection-edit')).toBeFocused()
    await page.getByTestId('provider-connection-edit').click()
    await expect(page.getByTestId('provider-api-key-input')).toHaveValue('')
    await page.getByTestId('provider-api-key-input').fill('replacement-fixture-key')
    await page.getByTestId('provider-api-key-input').blur()
    await expect(page.getByTestId('provider-verify-button')).toBeDisabled()
    await expect(page.getByTestId('provider-connection-save')).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('connection-dirty.png') })
    await page.setViewportSize({ width: 900, height: 640 })
    await page.screenshot({ path: testInfo.outputPath('connection-dirty-compact.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    const callsBeforeSave = calls.length
    await page.getByTestId('provider-connection-save').click()
    await expect(page.getByTestId('provider-api-key-input')).toHaveCount(0)
    await expect(page.getByTestId('provider-verify-button')).toBeEnabled()
    expect(calls).toHaveLength(callsBeforeSave)
    await expect(page.getByTestId('provider-health-pill')).toContainText(/未检查|Not checked/)
    await page.getByTestId('provider-health-pill').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('connection-saved.png') })

    await page.getByTestId('provider-verify-button').click()
    await page.getByTestId('model-check-select').click()
    await expect(
      page.locator('[data-testid="model-check-option"][data-model-id="happyhorse-1.1-r2v"]')
    ).toHaveCount(0)
    await expect(
      page.locator('[data-testid="model-check-option"][data-model-id="custom-text-fixture"]')
    ).toBeVisible()
    await page
      .locator('[data-testid="model-check-option"][data-model-id="deepseek-v4-flash"]')
      .click()
    await page.getByTestId('model-check-submit').click()
    await expect(page.getByTestId('model-check-result')).toContainText('AccessDenied.Unpurchased')
    await page.screenshot({ path: testInfo.outputPath('connection-model-denied.png') })
    await page.getByTestId('model-check-select').click()
    await page.locator('[data-testid="model-check-option"][data-model-id="qwen3.8-flash"]').click()
    await page.getByTestId('model-check-submit').click()
    await expect(page.getByTestId('model-check-result')).toHaveAttribute('data-success', 'true')
    expect(calls.at(-1)).toEqual({
      model: 'qwen3.8-flash',
      authorization: 'Bearer replacement-fixture-key'
    })
    await page
      .getByTestId('model-check-dialog')
      .getByRole('button', { name: /^(Close|关闭)$/ })
      .first()
      .click()
    await expect(page.getByTestId('provider-health-pill')).toContainText(
      /上次测试成功|Last test passed/
    )
    await expect(page.getByTestId('provider-health-model')).toContainText('qwen3.8-flash')
    await expect(page.getByTestId('model-check-dialog')).toHaveCount(0)
    await page.getByTestId('provider-health-pill').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('connection-verified.png') })
    await page.setViewportSize({ width: 900, height: 1000 })
    await page.screenshot({ path: testInfo.outputPath('connection-verified-narrow.png') })
    await page.setViewportSize({ width: 1440, height: 640 })
    await page.screenshot({ path: testInfo.outputPath('connection-verified-short.png') })
    await page.setViewportSize({ width: 900, height: 640 })
    await page.screenshot({ path: testInfo.outputPath('connection-verified-compact.png') })

    const savedProvider = await page.evaluate(async () => {
      const { providers } = await window.deepchat.invoke('providers.list', {})
      return providers.find((provider) => provider.id === 'alibaba-token-plan-cn')
    })
    expect(savedProvider?.enable).toBe(false)
    const modelSection = page.getByTestId('provider-models-section')
    await modelSection.getByRole('textbox').fill('custom-text-fixture')
    const filteredEnable = modelSection.getByRole('button', { name: /启用筛选结果|Enable results/ })
    await expect(filteredEnable).toContainText('1')
    await filteredEnable.scrollIntoViewIfNeeded()
    const customToggle = modelSection.getByTestId(
      'provider-model-toggle-alibaba-token-plan-cn-custom-text-fixture'
    )
    await expect(customToggle).toHaveCount(1)
    const actionsBox = await modelSection.getByTestId('model-batch-actions').boundingBox()
    const modelBox = await customToggle.boundingBox()
    expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(modelBox!.y)
    await page.screenshot({ path: testInfo.outputPath('models-filtered-compact.png') })
    await modelSection.getByRole('textbox').fill('')
    await page.getByTestId('provider-remove-key').click()
    await page.screenshot({ path: testInfo.outputPath('remove-key-confirm.png') })
    await page.getByTestId('provider-remove-key-confirm').click()
    await expect(page.getByTestId('provider-key-missing')).toBeVisible()
    expect(calls).toHaveLength(callsBeforeSave + 2)
    await page.getByTestId('provider-connection-edit').click()
    await page.getByTestId('provider-api-key-input').fill('replacement-fixture-key')
    await page.getByTestId('provider-connection-save').click()
    await expect(page.getByTestId('provider-api-key-summary')).toBeVisible()

    // Simulate a rejected persistence call only in this disposable Electron process.
    await app.electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel)
    }, DEEPCHAT_ROUTE_INVOKE_CHANNEL)
    await page.getByTestId('provider-connection-edit').click()
    await page.getByTestId('provider-api-key-input').fill('failed-fixture-key')
    await page.getByTestId('provider-connection-save').click()
    await expect(page.getByTestId('provider-connection-error')).toBeVisible()
    await expect(page.getByTestId('provider-connection-error')).not.toContainText(
      'failed-fixture-key'
    )
    await expect(page.getByTestId('provider-api-key-input')).toHaveValue('failed-fixture-key')
    await expect(page.getByTestId('provider-connection-save')).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('connection-save-failed.png') })
    await page.getByTestId('provider-connection-cancel').click()
    await expect(page.getByTestId('provider-connection-dialog')).toHaveCount(0)
    await page.getByTestId('provider-remove-key').click()
    await page.getByTestId('provider-remove-key-confirm').click()
    await expect(
      page.getByRole('alertdialog').getByTestId('provider-connection-error')
    ).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('remove-key-failed.png') })
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^(取消|Cancel)$/ })
      .click()
    await page.getByRole('button', { name: /^(添加模型|Add Model)$/ }).click()
    await page.locator('#modelId').fill('unsaved-custom-fixture')
    await page.locator('#modelName').fill('Unsaved custom fixture')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^(保存配置|Save Configuration)$/ })
      .click()
    await expect(page.getByRole('dialog')).toContainText(/保存失败|Failed to save/)
    await expect(page.locator('#modelId')).toHaveValue('unsaved-custom-fixture')
    await page.screenshot({ path: testInfo.outputPath('custom-model-save-failed.png') })
    await page.locator('#contextLength').scrollIntoViewIfNeeded()
    await expect(page.locator('#contextLength')).toBeVisible()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('custom providers can be saved without a probe @smoke', async ({ app }, testInfo) => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.writeHead(503).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    await waitForAppReady(app.page)
    const page = await openSettings(app)
    await page.setViewportSize({ width: 900, height: 640 })
    await openSettingsTab(page, 'settings-tab-model-providers')
    await page.getByTestId('provider-add-button').click()
    await page.getByTestId('add-provider-name').fill('Offline fixture')
    await page.getByTestId('add-provider-base-url').fill(`http://127.0.0.1:${port}/v1`)
    await expect(page.getByTestId('add-provider-connect')).toBeDisabled()
    await page.getByTestId('add-provider-save-only').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('save-without-testing.png') })
    await page.getByTestId('add-provider-save-only').click()
    await expect(page.getByTestId('add-provider-flow')).toHaveCount(0)
    const saved = await page.evaluate(async () => {
      const { providers } = await window.deepchat.invoke('providers.list', {})
      return providers.find((provider) => provider.name === 'Offline fixture')
    })
    expect(saved).toMatchObject({ enable: false, apiKey: '', custom: true })
    expect(requests).toEqual([])
    await expect(page.getByTestId('provider-verify-button')).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('saved-disabled-provider.png') })
    await page.getByTestId('provider-models-refresh-button').click()
    await expect.poll(() => requests).toEqual(['GET /v1/models'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('provider-specific fields and save errors remain visible @smoke', async ({
  app
}, testInfo) => {
  await waitForAppReady(app.page)
  await app.page.evaluate(async () => {
    for (const providerId of ['vertex', 'voiceai']) {
      await window.deepchat.invoke('providers.update', {
        providerId,
        updates: { apiKey: 'visual-fixture-key', enable: false }
      })
    }
  })
  const page = await openSettings(app)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openSettingsTab(page, 'settings-tab-model-providers')
  await selectProvider(page, 'vertex')
  await expect(
    page.getByTestId('provider-connection-section').locator('#vertex-projectId')
  ).toBeVisible()
  await expect(page.locator('#vertex-endpointMode')).toHaveCount(0)
  await page.locator('#vertex-projectId').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('vertex-connection.png') })
  await selectProvider(page, 'voiceai')
  await page.getByTestId('provider-advanced-toggle').click()
  await expect(page.locator('#voiceai-tts-model')).toBeEnabled()
  await app.electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
  }, DEEPCHAT_ROUTE_INVOKE_CHANNEL)
  await page.locator('#voiceai-tts-model').fill('unsaved-fixture-model')
  await expect(page.getByTestId('voiceai-config-save-error')).toBeVisible()
  await page.getByTestId('voiceai-config-save-error').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('voiceai-save-failed.png') })
  await selectProvider(page, 'vertex')
  await page.getByTestId('settings-leave-guard-discard').click()
  await expect(page.getByTestId('voiceai-config-save-error')).toHaveCount(0)
})
