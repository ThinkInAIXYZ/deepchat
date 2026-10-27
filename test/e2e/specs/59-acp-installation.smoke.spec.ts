import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { zipSync } from 'fflate'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('ACP binary installation and repair persist through the owned cache across reopen @smoke', async ({
  launchApp
}) => {
  let downloads = 0
  const archive = zipSync({ 'fixture-agent': Buffer.from('owned-installation-fixture') })
  const server = createServer((_request, response) => {
    downloads++
    response.writeHead(200, { 'Content-Type': 'application/zip' })
    response.end(archive)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const archiveUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/fixture.zip`
  const agentId = 'owned-installation-fixture'
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  const platformKey = `${platform}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`
  try {
    const active = await launchApp()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    await active.electronApp.evaluate(
      (_electron, data) => {
        const originalFetch = globalThis.fetch
        globalThis.fetch = async (input, init) => {
          if (
            input.toString() ===
            'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
          ) {
            return new Response(
              JSON.stringify({
                version: 'owned-installation-fixture',
                agents: [
                  {
                    id: data.agentId,
                    name: 'Owned installation fixture',
                    version: '1.0.0',
                    distribution: {
                      binary: {
                        [data.platformKey]: { archive: data.archiveUrl, cmd: './fixture-agent' }
                      }
                    }
                  }
                ]
              })
            )
          }
          return originalFetch(input, init)
        }
      },
      { agentId, platformKey, archiveUrl }
    )
    await active.page.evaluate(() =>
      window.deepchat.invoke('config.refreshAcpRegistry', { force: true })
    )
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

    const reopened = await launchApp()
    await waitForAppReady(reopened.page)
    const { agents } = await reopened.page.evaluate(() =>
      window.deepchat.invoke('config.listAcpRegistryAgents', {})
    )
    expect(agents.find((agent) => agent.id === agentId)?.installState?.status).toBe('installed')
    const { installState: existing } = await reopened.page.evaluate(
      (agentId) => window.deepchat.invoke('config.ensureAcpAgentInstalled', { agentId }),
      agentId
    )
    expect(existing.installDir).toBe(installState.installDir)
    expect(existing.status).toBe('installed')
    expect(downloads).toBe(2)
    expect(await reopened.close()).toBe('graceful')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

for (const action of ['shutdown', 'maintenance'] as const) {
  test(`${action} drains a held ACP repair without replacing the acknowledged binary @smoke`, async ({
    launchApp
  }) => {
    const active = await launchApp()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    const appProcess = active.electronApp.process()
    const agentId = 'held-installation-fixture'
    const platform = process.platform === 'win32' ? 'windows' : process.platform
    const platformKey = `${platform}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`
    const archive = Array.from(zipSync({ 'fixture-agent': Buffer.from('acknowledged-binary') }))
    const badArchive = Array.from(zipSync({ 'wrong-agent': Buffer.from('invalid-replacement') }))
    await active.electronApp.evaluate(
      (_electron, data) => {
        const originalFetch = globalThis.fetch
        const fixture = {
          mode: 'install',
          entered: false,
          signal: undefined as AbortSignal | undefined,
          release: () => {}
        }
        globalThis.fetch = async (input, init) => {
          if (
            input.toString() ===
            'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
          ) {
            return new Response(
              JSON.stringify({
                version: 'held-installation-fixture',
                agents: [
                  {
                    id: data.agentId,
                    name: 'Held installation fixture',
                    version: '1.0.0',
                    distribution: {
                      binary: {
                        [data.platformKey]: {
                          archive: 'https://installer.invalid/fixture.zip',
                          cmd: './fixture-agent'
                        }
                      }
                    }
                  }
                ]
              })
            )
          }
          if (input.toString() === 'https://installer.invalid/fixture.zip') {
            if (fixture.mode === 'hold') {
              fixture.signal = init?.signal ?? undefined
              const response = new Response()
              Object.defineProperty(response, 'arrayBuffer', {
                value: () => {
                  fixture.entered = true
                  return new Promise<ArrayBuffer>((resolve) => {
                    fixture.release = () => resolve(new Uint8Array(data.archive).buffer)
                  })
                }
              })
              return response
            }
            return new Response(
              new Uint8Array(fixture.mode === 'bad' ? data.badArchive : data.archive)
            )
          }
          return originalFetch(input, init)
        }
        Object.assign(globalThis, { __acpInstallationFixture: fixture })
      },
      { agentId, platformKey, archive, badArchive }
    )
    await active.page.evaluate(() =>
      window.deepchat.invoke('config.refreshAcpRegistry', { force: true })
    )
    const { installState: original } = await active.page.evaluate(
      (agentId) => window.deepchat.invoke('config.ensureAcpAgentInstalled', { agentId }),
      agentId
    )
    expect(original.status).toBe('installed')
    let acknowledged = original
    const binary = `${original.installDir}/fixture-agent`
    await active.electronApp.evaluate(() => {
      ;(
        globalThis as unknown as { __acpInstallationFixture: { mode: string } }
      ).__acpInstallationFixture.mode = 'hold'
    })
    const repair = active.page
      .evaluate((agentId) => window.deepchat.invoke('config.repairAcpAgent', { agentId }), agentId)
      .then(
        () => 'resolved',
        () => 'rejected'
      )
    const release = () =>
      active.electronApp.evaluate(() => {
        ;(
          globalThis as unknown as { __acpInstallationFixture: { release(): void } }
        ).__acpInstallationFixture.release()
      })
    let maintenance: Promise<unknown> | undefined
    try {
      await expect
        .poll(() =>
          active.electronApp.evaluate(
            () =>
              (globalThis as unknown as { __acpInstallationFixture: { entered: boolean } })
                .__acpInstallationFixture.entered
          )
        )
        .toBe(true)
      expect(readFileSync(binary, 'utf8')).toBe('acknowledged-binary')
      if (action === 'shutdown') {
        await active.electronApp.evaluate(({ app }) => {
          setImmediate(() => app.quit())
        })
      } else {
        maintenance = active.page.evaluate(() =>
          window.deepchat.invoke('databaseSecurity.enable', {
            password: 'owned-installation-maintenance-password'
          })
        )
      }
      await expect
        .poll(() =>
          active.electronApp.evaluate(
            () =>
              (globalThis as unknown as { __acpInstallationFixture: { signal?: AbortSignal } })
                .__acpInstallationFixture.signal?.aborted
          )
        )
        .toBe(true)
      expect(appProcess.exitCode).toBeNull()
      expect(readFileSync(binary, 'utf8')).toBe('acknowledged-binary')
      await release()
      if (action === 'shutdown') await expect.poll(() => appProcess.exitCode).toBe(0)
      else await expect(maintenance).resolves.toMatchObject({ status: { enabled: true } })
    } finally {
      await release().catch(() => undefined)
    }
    expect(await repair).toBe('rejected')
    expect(readFileSync(binary, 'utf8')).toBe('acknowledged-binary')
    expect(readdirSync(dirname(original.installDir!))).toEqual(['1.0.0'])
    if (action === 'maintenance') {
      await active.electronApp.evaluate(() => {
        ;(
          globalThis as unknown as { __acpInstallationFixture: { mode: string } }
        ).__acpInstallationFixture.mode = 'bad'
      })
      const { installState: failed } = await active.page.evaluate(
        (agentId) => window.deepchat.invoke('config.repairAcpAgent', { agentId }),
        agentId
      )
      expect(failed.status).toBe('error')
      expect(readFileSync(binary, 'utf8')).toBe('acknowledged-binary')
      await active.electronApp.evaluate(() => {
        ;(
          globalThis as unknown as { __acpInstallationFixture: { mode: string } }
        ).__acpInstallationFixture.mode = 'install'
      })
      const { installState: recovered } = await active.page.evaluate(
        (agentId) => window.deepchat.invoke('config.repairAcpAgent', { agentId }),
        agentId
      )
      expect(recovered.status).toBe('installed')
      acknowledged = recovered
    }
    expect(await active.close()).toBe('graceful')
    const reopened = await launchApp()
    await waitForAppReady(reopened.page)
    const { agents } = await reopened.page.evaluate(() =>
      window.deepchat.invoke('config.listAcpRegistryAgents', {})
    )
    expect(agents.find((agent) => agent.id === agentId)?.installState).toEqual(acknowledged)
    expect(readFileSync(binary, 'utf8')).toBe('acknowledged-binary')
    if (action === 'maintenance') {
      await reopened.page.evaluate(
        (agentId) => window.deepchat.invoke('config.uninstallAcpRegistryAgent', { agentId }),
        agentId
      )
      expect(existsSync(original.installDir!)).toBe(false)
      const { agents: uninstalled } = await reopened.page.evaluate(() =>
        window.deepchat.invoke('config.listAcpRegistryAgents', {})
      )
      expect(uninstalled.find((agent) => agent.id === agentId)?.installState?.status).toBe(
        'not_installed'
      )
    }
    expect(await reopened.close()).toBe('graceful')
  })
}
