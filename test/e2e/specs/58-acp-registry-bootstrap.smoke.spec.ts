import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('ACP registry refresh persists catalog and sanitized icons without legacy writes @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const legacyFile = join(active.userDataDir, 'acp_agents.json')
  const readLegacy = () => (existsSync(legacyFile) ? readFileSync(legacyFile, 'utf8') : null)
  const legacy = readLegacy()
  const agentId = 'rutis-registry-fixture'
  const iconUrl = `https://cdn.agentclientprotocol.com/registry/v1/latest/${agentId}.svg`
  await active.electronApp.evaluate(
    ({ net }, { agentId, iconUrl }) => {
      const originalFetch = globalThis.fetch
      const originalIconFetch = net.fetch
      globalThis.fetch = async (input, init) => {
        if (
          input.toString() ===
          'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
        ) {
          return new Response(
            JSON.stringify({
              version: 'rutis-registry-fixture-v1',
              agents: [
                {
                  id: agentId,
                  name: 'Registry fixture',
                  version: '1.0.0',
                  icon: iconUrl,
                  distribution: { npx: { package: '@deepchat/registry-fixture@1.0.0' } }
                }
              ]
            })
          )
        }
        return originalFetch(input, init)
      }
      net.fetch = async (input, init) => {
        if (input.toString() === iconUrl) {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" onclick="alert(1)"><script>alert(1)</script><path d="M0 0h16v16H0z" /></svg>'
          )
        }
        return originalIconFetch.call(net, input, init)
      }
      Object.assign(globalThis, {
        __acpRegistryRestore: () => {
          globalThis.fetch = originalFetch
          net.fetch = originalIconFetch
        }
      })
    },
    { agentId, iconUrl }
  )
  try {
    const { agents } = await active.page.evaluate(() =>
      window.deepchat.invoke('config.refreshAcpRegistry', { force: true })
    )
    expect(agents).toEqual([
      expect.objectContaining({ id: agentId, version: '1.0.0', enabled: false })
    ])
    const { markup } = await active.page.evaluate(
      ({ agentId, iconUrl }) =>
        window.deepchat.invoke('config.getAcpRegistryIconMarkup', { agentId, iconUrl }),
      { agentId, iconUrl }
    )
    expect(markup).toContain('<path')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toMatch(/<script|onclick=/i)
    const cache = join(active.userDataDir, 'acp-registry')
    expect(JSON.parse(readFileSync(join(cache, 'registry.json'), 'utf8')).version).toBe(
      'rutis-registry-fixture-v1'
    )
    expect(readFileSync(join(cache, 'icons', `${agentId}.svg`), 'utf8')).not.toMatch(
      /<script|onclick=/i
    )
    expect(readLegacy()).toBe(legacy)
  } finally {
    await active.electronApp.evaluate(() => {
      ;(globalThis as unknown as { __acpRegistryRestore(): void }).__acpRegistryRestore()
    })
  }
  expect(await active.close()).toBe('graceful')
  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const { agents } = await reopened.page.evaluate(() =>
    window.deepchat.invoke('config.listAcpRegistryAgents', {})
  )
  expect(agents).toEqual([
    expect.objectContaining({ id: agentId, version: '1.0.0', enabled: false })
  ])
  const { markup } = await reopened.page.evaluate(
    ({ agentId, iconUrl }) =>
      window.deepchat.invoke('config.getAcpRegistryIconMarkup', { agentId, iconUrl }),
    { agentId, iconUrl }
  )
  expect(markup).toContain('<path')
  expect(markup).not.toMatch(/<script|onclick=/i)
  expect(readLegacy()).toBe(legacy)
  expect(await reopened.close()).toBe('graceful')
})

test('shutdown drains registry refresh without accepting late catalog or database writes @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const appProcess = active.electronApp.process()
  const files = ['registry.json', 'meta.json'].map((file) =>
    join(active.userDataDir, 'acp-registry', file)
  )
  const readCache = () =>
    files.map((file) => (existsSync(file) ? readFileSync(file, 'utf8') : null))
  const original = readCache()
  await active.electronApp.evaluate(() => {
    const originalFetch = globalThis.fetch
    const fixture = {
      entered: false,
      signal: undefined as AbortSignal | undefined,
      release: () => {}
    }
    globalThis.fetch = async (input, init) => {
      if (
        input.toString() === 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
      ) {
        fixture.entered = true
        fixture.signal = init?.signal ?? undefined
        return new Promise<Response>((resolve) => {
          fixture.release = () => {
            globalThis.fetch = originalFetch
            resolve(
              new Response(
                JSON.stringify({
                  version: 'late-registry-fixture',
                  agents: [
                    {
                      id: 'late-registry-fixture',
                      name: 'Late registry fixture',
                      version: '1.0.0',
                      distribution: { npx: { package: '@deepchat/late-registry-fixture@1.0.0' } }
                    }
                  ]
                })
              )
            )
          }
        })
      }
      return originalFetch(input, init)
    }
    Object.assign(globalThis, { __acpRegistryFixture: fixture })
  })
  const refresh = active.page
    .evaluate(() => window.deepchat.invoke('config.refreshAcpRegistry', { force: true }))
    .catch(() => null)
  const release = () =>
    active.electronApp.evaluate(() => {
      ;(
        globalThis as unknown as { __acpRegistryFixture: { release(): void } }
      ).__acpRegistryFixture.release()
    })
  try {
    await expect
      .poll(() =>
        active.electronApp.evaluate(
          () =>
            (globalThis as unknown as { __acpRegistryFixture: { entered: boolean } })
              .__acpRegistryFixture.entered
        )
      )
      .toBe(true)
    await active.electronApp.evaluate(({ app }) => {
      setImmediate(() => app.quit())
    })
    await expect
      .poll(() =>
        active.electronApp.evaluate(
          () =>
            (globalThis as unknown as { __acpRegistryFixture: { signal?: AbortSignal } })
              .__acpRegistryFixture.signal?.aborted
        )
      )
      .toBe(true)
    expect(appProcess.exitCode).toBeNull()
    await release()
    await expect.poll(() => appProcess.exitCode).toBe(0)
  } finally {
    await release().catch(() => undefined)
  }
  await refresh
  expect(await active.close()).toBe('graceful')
  expect(readCache()).toEqual(original)
  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const { agents } = await reopened.page.evaluate(() =>
    window.deepchat.invoke('config.listAgents', { agentType: 'acp' })
  )
  expect(agents.some((agent) => agent.id === 'late-registry-fixture')).toBe(false)
  expect(await reopened.close()).toBe('graceful')
})
