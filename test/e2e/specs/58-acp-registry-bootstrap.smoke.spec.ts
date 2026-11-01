import { existsSync, readFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { startHttpsFixture } from '../helpers/httpsFixture'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

const registryHost = 'cdn.agentclientprotocol.com'
const registryPath = '/registry/v1/latest/registry.json'

test('ACP registry refresh persists catalog and sanitized icons without legacy writes @smoke', async ({
  launchApp
}) => {
  const agentId = 'rutis-registry-fixture'
  const iconUrl = `https://${registryHost}/registry/v1/latest/${agentId}.svg`
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" onclick="alert(1)"><script>alert(1)</script><path d="M0 0h16v16H0z" /></svg>'
  const https = await startHttpsFixture([registryHost], (request, response) => {
    if (request.url !== registryPath) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(
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
  })
  let active: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    active = await launchApp()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    const legacyFile = join(active.userDataDir, 'acp_agents.json')
    const readLegacy = () => (existsSync(legacyFile) ? readFileSync(legacyFile, 'utf8') : null)
    const legacy = readLegacy()
    await active.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
    }, https.proxyUrl)
    await active.electronApp.evaluate(
      ({ net }, { iconUrl, svg }) => {
        const original = net.fetch
        net.fetch = async (input, init) =>
          String(input) === iconUrl ? new Response(svg) : await original.call(net, input, init)
      },
      { iconUrl, svg }
    )
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
    expect(await active.close()).toBe('graceful')
    active = await launchApp()
    await waitForAppReady(active.page)
    const saved = await active.page.evaluate(() =>
      window.deepchat.invoke('config.listAcpRegistryAgents', {})
    )
    expect(saved.agents).toEqual([
      expect.objectContaining({ id: agentId, version: '1.0.0', enabled: false })
    ])
    const reopened = await active.page.evaluate(
      ({ agentId, iconUrl }) =>
        window.deepchat.invoke('config.getAcpRegistryIconMarkup', { agentId, iconUrl }),
      { agentId, iconUrl }
    )
    expect(reopened.markup).toContain('<path')
    expect(reopened.markup).not.toMatch(/<script|onclick=/i)
    expect(readLegacy()).toBe(legacy)
    expect(await active.close()).toBe('graceful')
  } finally {
    try {
      await active?.close()
    } finally {
      await https.close()
    }
  }
})

test('shutdown drains registry refresh without accepting late catalog or database writes @smoke', async ({
  launchApp
}) => {
  const responses: ServerResponse[] = []
  const https = await startHttpsFixture([registryHost], (request, response) => {
    if (request.url === registryPath) responses.push(response)
    else response.writeHead(404).end()
  })
  let active: Awaited<ReturnType<typeof launchApp>> | undefined
  let refresh: Promise<unknown> | undefined
  try {
    active = await launchApp()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    await active.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
    }, https.proxyUrl)
    const profile = active.userDataDir
    const files = ['registry.json', 'meta.json'].map((file) => join(profile, 'acp-registry', file))
    const readCache = () =>
      files.map((file) => (existsSync(file) ? readFileSync(file, 'utf8') : null))
    const original = readCache()
    refresh = active.page
      .evaluate(() => window.deepchat.invoke('config.refreshAcpRegistry', { force: true }))
      .catch(() => null)
    await expect.poll(() => responses.length).toBe(1)
    expect(responses[0].destroyed).toBe(false)
    expect(await active.close()).toBe('graceful')
    await refresh
    await expect.poll(() => responses[0].destroyed).toBe(true)
    expect(readCache()).toEqual(original)
    active = await launchApp()
    await waitForAppReady(active.page)
    const { agents } = await active.page.evaluate(() =>
      window.deepchat.invoke('config.listAgents', { agentType: 'acp' })
    )
    expect(agents.some((agent) => agent.id === 'late-registry-fixture')).toBe(false)
    expect(await active.close()).toBe('graceful')
  } finally {
    try {
      await active?.close()
      await refresh
    } finally {
      await https.close()
    }
  }
})
