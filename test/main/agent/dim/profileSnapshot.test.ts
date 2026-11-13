import { expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureDimProfile, validateDimProfile } from '@/agent/dim/profileSnapshot'
import { DimProfileBackups } from '@/agent/dim/profileBackups'
import type { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'

vi.unmock('node:fs')
vi.unmock('fs')

const identity = { sourceRevision: 'pinned-sdk', bridgeVersion: '0.14.0', storeFormat: 7 }

it('captures an immutable opaque profile including WAL and native files, excluding transport config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dim-profile-test-'))
  const profile = path.join(root, 'dim')
  try {
    await mkdir(path.join(profile, 'files'), { recursive: true })
    await writeFile(path.join(profile, 'dimcode.sqlite'), 'opaque database')
    await writeFile(path.join(profile, 'dimcode.sqlite-wal'), 'committed WAL')
    await writeFile(path.join(profile, 'files', 'script'), 'native file')
    await chmod(path.join(profile, 'files', 'script'), 0o755)
    await writeFile(path.join(profile, 'files', 'immutable'), 'immutable native attachment')
    await chmod(path.join(profile, 'files', 'immutable'), 0o400)
    await writeFile(path.join(profile, 'deepchat-plugin-rows.json'), 'private socket addresses')
    await mkdir(path.join(profile, 'rust/deepchat-payloads'), { recursive: true })
    await writeFile(path.join(profile, 'rust/deepchat-payloads/stale.json'), 'ephemeral request')
    const captured = await captureDimProfile(profile, root, identity)
    try {
      await writeFile(path.join(profile, 'dimcode.sqlite'), 'live database changed')
      const manifest = await captured.manifest()
      expect(manifest.files.map((file) => file.path)).toEqual([
        'dimcode.sqlite',
        'dimcode.sqlite-wal',
        'files/immutable',
        'files/script'
      ])
      expect(manifest.sourceHome).toBe(await realpath(profile))
      expect(manifest.files[2].mode).toBe(0o400)
      expect(manifest.files[3].mode).toBe(0o700)
      expect(await readFile(path.join(captured.directory, 'dimcode.sqlite'), 'utf8')).toBe(
        'opaque database'
      )
      await expect(validateDimProfile(captured.directory, manifest, identity)).resolves.toEqual(
        manifest
      )
      await expect(
        validateDimProfile(
          captured.directory,
          {
            ...manifest,
            files: [manifest.files[0], manifest.files[0]]
          },
          identity
        )
      ).rejects.toThrow('file')
      await expect(
        validateDimProfile(captured.directory, manifest, { ...identity, storeFormat: 8 })
      ).rejects.toThrow('Unsupported')
      await writeFile(path.join(captured.directory, 'files', 'script'), 'corruption!')
      await expect(validateDimProfile(captured.directory, manifest, identity)).rejects.toThrow(
        'integrity'
      )
    } finally {
      await captured.dispose()
    }
    await expect(captureDimProfile(profile, path.join(profile, 'files'), identity)).rejects.toThrow(
      'outside'
    )
    await symlink(path.join(profile, 'dimcode.sqlite'), path.join(profile, 'alias'))
    await expect(captureDimProfile(profile, root, identity)).rejects.toThrow(
      'unsupported filesystem'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('stages and swaps the complete profile, then restores the old directory on product rollback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dim-profile-swap-'))
  const source = path.join(root, 'source')
  const product = path.join(root, 'product')
  try {
    await mkdir(source)
    await writeFile(path.join(source, 'dimcode.sqlite'), 'backup native state')
    const captured = await captureDimProfile(source, root, identity)
    try {
      await mkdir(path.join(product, 'dim'), { recursive: true })
      await mkdir(path.join(root, 'plugins'))
      await writeFile(path.join(root, 'plugins/native-host-lock.json'), JSON.stringify(identity))
      await writeFile(path.join(product, 'dim', 'original'), 'keep original state')
      const owner = new DimProfileBackups({
        runtimeRoot: root,
        profileRoot: product,
        temporaryRoot: root,
        host: {} as DimRuntimeSupervisor,
        readers: () => {
          throw new Error('Restoring a cold profile must not start readers')
        }
      })
      const prepared = await owner.prepareRestore(captured.directory, await captured.manifest())
      const installed = await prepared.install()
      expect(await readFile(path.join(product, 'dim/dimcode.sqlite'), 'utf8')).toBe(
        'backup native state'
      )
      await installed.rollback()
      await prepared.dispose()
      expect(await readFile(path.join(product, 'dim/original'), 'utf8')).toBe('keep original state')
      const committed = await owner.prepareRestore(captured.directory, await captured.manifest())
      await (await committed.install()).commit()
      await committed.dispose()
      expect(await readFile(path.join(product, 'dim/dimcode.sqlite'), 'utf8')).toBe(
        'backup native state'
      )
      await expect(readFile(path.join(product, 'dim/original'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    } finally {
      await captured.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects unlisted files, duplicate paths, traversal and transient socket rows on restore', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dim-profile-validate-'))
  try {
    const captured = await captureDimProfile(path.join(root, 'absent'), root, identity)
    try {
      const manifest = await captured.manifest()
      await expect(validateDimProfile(captured.directory, manifest, identity)).resolves.toEqual(
        manifest
      )
      const file = { path: '../escape', size: 0, sha256: '0'.repeat(64), mode: 0o600 }
      await expect(
        validateDimProfile(captured.directory, { ...manifest, files: [file] }, identity)
      ).rejects.toThrow('path')
      await expect(
        validateDimProfile(
          captured.directory,
          { ...manifest, files: [{ ...file, path: 'deepchat-plugin-rows.json' }] },
          identity
        )
      ).rejects.toThrow('file')
      await writeFile(path.join(captured.directory, 'deepchat-plugin-rows.json'), 'injected')
      await expect(validateDimProfile(captured.directory, manifest, identity)).rejects.toThrow(
        'unlisted'
      )
    } finally {
      await captured.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('admits alpha.21 archives for the v44 upgrade only with their pinned source and format', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dim-profile-upgrade-'))
  const previous = {
    sourceRevision: '0423b321abc923900525d79d030fd690110f91c4',
    bridgeVersion: '0.43.0',
    storeFormat: 36
  }
  try {
    const captured = await captureDimProfile(path.join(root, 'absent'), root, previous)
    const manifest = await captured.manifest()
    const current = { ...identity, storeFormat: 44 }
    await expect(validateDimProfile(captured.directory, manifest, current)).resolves.toEqual(
      manifest
    )
    for (const incompatible of [
      { ...manifest, sourceRevision: 'f'.repeat(40) },
      { ...manifest, storeFormat: 37 },
      { ...manifest, sourceRevision: current.sourceRevision, storeFormat: 45 }
    ]) {
      await expect(
        validateDimProfile(captured.directory, incompatible, current)
      ).rejects.toThrow('Unsupported')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
