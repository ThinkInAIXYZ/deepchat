import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')

import { ChildProcessRegistry } from '@/agent/shared/process/childProcessRegistry'
import { SyncTunnel } from '@/sync/host/tunnel'
import { SyncHostService } from '@/sync/host'

const roots: string[] = []
const tunnels: SyncTunnel[] = []
const hosts: SyncHostService[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop()
  for (const tunnel of tunnels.splice(0)) await tunnel.stop()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function profile() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-connector-test-'))
  roots.push(root)
  return root
}

async function availablePort() {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

describe('sync connector lifecycle', () => {
  it.each(['protect', 'reveal'] as const)(
    'does not launch or enable after stop supersedes a pending %s',
    async (operation) => {
      const root = await profile()
      const entered = Promise.withResolvers<void>()
      const pending = Promise.withResolvers<string>()
      const resolveBinary = vi.fn(() => '/unreachable-connector')
      const blocked = async () => {
        entered.resolve()
        return await pending.promise
      }
      const host = new SyncHostService({
        getUserDataPath: () => root,
        getFolderPath: () => root,
        getAppVersion: () => 'test',
        createBackup: async () => null,
        resolveCloudflared: resolveBinary,
        protectToken: operation === 'protect' ? blocked : async () => 'opaque-token',
        revealToken: operation === 'reveal' ? blocked : async () => 'fixture-token'
      })
      hosts.push(host)
      const enabling = host.setEnabled(true, {
        port: await availablePort(),
        consent: true,
        tunnel: { mode: 'named', publicUrl: 'https://sync.example.test', token: 'fixture-token' }
      })
      const rejected = expect(enabling).rejects.toThrow('busy')
      await entered.promise
      const stopping = host.stop()
      pending.resolve('opaque-result')
      await rejected
      await stopping
      expect(resolveBinary).not.toHaveBeenCalled()
      expect(await host.getStatus()).toMatchObject({ enabled: false, running: false })
    }
  )

  it('does not persist a token when native protection fails', async () => {
    const root = await profile()
    const host = new SyncHostService({
      getUserDataPath: () => root,
      getFolderPath: () => root,
      getAppVersion: () => 'test',
      createBackup: async () => null,
      protectToken: async () => {
        throw new Error('sync.error.safeStorageUnavailable')
      }
    })
    hosts.push(host)
    await expect(
      host.setEnabled(true, {
        port: await availablePort(),
        consent: true,
        tunnel: { mode: 'named', publicUrl: 'https://sync.example.test', token: 'fixture-token' }
      })
    ).rejects.toThrow('safeStorageUnavailable')
    expect(await host.getStatus()).toMatchObject({ enabled: false, running: false })
    const state = await readFile(path.join(root, 'sync-host', 'host-state.json'), 'utf8')
    expect(JSON.parse(state).wrappedTunnelToken).toBeNull()
    expect(state).not.toContain('fixture-token')
  })

  it.skipIf(process.platform === 'win32')(
    'starts and restarts a named connector through async token ports',
    async () => {
      const root = await profile()
      const executable = path.join(root, 'cloudflared')
      const observedPath = path.join(root, 'observed.json')
      await writeFile(
        executable,
        `#!${process.execPath}\n` +
          `require('fs').writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({pid:process.pid,token:process.env.TUNNEL_TOKEN}));\n` +
          `console.error('Registered tunnel connection connIndex=0'); setInterval(() => {}, 1000)\n`,
        { mode: 0o755 }
      )
      const revealToken = vi.fn(async (wrapped: string) =>
        Buffer.from(wrapped, 'base64').toString('utf8')
      )
      const host = new SyncHostService({
        getUserDataPath: () => root,
        getFolderPath: () => root,
        getAppVersion: () => 'test',
        createBackup: async () => null,
        resolveCloudflared: () => executable,
        protectToken: async (token) => Buffer.from(token).toString('base64'),
        revealToken
      })
      hosts.push(host)
      await host.setEnabled(true, {
        port: await availablePort(),
        consent: true,
        tunnel: {
          mode: 'named',
          publicUrl: 'https://sync.example.test',
          token: 'synthetic-host-secret'
        }
      })
      await vi.waitFor(async () => expect((await host.getStatus()).tunnel.phase).toBe('connected'))
      const observed = JSON.parse(await readFile(observedPath, 'utf8'))
      expect(observed.token).toBe('synthetic-host-secret')
      const statePath = path.join(root, 'sync-host', 'host-state.json')
      const before = JSON.parse(await readFile(statePath, 'utf8'))
      expect(JSON.stringify(before)).not.toContain('synthetic-host-secret')
      await host.stop()
      expect(() => process.kill(observed.pid, 0)).toThrow()
      await host.startIfEnabled()
      await vi.waitFor(async () => expect((await host.getStatus()).tunnel.phase).toBe('connected'))
      expect(revealToken).toHaveBeenCalledTimes(2)
      expect(JSON.parse(await readFile(statePath, 'utf8')).wrappedTunnelToken).toBe(
        before.wrappedTunnelToken
      )
    }
  )
  it.skipIf(process.platform === 'win32')(
    'keeps the token out of arguments and launch records, and stops its child',
    async () => {
      const root = await profile()
      const executable = path.join(root, 'cloudflared')
      const observedPath = path.join(root, 'observed.json')
      await writeFile(
        executable,
        `#!${process.execPath}\n` +
          `require('fs').writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({pid:process.pid,args:process.argv,token:process.env.TUNNEL_TOKEN}));\n` +
          `console.error('https://synthetic-test.trycloudflare.com'); console.error('Registered tunnel connection connIndex=0'); setInterval(() => {}, 1000)\n`,
        { mode: 0o755 }
      )
      const tunnel = new SyncTunnel(root, () => executable)
      tunnels.push(tunnel)
      await tunnel.start(
        { mode: 'named', publicUrl: 'https://sync.example.test' },
        48632,
        'synthetic-token'
      )
      await vi.waitFor(() => expect(tunnel.status().phase).toBe('connected'))
      const observed = JSON.parse(await readFile(observedPath, 'utf8'))
      expect(observed.token).toBe('synthetic-token')
      expect(observed.args.join(' ')).not.toContain('synthetic-token')
      expect(observed.args).toContain('auto')
      expect(observed.args).not.toContain('http2')
      expect(JSON.stringify(tunnel.status())).not.toContain('synthetic-token')
      const record = JSON.stringify(
        new ChildProcessRegistry({ rootDir: path.join(root, 'processes') }).list('sync-tunnel')
      )
      expect(record).not.toContain('synthetic-token')
      await tunnel.stop()
      expect(() => process.kill(observed.pid, 0)).toThrow()
      expect(tunnel.status().phase).toBe('stopped')
      await tunnel.start({ mode: 'quick', publicUrl: '' }, 48632)
      await vi.waitFor(() =>
        expect(tunnel.status()).toMatchObject({
          phase: 'connected',
          publicUrl: 'https://synthetic-test.trycloudflare.com'
        })
      )
      const restarted = JSON.parse(await readFile(observedPath, 'utf8'))
      process.kill(restarted.pid, 'SIGTERM')
      await vi.waitFor(() => expect(tunnel.status().phase).toBe('failed'))
    }
  )

  it.skipIf(process.platform === 'win32')(
    'identifies a blocked edge caused by synthetic proxy DNS',
    async () => {
      const root = await profile()
      const executable = path.join(root, 'cloudflared')
      await writeFile(
        executable,
        `#!${process.execPath}\n` +
          `console.error('Tunnel connection curve preferences connIndex=0 ip=198.18.0.46');\n` +
          `console.error('HTTP/2 connection is blocked or unreachable');\n` +
          `setTimeout(() => console.error('HTTP/2 connection is blocked or unreachable'), 500); setInterval(() => {}, 1000)\n`,
        { mode: 0o755 }
      )
      const tunnel = new SyncTunnel(root, () => executable)
      tunnels.push(tunnel)
      await tunnel.start({ mode: 'quick', publicUrl: '' }, 48632)
      await vi.waitFor(() =>
        expect(tunnel.status().error).toBe('sync.tunnel.error.syntheticEdgeIp')
      )
      await vi.waitFor(
        () => expect(tunnel.status().error).toBe('sync.tunnel.error.networkBlocked'),
        {
          timeout: 3000
        }
      )
    }
  )

  it('requires renewed consent before starting a legacy publication-only host', async () => {
    const root = await profile()
    await mkdir(path.join(root, 'sync-host'))
    await writeFile(
      path.join(root, 'sync-host', 'host-state.json'),
      JSON.stringify({
        enabled: true,
        port: 48632,
        consentAt: Date.now(),
        hostId: 'legacy',
        devices: []
      })
    )
    const host = new SyncHostService({
      getUserDataPath: () => root,
      getFolderPath: () => root,
      getAppVersion: () => 'test',
      createBackup: async () => null
    })
    try {
      await host.startIfEnabled()
      expect(await host.getStatus()).toMatchObject({
        enabled: false,
        running: false,
        hostId: 'legacy'
      })
    } finally {
      await host.stop()
    }
  })
})
