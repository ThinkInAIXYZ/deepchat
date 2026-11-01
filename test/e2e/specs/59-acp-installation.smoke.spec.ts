import { createServer, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { zipSync } from 'fflate'
import { test, expect } from '../fixtures/electronApp'
import { startHttpsFixture } from '../helpers/httpsFixture'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

function registry(agentId: string, archiveUrl: string) {
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  const key = `${platform}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`
  return {
    version: agentId,
    agents: [
      {
        id: agentId,
        name: 'Installation fixture',
        version: '1.0.0',
        distribution: { binary: { [key]: { archive: archiveUrl, cmd: './fixture-agent' } } }
      }
    ]
  }
}

test('ACP binary installation and repair persist through the owned cache across reopen @smoke', async ({
  launchApp
}) => {
  let downloads = 0
  const archive = zipSync({ 'fixture-agent': Buffer.from('owned-installation-fixture') })
  const server = createServer((_request, response) => {
    downloads++
    response.writeHead(200, { 'content-type': 'application/zip' }).end(archive)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const archiveUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/fixture.zip`
  const agentId = 'owned-installation-fixture'
  const https = await startHttpsFixture(['cdn.agentclientprotocol.com'], (request, response) => {
    if (request.url !== '/registry/v1/latest/registry.json') {
      response.writeHead(404).end()
      return
    }
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(registry(agentId, archiveUrl)))
  })
  let active: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    active = await launchApp()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    await active.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
      await window.deepchat.invoke('config.refreshAcpRegistry', { force: true })
    }, https.proxyUrl)
    const { installState } = await active.page.evaluate(
      (agentId) => window.deepchat.invoke('config.ensureAcpAgentInstalled', { agentId }),
      agentId
    )
    expect(installState).toMatchObject({
      status: 'installed',
      version: '1.0.0',
      distributionType: 'binary'
    })
    const binary = `${installState.installDir}/fixture-agent`
    expect(readFileSync(binary, 'utf8')).toBe('owned-installation-fixture')
    const { installState: repaired } = await active.page.evaluate(
      (agentId) => window.deepchat.invoke('config.repairAcpAgent', { agentId }),
      agentId
    )
    expect(repaired.status).toBe('installed')
    expect(readFileSync(binary, 'utf8')).toBe('owned-installation-fixture')
    expect(downloads).toBe(2)
    expect(await active.close()).toBe('graceful')
    active = await launchApp()
    await waitForAppReady(active.page)
    const { agents } = await active.page.evaluate(() =>
      window.deepchat.invoke('config.listAcpRegistryAgents', {})
    )
    expect(agents.find((agent) => agent.id === agentId)?.installState?.status).toBe('installed')
    const existing = await active.page.evaluate(
      (agentId) => window.deepchat.invoke('config.ensureAcpAgentInstalled', { agentId }),
      agentId
    )
    expect(existing.installState).toMatchObject({
      installDir: installState.installDir,
      status: 'installed'
    })
    expect(downloads).toBe(2)
    expect(await active.close()).toBe('graceful')
  } finally {
    try {
      await active?.close()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await https.close()
    }
  }
})

for (const action of ['shutdown', 'maintenance'] as const) {
  test(`${action} drains a held ACP repair without replacing the acknowledged binary @smoke`, async ({
    launchApp
  }) => {
    const archive = zipSync({ 'fixture-agent': Buffer.from('acknowledged-binary') })
    const badArchive = zipSync({ 'wrong-agent': Buffer.from('invalid-replacement') })
    let mode: 'install' | 'hold' | 'bad' = 'install'
    const held: ServerResponse[] = []
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/zip' })
      if (mode === 'hold') {
        held.push(response)
        response.write(archive.subarray(0, 8))
      } else response.end(mode === 'bad' ? badArchive : archive)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const archiveUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/fixture.zip`
    const agentId = 'held-installation-fixture'
    const https = await startHttpsFixture(['cdn.agentclientprotocol.com'], (request, response) => {
      if (request.url !== '/registry/v1/latest/registry.json') {
        response.writeHead(404).end()
        return
      }
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(registry(agentId, archiveUrl)))
    })
    let active: Awaited<ReturnType<typeof launchApp>> | undefined
    let repair: Promise<string> | undefined
    try {
      active = await launchApp()
      expect(active.ownsUserDataDir).toBe(true)
      await waitForAppReady(active.page)
      await active.page.evaluate(async (url) => {
        await window.deepchat.invoke('config.setCustomProxyUrl', { url })
        await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
        await window.deepchat.invoke('config.refreshAcpRegistry', { force: true })
      }, https.proxyUrl)
      const { installState: original } = await active.page.evaluate(
        (agentId) => window.deepchat.invoke('config.ensureAcpAgentInstalled', { agentId }),
        agentId
      )
      expect(original.status).toBe('installed')
      let acknowledged = original
      const binary = `${original.installDir}/fixture-agent`
      mode = 'hold'
      repair = active.page
        .evaluate(
          (agentId) => window.deepchat.invoke('config.repairAcpAgent', { agentId }),
          agentId
        )
        .then(
          () => 'resolved',
          () => 'rejected'
        )
      await expect.poll(() => held.length).toBe(1)
      expect(held[0].destroyed).toBe(false)
      expect(readFileSync(binary, 'utf8')).toBe('acknowledged-binary')
      if (action === 'shutdown') expect(await active.close()).toBe('graceful')
      else
        await expect(
          active.page.evaluate(() =>
            window.deepchat.invoke('databaseSecurity.enable', {
              password: 'owned-installation-maintenance-password'
            })
          )
        ).resolves.toMatchObject({ status: { enabled: true } })
      await expect.poll(() => held[0].destroyed).toBe(true)
      expect(await repair).toBe('rejected')
      expect(readFileSync(binary, 'utf8')).toBe('acknowledged-binary')
      expect(readdirSync(dirname(original.installDir!))).toEqual(['1.0.0'])
      if (action === 'maintenance') {
        mode = 'bad'
        const { installState: failed } = await active.page.evaluate(
          (agentId) => window.deepchat.invoke('config.repairAcpAgent', { agentId }),
          agentId
        )
        expect(failed.status).toBe('error')
        expect(failed.error).toContain('Installed archive does not contain ./fixture-agent')
        expect(readFileSync(binary, 'utf8')).toBe('acknowledged-binary')
        mode = 'install'
        const { installState: recovered } = await active.page.evaluate(
          (agentId) => window.deepchat.invoke('config.repairAcpAgent', { agentId }),
          agentId
        )
        expect(recovered.status).toBe('installed')
        acknowledged = recovered
      }
      expect(await active.close()).toBe('graceful')
      active = await launchApp()
      await waitForAppReady(active.page)
      const { agents } = await active.page.evaluate(() =>
        window.deepchat.invoke('config.listAcpRegistryAgents', {})
      )
      expect(agents.find((agent) => agent.id === agentId)?.installState).toEqual(acknowledged)
      expect(readFileSync(binary, 'utf8')).toBe('acknowledged-binary')
      if (action === 'maintenance') {
        await active.page.evaluate(
          (agentId) => window.deepchat.invoke('config.uninstallAcpRegistryAgent', { agentId }),
          agentId
        )
        expect(existsSync(original.installDir!)).toBe(false)
        const uninstalled = await active.page.evaluate(() =>
          window.deepchat.invoke('config.listAcpRegistryAgents', {})
        )
        expect(uninstalled.agents.find((agent) => agent.id === agentId)?.installState?.status).toBe(
          'not_installed'
        )
      }
      expect(await active.close()).toBe('graceful')
    } finally {
      try {
        await active?.close()
        await repair
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        await https.close()
      }
    }
  })
}
