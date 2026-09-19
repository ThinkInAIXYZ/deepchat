import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// This suite exercises real files on disk, so the global partial `fs` mock from test/setup.ts must
// not apply here.
vi.unmock('fs')
vi.unmock('node:fs')

import { SyncHostStateStore } from '@/sync/host/state'

/**
 * Durability rules for the machine-local host state. These are unit tests because the failure modes
 * they pin (a write that cannot land, a read that cannot complete) are not reachable through the
 * service without an unwritable filesystem.
 */
describe('SyncHostStateStore', () => {
  let directory: string
  let store: SyncHostStateStore

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-sync-host-state-'))
    store = new SyncHostStateStore(directory)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  /** Makes every write fail: the atomic rename cannot replace a non-empty directory. */
  async function blockWrites(): Promise<void> {
    await mkdir(store.filePath, { recursive: true })
    await writeFile(path.join(store.filePath, 'blocker'), 'x')
  }

  it('rolls back concurrent updates when their writes fail', async () => {
    await store.load()
    await blockWrites()

    // Two updates in flight at once. Serializing only the filesystem writes would let the second
    // one snapshot the first one's mutation, which would both block the rollback and persist a
    // change whose caller was told it failed.
    const results = await Promise.allSettled([
      store.update((state) => {
        state.enabled = true
      }),
      store.update((state) => {
        state.devices.push({
          deviceId: 'dev_blocked',
          name: 'Blocked',
          tokenHash: 'a'.repeat(64),
          createdAt: 1,
          lastSeenAt: null,
          expiresAt: null,
          revokedAt: null
        })
      })
    ])

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(store.snapshot()).toMatchObject({ enabled: false, devices: [] })
  })

  it('keeps a failed mutation out of the next successful write', async () => {
    await store.load()
    await blockWrites()
    await expect(
      store.update((state) => {
        state.enabled = true
      })
    ).rejects.toThrow()

    // Unblock the path and write something legitimate.
    await rm(store.filePath, { recursive: true, force: true })
    await store.update((state) => {
      state.hostId = 'host-after-failure'
    })

    const persisted = JSON.parse(await readFile(store.filePath, 'utf8')) as { enabled: boolean }
    expect(persisted.enabled).toBe(false)
  })

  it('fails closed on an unreadable state file instead of resetting to defaults', async () => {
    await writeFile(store.filePath, '{ not json')

    await expect(store.load()).rejects.toThrow()
    expect(store.isLoaded()).toBe(false)
    // The damaged file is left alone: a transient read or parse failure must never be turned into
    // an empty default state that the next write persists over the real one.
    expect(await readFile(store.filePath, 'utf8')).toBe('{ not json')

    await writeFile(
      store.filePath,
      `${JSON.stringify({ enabled: true, hostId: 'host-1', devices: [] })}\n`
    )
    expect((await store.load()).enabled).toBe(true)
  })
})
