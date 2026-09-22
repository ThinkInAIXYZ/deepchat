import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')

import { ChildProcessRegistry } from '@/agent/shared/process/childProcessRegistry'
import { SyncTunnel } from '@/sync/host/tunnel'
import { SyncHostService } from '@/sync/host'

const roots: string[] = []
const tunnels: SyncTunnel[] = []
afterEach(async () => {
  for (const tunnel of tunnels.splice(0)) await tunnel.stop()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function profile() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-connector-test-'))
  roots.push(root)
  return root
}

describe('sync connector lifecycle', () => {
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
