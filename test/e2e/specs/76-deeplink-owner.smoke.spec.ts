import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('OS provider deeplinks observe existing providers and preserve saved credentials @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)
  const provider = await app.page.evaluate(async () => {
    const id = `custom-${crypto.randomUUID()}`
    return (
      await window.deepchat.invoke('providers.add', {
        provider: {
          id,
          name: 'Deep link owner fixture',
          apiType: 'openai-completions',
          baseUrl: 'https://saved.example.com/v1',
          apiKey: 'saved-only-fixture-key',
          enable: false,
          custom: true,
          customModels: []
        }
      })
    ).provider
  })
  const baseUrl = 'https://incoming.example.com/v1'
  const payload = Buffer.from(
    JSON.stringify({ id: provider.id, baseUrl, apiKey: 'incoming-only-fixture-key' })
  ).toString('base64')
  const link = `deepchat://provider/install?v=1&data=${encodeURIComponent(payload)}`
  await app.electronApp.evaluate(({ app }, link) => {
    app.emit('open-url', { preventDefault() {}, defaultPrevented: false }, link)
  }, link)
  await expect
    .poll(() =>
      app.electronApp.windows().some((page) => page.url().includes('/settings/index.html'))
    )
    .toBe(true)
  const settings = app.electronApp
    .windows()
    .find((page) => page.url().includes('/settings/index.html'))!
  await expect(settings.getByTestId('settings-provider-page')).toBeVisible()
  await expect(settings.getByText(baseUrl, { exact: true })).toBeVisible()
  const saved = (
    await app.page.evaluate(() => window.deepchat.invoke('providers.list', {}))
  ).providers.find((item) => item.id === provider.id)
  expect(saved?.apiKey).toBe('saved-only-fixture-key')
  expect(saved?.baseUrl).toBe('https://saved.example.com/v1')
  expect(app.pageErrors).toEqual([])
})
