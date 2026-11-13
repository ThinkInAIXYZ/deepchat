import { lstat, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { syncDirectory, writeDurableJson } from '../../data/durableFile'

export interface DimProfileRecoveryState {
  version: 1
  phase: 'prepared' | 'swapping' | 'installed' | 'rolling-back' | 'restored'
  hadPrevious: boolean
}

export async function profileExists(location: string): Promise<boolean> {
  try {
    const info = await lstat(location)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Invalid native profile recovery directory')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function writeDimProfileRecovery(
  directory: string,
  state: DimProfileRecoveryState
): Promise<void> {
  return writeDurableJson(path.join(directory, 'recovery.json'), state)
}

/** Runs before Native starts. Repeating after an interrupted rollback preserves the original. */
export async function recoverDimProfile(profileRoot: string, name: string): Promise<void> {
  if (!/^\.dim-restore-[a-zA-Z0-9]+$/.test(name))
    throw new Error('Invalid native recovery identity')
  const directory = path.join(profileRoot, name)
  if (!(await profileExists(directory))) throw new Error('Native recovery directory is missing')
  const state = JSON.parse(
    await readFile(path.join(directory, 'recovery.json'), 'utf8')
  ) as DimProfileRecoveryState
  if (
    state.version !== 1 ||
    !['prepared', 'swapping', 'installed', 'rolling-back', 'restored'].includes(state.phase) ||
    typeof state.hadPrevious !== 'boolean'
  )
    throw new Error('Invalid native recovery state')
  if (state.phase === 'prepared' || state.phase === 'restored') return
  const previous = path.join(directory, 'previous')
  const target = path.join(profileRoot, 'dim')
  const exists = await profileExists(previous)
  if (state.hadPrevious && !exists) {
    if (!['swapping', 'rolling-back'].includes(state.phase) || !(await profileExists(target)))
      throw new Error('Original native profile is unavailable for recovery')
  } else {
    await writeDimProfileRecovery(directory, { ...state, phase: 'rolling-back' })
    await rm(target, { recursive: true, force: true })
    if (state.hadPrevious) await rename(previous, target)
    await syncDirectory(profileRoot)
    await syncDirectory(directory)
  }
  await writeDimProfileRecovery(directory, { ...state, phase: 'restored' })
}
