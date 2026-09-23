import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { AutomaticSync } from '@/sync/replica/automatic'
import type { SyncReplicaStore } from '@/sync/replica/store'

vi.unmock('fs')
vi.unmock('node:fs')

// Observe exchange starts through the protocol, with virtual time and real private-file persistence.
describe('Automatic sync timing contract', () => {
  let automatic: AutomaticSync | undefined
  let directory: string
  afterEach(async () => {
    await automatic?.close()
    vi.useRealTimers()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('debounces bursts, limits starts, caps continuous edits and leaves idle data alone', async () => {
    directory = await mkdtemp(join(tmpdir(), 'deepchat-sync-timing-'))
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
    vi.setSystemTime(new Date('2026-09-22T00:00:00Z'))
    let changed = () => {}
    let lastStart = 0
    const starts: number[] = []
    const store = {
      replicaId: 'peer',
      subscribe: (listener: () => void) => {
        changed = listener
        return () => {}
      },
      lastStart: () => lastStart,
      started: (at: number) => {
        lastStart = at
        starts.push(at)
      },
      cursor: () => 0,
      revision: () => 0,
      exportWithStatus: () => ({
        batch: { protocol: 2, replicaId: 'peer', after: 0, through: 0, units: [] },
        blocked: false
      }),
      apply: async () => true
    } as unknown as SyncReplicaStore
    const data = gzipSync(
      JSON.stringify({ protocol: 2, replicaId: 'host', after: 0, through: 0, units: [] })
    )
    const manifest = {
      id: createHash('sha256').update(data).digest('hex'),
      size: data.length,
      parts: 1,
      through: 0,
      replicaId: 'host'
    }
    automatic = new AutomaticSync({
      directory,
      store,
      available: () => true,
      changed: () => {},
      connection: async () => ({
        hostUrl: 'https://sync.example.test',
        hostId: 'host',
        token: 'token'
      }),
      fetch: async (url, options) => {
        const route = new URL(String(url)).pathname
        if (route.endsWith('/events'))
          return new Response(
            new ReadableStream({
              start(controller) {
                const heartbeat = setInterval(
                  () => controller.enqueue(new TextEncoder().encode(': heartbeat\n\n')),
                  25_000
                )
                options?.signal?.addEventListener(
                  'abort',
                  () => {
                    clearInterval(heartbeat)
                    controller.close()
                  },
                  { once: true }
                )
              }
            }),
            { headers: { 'content-type': 'text/event-stream' } }
          )
        if (route.endsWith('/part')) return new Response(data)
        return Response.json(
          route.endsWith('/status')
            ? { protocol: 2, hostId: 'host', replicaId: 'host', revision: 0, writable: true }
            : route.endsWith('/cursor')
              ? { cursor: 0 }
              : manifest
        )
      }
    })
    await automatic.setEnabled(true)
    await vi.waitFor(() => expect(automatic!.status().phase).toBe('idle'))
    // Leave the minimum interval behind; a burst then waits for 15 quiet seconds.
    await vi.advanceTimersByTimeAsync(60_000)
    const before = starts.length
    changed()
    await vi.advanceTimersByTimeAsync(10_000)
    changed()
    await vi.advanceTimersByTimeAsync(14_999)
    expect(starts).toHaveLength(before)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(automatic!.status().phase).toBe('idle'))
    expect(starts).toHaveLength(before + 1)
    const burstStart = lastStart
    changed()
    await vi.advanceTimersByTimeAsync(burstStart + 59_999 - Date.now())
    expect(starts).toHaveLength(before + 1)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(automatic!.status().phase).toBe('idle'))
    expect(lastStart - burstStart).toBe(60_000)
    const firstChange = Date.now()
    changed()
    for (let tick = 0; tick < 11; tick++) {
      await vi.advanceTimersByTimeAsync(10_000)
      changed()
    }
    const continuousBefore = starts.length
    await vi.advanceTimersByTimeAsync(firstChange + 119_999 - Date.now())
    expect(starts).toHaveLength(continuousBefore)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(automatic!.status().phase).toBe('idle'))
    expect(lastStart - firstChange).toBe(120_000)
    const settled = starts.length
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(starts).toHaveLength(settled)
  })

  it('reports an encrypted database without opening a connection', async () => {
    directory = await mkdtemp(join(tmpdir(), 'deepchat-sync-encrypted-'))
    await writeFile(
      join(directory, 'automatic.json'),
      JSON.stringify({ enabled: true, lastSuccessAt: null })
    )
    const connection = vi.fn(async () => null)
    automatic = new AutomaticSync({
      directory,
      store: { subscribe: () => () => {} } as unknown as SyncReplicaStore,
      available: () => false,
      isEncrypted: () => true,
      changed: () => {},
      connection
    })
    await automatic.start()
    expect(automatic.status()).toMatchObject({
      phase: 'failed',
      error: 'sync.tunnel.error.unavailable'
    })
    await expect(automatic.setEnabled(true)).rejects.toThrow('sync.tunnel.error.unavailable')
    expect(connection).not.toHaveBeenCalled()
  })
})
