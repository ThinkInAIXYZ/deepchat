import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { startHttpsFixture } from '../helpers/httpsFixture'
import { waitForAppReady } from '../helpers/wait'
import {
  SYNC_HOST_PROTOCOL_NAME,
  SYNC_HOST_PROTOCOL_VERSION
} from '../../../src/shared/contracts/syncHost'

const host = 'sync-token-fixture.invalid'
const hostUrl = `https://${host}`
const hostId = 'sync-token-fixture'
const token = 'disposable-sync-token-credential-fixture'

test.use({ privacyModeEnabled: true })

test('peer credentials stay wrapped and read legacy ciphertext after relaunch @smoke', async ({
  launchApp
}) => {
  const authorized: string[] = []
  const https = await startHttpsFixture([host], (request, response) => {
    const reply = (status: number, body: object) =>
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    if (request.url === '/sync/v1/handshake' && request.method === 'GET') {
      reply(200, {
        protocol: SYNC_HOST_PROTOCOL_NAME,
        protocolVersion: SYNC_HOST_PROTOCOL_VERSION,
        hostId,
        appVersion: 'fixture',
        capabilities: ['snapshot'],
        encryption: { payload: 'none', transport: 'tls' }
      })
    } else if (request.url === '/sync/v1/pair' && request.method === 'POST') {
      reply(200, { deviceId: 'fixture-device', deviceName: 'Fixture device', token })
    } else if (request.headers.authorization !== `Bearer ${token}`) {
      reply(401, {})
    } else {
      authorized.push(request.url ?? '')
      if (request.url === '/sync/v1/status') reply(200, { serverTime: Date.now(), snapshot: null })
      else reply(404, {})
    }
  })
  let active: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    active = await launchApp()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    await active.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
    }, https.proxyUrl)
    const file = join(active.userDataDir, 'sync-peer', 'pairing.json')
    const status = await active.page.evaluate(
      (input) => window.deepchat.invoke('syncPeer.pair', input),
      { hostUrl, hostId, code: 'fixture-code', deviceName: 'Fixture device' }
    )
    expect(status.paired).toBe(true)
    expect(JSON.stringify(status)).not.toContain(token)
    const current = readFileSync(file, 'utf8')
    expect(current).not.toContain(token)
    expect(typeof JSON.parse(current).wrappedToken).toBe('string')
    const legacy = await active.electronApp.evaluate(
      ({ safeStorage }, value) => safeStorage.encryptString(value).toString('base64'),
      token
    )
    expect(await active.close()).toBe('graceful')
    const pairing = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, JSON.stringify({ ...pairing, wrappedToken: legacy }))
    active = await launchApp()
    await waitForAppReady(active.page)
    await active.page.evaluate(() => window.deepchat.invoke('syncPeer.pull', { mode: 'increment' }))
    await expect
      .poll(() => active!.page.evaluate(() => window.deepchat.invoke('syncPeer.getStatus', {})))
      .toMatchObject({
        paired: true,
        phase: 'failed',
        error: 'sync.tunnel.error.noSnapshot'
      })
    expect(authorized).toContain('/sync/v1/status')
    expect(authorized).toContain('/sync/v1/prepare')
    expect(JSON.parse(readFileSync(file, 'utf8')).wrappedToken).toBe(legacy)
    const forgotten = await active.page.evaluate(() =>
      window.deepchat.invoke('syncPeer.forget', {})
    )
    expect(forgotten.paired).toBe(false)
    expect(await active.close()).toBe('graceful')
  } finally {
    try {
      await active?.close()
    } finally {
      await https.close()
    }
  }
})
