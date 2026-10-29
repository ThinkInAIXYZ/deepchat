import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import type { ModelType } from '../../../src/shared/model'

test.use({ privacyModeEnabled: true })

test('model facts and user overrides persist without rewriting legacy JSON @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const legacyFiles = [
    join(active.userDataDir, 'model-config.json'),
    join(active.userDataDir, 'provider_models', 'models_openai.json')
  ]
  const readLegacyFiles = () =>
    legacyFiles.map((file) => (existsSync(file) ? readFileSync(file, 'utf8') : null))
  const legacyContents = readLegacyFiles()
  const selection = { providerId: 'openai', modelId: 'store-fixture-model' }
  await active.page.evaluate(async ({ providerId, modelId }) => {
    await window.deepchat.invoke('models.saveCustom', {
      providerId,
      model: { id: modelId, name: 'Store fixture model', type: 'chat' as ModelType, enabled: true },
      config: {
        maxTokens: 12000,
        contextLength: 64000,
        temperature: 0.4,
        vision: false,
        functionCall: true,
        reasoning: false,
        type: 'chat' as ModelType,
        isUserDefined: true
      }
    })
  }, selection)
  expect(await active.close()).toBe('graceful')
  expect(readLegacyFiles()).toEqual(legacyContents)

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const persisted = await reopened.page.evaluate(
    async (selection) => ({
      ...(await window.deepchat.invoke('models.getConfig', selection)),
      ...(await window.deepchat.invoke('models.hasUserConfig', selection)),
      ...(await window.deepchat.invoke('models.getProviderCatalog', {
        providerId: selection.providerId
      }))
    }),
    selection
  )
  expect(persisted).toMatchObject({
    hasConfig: true,
    config: { maxTokens: 12000, contextLength: 64000, temperature: 0.4, isUserDefined: true },
    catalog: { customModels: [expect.objectContaining({ id: selection.modelId })] }
  })
  await reopened.page.evaluate(async (selection) => {
    await window.deepchat.invoke('models.resetConfig', selection)
    await window.deepchat.invoke('models.removeCustom', selection)
  }, selection)
  expect(await reopened.close()).toBe('graceful')

  const removed = await launchApp()
  await waitForAppReady(removed.page)
  const final = await removed.page.evaluate(
    async (selection) => ({
      ...(await window.deepchat.invoke('models.hasUserConfig', selection)),
      ...(await window.deepchat.invoke('models.getProviderCatalog', {
        providerId: selection.providerId
      }))
    }),
    selection
  )
  expect(final.hasConfig).toBe(false)
  expect(final.catalog.customModels).not.toContainEqual(
    expect.objectContaining({ id: selection.modelId })
  )
  expect(readLegacyFiles()).toEqual(legacyContents)
})
