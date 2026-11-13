import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NativeReplicaRecovery } from '@/sync/replica/nativeRecovery'
import { writeDimProfileRecovery, recoverDimProfile } from '@/agent/dim/profileRecovery'
import { writeDurableJson } from '@/data/durableFile'
import { requireDatabase, describeIfNativeSqlite } from '../nativeSqliteHarness'

vi.unmock('fs')
vi.unmock('node:fs')

describeIfNativeSqlite('Native replica recovery', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    cleanups.length = 0
  })
  async function admission(phase: 'prepared' | 'installed' = 'installed') {
    const root = await mkdtemp(join(tmpdir(), 'dc-native-receipt-'))
    const db = new (requireDatabase())(join(root, 'agent.db'))
    db.exec(
      'CREATE TABLE _sync_native_receipts(token TEXT PRIMARY KEY,replica TEXT,through INTEGER); CREATE TABLE _sync_receipts(replica TEXT PRIMARY KEY,cursor INTEGER)'
    )
    const profile = '.dim-restore-receipttest'
    await mkdir(join(root, 'dim'), { recursive: true })
    await mkdir(join(root, profile), { recursive: true })
    if (phase === 'installed') {
      await mkdir(join(root, profile, 'previous'))
      await writeFile(join(root, profile, 'previous', 'content'), 'previous')
      await writeFile(join(root, 'dim', 'content'), 'installed')
    } else await writeFile(join(root, 'dim', 'content'), 'previous')
    await writeDimProfileRecovery(join(root, profile), {
      version: 1,
      phase,
      hadPrevious: phase === 'installed'
    })
    const journal = await NativeReplicaRecovery.begin(root, profile, 'peer', 7)
    cleanups.push(async () => {
      db.close()
      await rm(root, { recursive: true, force: true })
    })
    return { root, db, journal, profile }
  }
  it.each(['prepared', 'installed'] as const)(
    'rolls back an uncommitted %s import despite another batch cursor',
    async (phase) => {
      const { root, db } = await admission(phase)
      db.prepare('INSERT INTO _sync_receipts VALUES(?,?)').run('peer', 100)
      await NativeReplicaRecovery.recover(root, db)
      expect(await readFile(join(root, 'dim/content'), 'utf8')).toBe('previous')
      await expect(readFile(join(root, '.dim-replica-import.json'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
      await NativeReplicaRecovery.recover(root, db)
    }
  )
  it.each([false, true])(
    'preserves a matching committed import after cleanup started: %s',
    async (removed) => {
      const { root, db, journal, profile } = await admission()
      db.prepare('INSERT INTO _sync_native_receipts VALUES(?,?,?)').run(
        journal.state.token,
        'peer',
        7
      )
      if (removed) await rm(join(root, profile), { recursive: true })
      await NativeReplicaRecovery.recover(root, db)
      expect(await readFile(join(root, 'dim/content'), 'utf8')).toBe('installed')
      expect(db.prepare('SELECT * FROM _sync_native_receipts').all()).toEqual([])
      await NativeReplicaRecovery.recover(root, db)
    }
  )
  it('finishes rollback cleanup after the private recovery directory is already removed', async () => {
    const { root, db, journal, profile } = await admission()
    await recoverDimProfile(root, profile)
    await writeDurableJson(join(root, '.dim-replica-import.json'), {
      ...journal.state,
      phase: 'rolled-back'
    })
    await rm(join(root, profile), { recursive: true })
    await NativeReplicaRecovery.recover(root, db)
    expect(await readFile(join(root, 'dim/content'), 'utf8')).toBe('previous')
    await expect(readFile(join(root, '.dim-replica-import.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await NativeReplicaRecovery.recover(root, db)
  })

  it('retains both profiles when a receipt conflicts with its journal identity', async () => {
    const { root, db, journal, profile } = await admission()
    db.prepare('INSERT INTO _sync_native_receipts VALUES(?,?,?)').run(
      journal.state.token,
      'another-peer',
      7
    )
    await expect(NativeReplicaRecovery.recover(root, db)).rejects.toThrow('does not match')
    expect(await readFile(join(root, 'dim/content'), 'utf8')).toBe('installed')
    expect(await readFile(join(root, profile, 'previous/content'), 'utf8')).toBe('previous')
    expect(JSON.parse(await readFile(join(root, '.dim-replica-import.json'), 'utf8')).token).toBe(
      journal.state.token
    )
  })
})
