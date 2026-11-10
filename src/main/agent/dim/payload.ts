import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { JsonValue } from '@shared/contracts/json'

const INLINE_BYTES = 4 * 1024 * 1024
const MAX_BYTES = 256 * 1024 * 1024

/** Private transport files only. Native FileStorage verifies and reads the complete request. */
export async function prepareDimPayload(
  root: string,
  value: JsonValue,
  signal?: AbortSignal
): Promise<{ params: JsonValue; dispose(): Promise<void> }> {
  signal?.throwIfAborted()
  const bytes = Buffer.from(JSON.stringify(value))
  if (bytes.length <= INLINE_BYTES) return { params: value, dispose: async () => {} }
  if (bytes.length > MAX_BYTES) throw new Error('Native model request exceeds its file limit')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const directory = await lstat(root)
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error('Invalid native model payload directory')
  const name = `${randomUUID()}.json`
  const file = path.join(root, name)
  const dispose = async () => {
    await rm(file, { force: true }).catch(() => {
      console.warn('[dim] Could not remove temporary model payload')
    })
  }
  try {
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600, signal })
    signal?.throwIfAborted()
    return {
      params: {
        deepchatPayload: {
          name,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        }
      },
      dispose
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
