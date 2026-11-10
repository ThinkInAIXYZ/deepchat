import { nativeMediaReference } from '@shared/dimMedia'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { DimModality } from '@/agent/dim/modality'

const PREFIX = 'imgcache://dim_'
const MAX_BYTES = 256 * 1024 * 1024
let owner: Pick<DimModality, 'status' | 'readChunk'> | undefined
const pending = new Map<string, Promise<void>>()

export function registerNativeMediaCache(media: typeof owner): void {
  owner = media
}

/** Immutable task references; this directory is a disposable desktop read cache. */

export async function materializeNativeMedia(source: string): Promise<void> {
  if (!source.startsWith(PREFIX)) return
  const reference = nativeMediaReference(source)
  if (!reference) throw new Error('Invalid native media reference')
  const existing = pending.get(source)
  if (existing) return existing
  const task = materialize(source, reference)
  pending.set(source, task)
  try {
    await task
  } finally {
    if (pending.get(source) === task) pending.delete(source)
  }
}

async function materialize(
  source: string,
  reference: { task: string; name: string }
): Promise<void> {
  const root = path.join(app.getPath('userData'), 'images')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const directory = await lstat(root)
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Invalid media cache')
  const canonical = await realpath(root)
  const destination = path.join(canonical, source.slice('imgcache://'.length))
  const cached = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (cached) {
    if (!cached.isFile() || cached.isSymbolicLink() || cached.size > MAX_BYTES)
      throw new Error('Invalid native media cache file')
    return
  }
  if (!owner) throw new Error('Native media owner is unavailable')
  const media = owner
  const record = await media.status(reference.task)
  const file = record.result?.files.find((file) => file.name === reference.name)
  if (
    record.state !== 'succeeded' ||
    !file ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 0 ||
    file.bytes > MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(file.sha256)
  )
    throw new Error('Native media file is unavailable')
  const temporary = path.join(canonical, `.dim-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    const digest = createHash('sha256')
    let offset = 0
    while (offset < file.bytes) {
      const chunk = await media.readChunk(
        reference.task,
        reference.name,
        offset,
        Math.min(512 * 1024, file.bytes - offset)
      )
      if (!chunk.length || offset + chunk.length > file.bytes)
        throw new Error('Invalid native media chunk')
      await handle.writeFile(chunk)
      digest.update(chunk)
      offset += chunk.length
    }
    if (digest.digest('hex') !== file.sha256)
      throw new Error('Native media file integrity mismatch')
    await handle.sync()
    await handle.close()
    await rename(temporary, destination)
  } finally {
    await handle.close().catch(() => {})
    await rm(temporary, { force: true })
  }
}
