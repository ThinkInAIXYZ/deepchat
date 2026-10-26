import type { ElectronApplication } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import {
  SYNC_HOST_PROTOCOL_NAME,
  SYNC_HOST_PROTOCOL_VERSION
} from '../../../src/shared/contracts/syncHost'

const hostUrl = 'https://sync-token-fixture.invalid'
const hostId = 'sync-token-fixture'
const token = 'disposable-sync-token-credential-fixture'

async function interceptHost(app: ElectronApplication) {
  await app.evaluate(
    ({ app }, fixture) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(joinPath(app.getAppPath(), 'package.json'))
      const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } =
        require('undici') as typeof import('undici')
      const previous = getGlobalDispatcher()
      const agent = new MockAgent()
      agent.disableNetConnect()
      const host = agent.get(fixture.hostUrl)
      const json = { headers: { 'content-type': 'application/json' } }
      host
        .intercept({ path: '/sync/v1/handshake', method: 'GET' })
        .reply(
          200,
          {
            protocol: fixture.protocol,
            protocolVersion: fixture.version,
            hostId: fixture.hostId,
            appVersion: 'fixture',
            capabilities: ['snapshot'],
            encryption: { payload: 'none', transport: 'tls' }
          },
          json
        )
        .persist()
      host.intercept({ path: '/sync/v1/pair', method: 'POST' }).reply(
        200,
        {
          deviceId: 'fixture-device',
          deviceName: 'Fixture device',
          token: fixture.token
        },
        json
      )
      const headers = { authorization: `Bearer ${fixture.token}` }
      host.intercept({ path: '/sync/v1/status', method: 'GET', headers }).reply(
        200,
        {
          serverTime: Date.now(),
          snapshot: null
        },
        json
      )
      host.intercept({ path: '/sync/v1/prepare', method: 'POST', headers }).reply(404, {}, json)
      const state = globalThis as typeof globalThis & {
        restoreSyncTokenFixture?: () => Promise<void>
      }
      state.restoreSyncTokenFixture = async () => {
        setGlobalDispatcher(previous)
        delete state.restoreSyncTokenFixture
        await agent.close()
      }
      setGlobalDispatcher(agent)
      function joinPath(directory: string, file: string) {
        return process.getBuiltinModule('path').join(directory, file)
      }
    },
    {
      hostUrl,
      hostId,
      token,
      protocol: SYNC_HOST_PROTOCOL_NAME,
      version: SYNC_HOST_PROTOCOL_VERSION
    }
  )
}

async function restoreHost(app: ElectronApplication) {
  await app.evaluate(async () => {
    await (
      globalThis as typeof globalThis & { restoreSyncTokenFixture?: () => Promise<void> }
    ).restoreSyncTokenFixture?.()
  })
}

test.use({ privacyModeEnabled: true })

test('peer credentials stay wrapped and read legacy ciphertext after relaunch @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  await interceptHost(active.electronApp)
  const file = join(active.userDataDir, 'sync-peer', 'pairing.json')
  try {
    const status = await active.page.evaluate(
      (input) => window.deepchat.invoke('syncPeer.pair', input),
      {
        hostUrl,
        hostId,
        code: 'fixture-code',
        deviceName: 'Fixture device'
      }
    )
    expect(status.paired).toBe(true)
    expect(JSON.stringify(status)).not.toContain(token)
    const current = readFileSync(file, 'utf8')
    expect(current).not.toContain(token)
    expect(typeof JSON.parse(current).wrappedToken).toBe('string')
  } finally {
    await restoreHost(active.electronApp)
  }
  const legacy = await active.electronApp.evaluate(
    ({ safeStorage }, value) => safeStorage.encryptString(value).toString('base64'),
    token
  )
  const pairing = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...pairing, wrappedToken: legacy }))
  expect(await active.close()).toBe('graceful')

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  await interceptHost(reopened.electronApp)
  try {
    await reopened.page.evaluate(() =>
      window.deepchat.invoke('syncPeer.pull', { mode: 'increment' })
    )
    await expect
      .poll(() => reopened.page.evaluate(() => window.deepchat.invoke('syncPeer.getStatus', {})))
      .toMatchObject({
        paired: true,
        phase: 'failed',
        error: 'sync.tunnel.error.noSnapshot'
      })
    expect(JSON.parse(readFileSync(file, 'utf8')).wrappedToken).toBe(legacy)
    const forgotten = await reopened.page.evaluate(() =>
      window.deepchat.invoke('syncPeer.forget', {})
    )
    expect(forgotten.paired).toBe(false)
  } finally {
    await restoreHost(reopened.electronApp)
  }
  expect(await reopened.close()).toBe('graceful')
})
