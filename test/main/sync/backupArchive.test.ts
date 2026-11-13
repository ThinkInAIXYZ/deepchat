import { expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zipSync } from 'fflate'
import { openPromise } from 'yauzl'
import { extractBackupArchive, readBackupManifest, writeBackupArchive } from '@/sync/backupArchive'

vi.unmock('fs')
vi.unmock('node:fs')

it('round-trips ZIP64 data and file streams and reads the manifest without buffering other entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'backup-zip64-'))
  try {
    const source = path.join(root, 'source')
    const data = Buffer.alloc(1024 * 1024, 0x5a)
    await writeFile(source, data)
    const archive = path.join(root, 'backup.zip')
    const manifest = { version: 3, configStorage: 'sqlite', nativeProfile: 'dim/manifest.json' }
    await writeBackupArchive(
      archive,
      [
        { name: 'dim/profile/附件.bin', source: { file: source, size: data.length } },
        { name: 'manifest.json', source: { data: Buffer.from(JSON.stringify(manifest)) } }
      ],
      { forceZip64: true }
    )
    expect((await readFile(archive)).includes(Buffer.from([0x50, 0x4b, 0x06, 0x07]))).toBe(true)
    expect(await readBackupManifest(archive)).toEqual(manifest)
    const output = path.join(root, 'extracted')
    await extractBackupArchive(archive, output)
    expect(await readFile(path.join(output, 'dim/profile/附件.bin'))).toEqual(data)
    await expect(
      writeBackupArchive(path.join(root, 'failed.zip'), [
        { name: 'missing', source: { file: path.join(root, 'absent'), size: 1 } }
      ])
    ).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('accepts legacy ZIP entries but rejects damaged CRC, traversal, duplicate aliases and oversized manifests', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'backup-zip-validation-'))
  try {
    const archive = path.join(root, 'legacy.zip')
    const payload = Buffer.from('LEGACY_PAYLOAD_FOR_CRC')
    const data = Buffer.from(zipSync({ 'database/agent.db': payload }, { level: 0 }))
    await writeFile(archive, data)
    await extractBackupArchive(archive, path.join(root, 'valid'))
    expect(await readFile(path.join(root, 'valid/database/agent.db'))).toEqual(payload)
    data[data.indexOf(payload)] ^= 1
    await writeFile(archive, data)
    await expect(extractBackupArchive(archive, path.join(root, 'crc'))).rejects.toThrow('checksum')
    await writeFile(archive, zipSync({ '../escape': payload }))
    await expect(extractBackupArchive(archive, path.join(root, 'unsafe'))).rejects.toThrow()
    await expect(readFile(path.join(root, 'escape'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(archive, zipSync({ file: payload, './file': payload }))
    await expect(extractBackupArchive(archive, path.join(root, 'duplicate'))).rejects.toThrow()
    await writeBackupArchive(archive, [
      { name: 'manifest.json', source: { data: Buffer.alloc(1024 * 1024 + 1, 0x20) } }
    ])
    expect(await readBackupManifest(archive)).toBeNull()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it.runIf(process.env.DEEPCHAT_LARGE_BACKUP_SMOKE === '1')(
  'writes an actual file larger than 4 GiB through ZIP64 with bounded buffers',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'backup-over-4gib-'))
    try {
      await mkdir(path.join(root, 'input'))
      const file = path.join(root, 'input/large')
      const size = 0x100000000 + 17
      const handle = await open(file, 'w')
      try {
        await handle.truncate(size)
      } finally {
        await handle.close()
      }
      const archive = path.join(root, 'large.zip')
      await writeBackupArchive(archive, [
        { name: 'dim/profile/large', source: { file, size } },
        { name: 'manifest.json', source: { data: Buffer.from('{"version":3}') } }
      ])
      const zip = await openPromise(archive, { lazyEntries: true, autoClose: false })
      try {
        let checked = false
        for await (const entry of zip.eachEntry())
          if (entry.fileName === 'dim/profile/large') {
            expect(entry.uncompressedSize).toBe(size)
            expect(entry.versionNeededToExtract).toBeGreaterThanOrEqual(45)
            checked = true
          }
        expect(checked).toBe(true)
      } finally {
        zip.close()
      }
      expect(await readBackupManifest(archive)).toEqual({ version: 3 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  180_000
)
