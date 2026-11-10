import { afterEach, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { captureDimProfile, validateDimProfile } from '@/agent/dim/profileSnapshot'
import { SyncNativeFiles } from '@/sync/replica/nativeFiles'
import { SYNC_PART_BYTES } from '@shared/contracts/syncReplica'
import type { SyncNativeTransfer } from '@shared/contracts/syncNative'

vi.unmock('fs')
vi.unmock('node:fs')

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})
const identity = { sourceRevision: 'a'.repeat(40), bridgeVersion: '0.38.0', storeFormat: 36 }
async function fixture(entries: Array<{ name: string; bytes: Buffer; mode?: number }>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dim-sync-files-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  for (const entry of entries) {
    const file = path.join(source, entry.name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, entry.bytes, { mode: entry.mode ?? 0o600 })
  }
  const snapshot = await captureDimProfile(source, os.tmpdir(), identity)
  cleanups.push(() => snapshot.dispose())
  const outgoing = new SyncNativeFiles(path.join(root, 'outgoing'))
  const incoming = new SyncNativeFiles(path.join(root, 'incoming'))
  const descriptor = await outgoing.prepare(snapshot)
  return { root, snapshot, outgoing, incoming, descriptor }
}
function index(value: SyncNativeTransfer, name: string) {
  const found = value.manifest.files.findIndex((file) => file.path === name)
  expect(found).toBeGreaterThanOrEqual(0)
  return found
}

it('resumes bounded out-of-order opaque profile files, preserving empty and immutable files', async () => {
  const bytes = Buffer.alloc(18 * 1024 * 1024 + 17, 0x61)
  const name = 'rust/dimcode.sqlite'
  const owned = 'rust/dimcode.sqlite.session-files/file-id/media.json'
  const context = await fixture([
    { name, bytes },
    { name: owned, bytes: Buffer.from('immutable native file'), mode: 0o400 },
    { name: 'rust/empty', bytes: Buffer.alloc(0) }
  ])
  const { outgoing, descriptor, root } = context
  const file = index(descriptor, name)
  const first = await outgoing.part(descriptor, file, 0)
  expect(first.length).toBe(SYNC_PART_BYTES)
  await context.incoming.receive(descriptor, file, 0, first)
  // Another owner after a restart resumes the same descriptor and persisted parts.
  const incoming = new SyncNativeFiles(path.join(root, 'incoming'))
  const missing = await incoming.missing(descriptor)
  expect(missing).not.toContainEqual({ file, part: 0 })
  expect(missing).toContainEqual({ file, part: 1 })
  await expect(incoming.assemble(descriptor)).rejects.toThrow()
  expect(
    (await readdir(path.join(root, 'incoming', descriptor.id))).some((name) =>
      name.endsWith('.tmp')
    )
  ).toBe(false)
  for (const part of missing.reverse()) {
    const data = await outgoing.part(descriptor, part.file, part.part)
    expect(data.length).toBeLessThanOrEqual(SYNC_PART_BYTES)
    await incoming.receive(descriptor, part.file, part.part, data)
  }
  expect(await incoming.missing(descriptor)).toEqual([])
  const profile = await incoming.assemble(descriptor)
  await validateDimProfile(profile, descriptor.manifest, identity)
  expect((await readFile(path.join(profile, name))).equals(bytes)).toBe(true)
  expect((await stat(path.join(profile, 'rust/empty'))).size).toBe(0)
  expect((await stat(path.join(profile, owned))).mode & 0o200).toBe(0)
  expect(await incoming.assemble(descriptor)).toBe(profile)
  expect((await outgoing.prepare(context.snapshot)).id).toBe(descriptor.id)
})

it('rejects corrupt parts before publishing, then repairs a damaged completed cache on retry', async () => {
  const name = 'rust/dimcode.sqlite'
  const bytes = Buffer.from('opaque native bytes')
  const { incoming, outgoing, descriptor, root } = await fixture([{ name, bytes }])
  const file = index(descriptor, name)
  await incoming.receive(descriptor, file, 0, Buffer.alloc(bytes.length, 0x62))
  await expect(incoming.assemble(descriptor)).rejects.toThrow('integrityFailed')
  expect(await incoming.missing(descriptor)).toEqual([{ file, part: 0 }])
  await expect(
    stat(path.join(root, 'incoming', descriptor.id, 'profile', name))
  ).rejects.toMatchObject({ code: 'ENOENT' })
  await incoming.receive(descriptor, file, 0, await outgoing.part(descriptor, file, 0))
  const profile = await incoming.assemble(descriptor)
  await chmod(path.join(profile, name), 0o600)
  await writeFile(path.join(profile, name), Buffer.alloc(bytes.length, 0x63))
  await incoming.assemble(descriptor)
  expect((await readFile(path.join(profile, name))).equals(bytes)).toBe(true)
})

it('repairs an immutable outgoing cache from its verified cold snapshot', async () => {
  const name = 'rust/file'
  const bytes = Buffer.from('original snapshot')
  const { root, outgoing, snapshot, descriptor } = await fixture([{ name, bytes, mode: 0o400 }])
  const cached = path.join(root, 'outgoing', descriptor.id, 'profile', name)
  await chmod(cached, 0o600)
  await writeFile(cached, Buffer.alloc(bytes.length, 0x64))
  expect((await outgoing.prepare(snapshot)).id).toBe(descriptor.id)
  expect(await outgoing.part(descriptor, index(descriptor, name), 0)).toEqual(bytes)
  expect((await stat(cached)).mode & 0o200).toBe(0)
})

it('rejects changed descriptors, traversal and invalid file/part bounds before writes', async () => {
  const { incoming, descriptor, root } = await fixture([
    { name: 'rust/file', bytes: Buffer.from('abc') }
  ])
  await expect(
    incoming.receive({ ...descriptor, id: '0'.repeat(64) }, 0, 0, Buffer.from('abc'))
  ).rejects.toThrow('integrityFailed')
  const unsafe = structuredClone(descriptor)
  unsafe.manifest.files[0].path = '../escape'
  await expect(incoming.receive(unsafe, 0, 0, Buffer.from('abc'))).rejects.toThrow()
  await expect(incoming.receive(descriptor, -1, 0, Buffer.from('abc'))).rejects.toThrow('index')
  await expect(incoming.receive(descriptor, 0, 1, Buffer.from('abc'))).rejects.toThrow('part')
  await expect(incoming.receive(descriptor, 0, 0, Buffer.from('four'))).rejects.toThrow('size')
  await expect(stat(path.join(root, 'escape'))).rejects.toMatchObject({ code: 'ENOENT' })
})
