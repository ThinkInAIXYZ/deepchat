import { expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SyncImportRecovery } from '@/sync/importRecovery'
import { DimProfileBackups } from '@/agent/dim/profileBackups'
import { captureDimProfile } from '@/agent/dim/profileSnapshot'
import { writeDimProfileRecovery } from '@/agent/dim/profileRecovery'
import type { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'

vi.unmock('fs')
vi.unmock('node:fs')

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sync-import-recovery-'))
  const root = path.join(temporary, 'product')
  const source = path.join(temporary, 'source')
  const identity = { sourceRevision: 'pinned', bridgeVersion: '0.14.0', storeFormat: 36 }
  await mkdir(path.join(root, 'app_db'), { recursive: true })
  await mkdir(path.join(root, 'dim'))
  await mkdir(source)
  await mkdir(path.join(temporary, 'plugins'))
  await writeFile(path.join(temporary, 'plugins/native-host-lock.json'), JSON.stringify(identity))
  await writeFile(path.join(root, 'app_db/agent.db'), 'original product SQL')
  await writeFile(path.join(root, 'app_db/agent.db-wal'), 'original product WAL')
  await writeFile(path.join(root, 'app-settings.json'), '{"original":true}')
  await writeFile(path.join(root, 'dim/original'), 'original canonical profile')
  await writeFile(path.join(source, 'imported'), 'imported canonical profile')
  const captured = await captureDimProfile(source, temporary, identity)
  const prepared = await new DimProfileBackups({
    runtimeRoot: temporary,
    profileRoot: root,
    temporaryRoot: temporary,
    host: {} as DimRuntimeSupervisor,
    readers: () => {
      throw new Error('Recovery must not start an agent')
    }
  }).prepareRestore(captured.directory, await captured.manifest())
  return {
    temporary,
    root,
    prepared,
    cleanup: () => rm(temporary, { recursive: true, force: true })
  }
}

async function mutate(root: string) {
  await writeFile(path.join(root, 'app_db/agent.db'), 'imported product SQL')
  await writeFile(path.join(root, 'app_db/agent.db-wal'), 'imported product WAL')
  await writeFile(path.join(root, 'app-settings.json'), '{"imported":true}')
  await writeFile(path.join(root, 'custom_prompts.json'), 'did not exist before import')
}

it('recovers uncommitted product files and the installed Native profile before owners reopen', async () => {
  const f = await fixture()
  try {
    await SyncImportRecovery.begin(f.root, f.prepared.recoveryDirectory)
    await mutate(f.root)
    await f.prepared.install()
    // Only persisted state is used by the new startup owner.
    expect(await SyncImportRecovery.recover(f.root)).toBe(true)
    expect(await readFile(path.join(f.root, 'app_db/agent.db'), 'utf8')).toBe(
      'original product SQL'
    )
    expect(await readFile(path.join(f.root, 'app_db/agent.db-wal'), 'utf8')).toBe(
      'original product WAL'
    )
    expect(await readFile(path.join(f.root, 'app-settings.json'), 'utf8')).toBe('{"original":true}')
    expect(await readFile(path.join(f.root, 'dim/original'), 'utf8')).toBe(
      'original canonical profile'
    )
    await expect(readFile(path.join(f.root, 'custom_prompts.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(path.join(f.root, 'dim/imported'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(await SyncImportRecovery.recover(f.root)).toBe(false)
  } finally {
    await f.cleanup()
  }
})

it('keeps a durably committed import and finishes cleanup after an interrupted process', async () => {
  const f = await fixture()
  try {
    const journal = await SyncImportRecovery.begin(f.root, f.prepared.recoveryDirectory)
    await mutate(f.root)
    await f.prepared.install()
    await journal.commit()
    expect(await SyncImportRecovery.recover(f.root)).toBe(true)
    expect(await readFile(path.join(f.root, 'app_db/agent.db'), 'utf8')).toBe(
      'imported product SQL'
    )
    expect(await readFile(path.join(f.root, 'dim/imported'), 'utf8')).toBe(
      'imported canonical profile'
    )
    await expect(readFile(path.join(f.root, 'dim/original'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  } finally {
    await f.cleanup()
  }
})

it.each([false, true])(
  'recovers an interrupted Native directory swap (previous moved: %s)',
  async (moved) => {
    const f = await fixture()
    try {
      await SyncImportRecovery.begin(f.root, f.prepared.recoveryDirectory)
      await mutate(f.root)
      const stage = path.join(f.root, f.prepared.recoveryDirectory)
      await writeDimProfileRecovery(stage, { version: 1, phase: 'swapping', hadPrevious: true })
      if (moved) await rename(path.join(f.root, 'dim'), path.join(stage, 'previous'))
      expect(await SyncImportRecovery.recover(f.root)).toBe(true)
      expect(await readFile(path.join(f.root, 'dim/original'), 'utf8')).toBe(
        'original canonical profile'
      )
      expect(await readFile(path.join(f.root, 'app_db/agent.db'), 'utf8')).toBe(
        'original product SQL'
      )
    } finally {
      await f.cleanup()
    }
  }
)

it('retains damaged rollback snapshots and refuses recovery before replacing live files', async () => {
  const f = await fixture()
  try {
    await SyncImportRecovery.begin(f.root, f.prepared.recoveryDirectory)
    await mutate(f.root)
    const marker = JSON.parse(
      await readFile(path.join(f.root, 'sync-import-recovery.json'), 'utf8')
    )
    const backup = path.join(f.root, marker.directory, '0')
    await writeFile(backup, 'damaged original')
    await expect(SyncImportRecovery.recover(f.root)).rejects.toThrow('requires recovery')
    expect(await readFile(path.join(f.root, 'app_db/agent.db'), 'utf8')).toBe(
      'imported product SQL'
    )
    expect(await readFile(backup, 'utf8')).toBe('damaged original')
    marker.directory = '../escape'
    await writeFile(path.join(f.root, 'sync-import-recovery.json'), JSON.stringify(marker))
    await expect(SyncImportRecovery.recover(f.root)).rejects.toThrow(
      'Invalid import recovery journal'
    )
  } finally {
    await f.cleanup()
  }
})
