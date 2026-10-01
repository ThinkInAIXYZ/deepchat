import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab, selectProvider } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

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

    await page.getByTestId('provider-update-key-button').click()
    await page.getByTestId('provider-api-key-input').fill('replacement-fixture-key')
    await page.getByTestId('provider-api-key-input').blur()
    await expect(page.getByTestId('provider-verify-button')).toBeDisabled()
    await expect(page.getByTestId('provider-connection-save')).toBeEnabled()
    await page.getByTestId('provider-health-pill').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('connection-dirty.png') })
    await page.setViewportSize({ width: 1100, height: 760 })
    await page
      .getByTestId('provider-connection-section')
      .screenshot({ path: testInfo.outputPath('connection-dirty-compact.png') })
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
    await page.screenshot({ path: testInfo.outputPath('connection-verified.png') })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
