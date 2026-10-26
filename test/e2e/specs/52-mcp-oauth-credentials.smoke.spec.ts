import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('MCP machine credentials preserve native ciphertext and settings-window ownership @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const settings = await openSettings(active)
  const binding = await settings.evaluate(async () => {
    await window.deepchat.invoke('mcp.addServer', {
      serverName: 'native-credential-fixture',
      config: {
        type: 'http',
        baseUrl: 'http://127.0.0.1:1/mcp',
        enabled: false,
        command: '',
        args: [],
        env: {},
        descriptions: 'Disposable credential fixture',
        icons: '',
        authorization: {
          mode: 'client_credentials',
          clientId: 'fixture-client',
          authorizationServerIssuer: 'https://auth.example',
          protectedResourceUrl: 'https://resource.example/mcp'
        }
      }
    })
    const { servers } = await window.deepchat.invoke('mcp.getServers', {})
    const config = servers['native-credential-fixture']
    if (!config?.serverId || !config.configGeneration || !config.bindingHash)
      throw new Error('Missing fixture server identity')
    return {
      serverId: config.serverId,
      configGeneration: config.configGeneration,
      bindingHash: config.bindingHash,
      endpoint: config.baseUrl!,
      clientId: config.authorization!.clientId,
      authorizationServerIssuer: config.authorization!.authorizationServerIssuer,
      protectedResourceUrl: config.authorization!.protectedResourceUrl
    }
  })
  const secret = 'disposable-mcp-client-secret'
  await expect(
    active.page.evaluate(
      ({ binding, secret }) =>
        window.deepchat.invoke('mcp.credentials.set', {
          binding,
          credential: { kind: 'client_secret', secret }
        }),
      { binding, secret }
    )
  ).rejects.toThrow('settings window')
  const { status } = await settings.evaluate(
    ({ binding, secret }) =>
      window.deepchat.invoke('mcp.credentials.set', {
        binding,
        credential: { kind: 'client_secret', secret }
      }),
    { binding, secret }
  )
  expect(status).toMatchObject({ configured: true, persistent: true, kind: 'client_secret' })
  const file = join(active.userDataDir, 'mcp-oauth', 'credentials.json')
  expect(existsSync(file)).toBe(true)
  const raw = readFileSync(file, 'utf8')
  expect(raw).not.toContain(secret)
  const envelope = JSON.parse(raw)
  expect(envelope).toMatchObject({ version: 2, storage: 'safeStorage' })
  const legacy = await active.electronApp.evaluate(
    ({ safeStorage }, wrapped) =>
      safeStorage
        .encryptString(safeStorage.decryptString(Buffer.from(wrapped, 'base64')))
        .toString('base64'),
    envelope.wrapped
  )
  expect(await active.close()).toBe('graceful')
  const legacyFile = JSON.stringify({ ...envelope, wrapped: legacy })
  writeFileSync(file, legacyFile)

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const reopenedSettings = await openSettings(reopened)
  const saved = await reopenedSettings.evaluate(
    (serverId) => window.deepchat.invoke('mcp.credentials.getStatus', { serverId }),
    binding.serverId
  )
  expect(saved.credentials.find((credential) => credential.kind === 'client_secret')).toMatchObject(
    { configured: true, persistent: true }
  )
  expect(JSON.stringify(saved)).not.toContain(secret)
  expect(readFileSync(file, 'utf8')).toBe(legacyFile)
  const removed = await reopenedSettings.evaluate(
    (binding) =>
      window.deepchat.invoke('mcp.credentials.remove', { binding, kind: 'client_secret' }),
    binding
  )
  expect(removed.status).toMatchObject({ configured: false, persistent: true })
  expect(await reopened.close()).toBe('graceful')

  const final = await launchApp()
  await waitForAppReady(final.page)
  const finalSettings = await openSettings(final)
  const after = await finalSettings.evaluate(
    (serverId) => window.deepchat.invoke('mcp.credentials.getStatus', { serverId }),
    binding.serverId
  )
  expect(
    after.credentials.find((credential) => credential.kind === 'client_secret')?.configured
  ).toBe(false)
  expect(await final.close()).toBe('graceful')
})
