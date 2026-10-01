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
        updates: { apiKey: 'old-fixture-key', baseUrl: url, enable: true }
      })
      await window.deepchat.invoke('models.addCustom', {
        providerId: provider.id,
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
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
