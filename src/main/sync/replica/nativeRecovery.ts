import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type Database from 'better-sqlite3-multiple-ciphers'
import { syncDirectory, writeDurableJson } from '../../data/durableFile'
import { profileExists, recoverDimProfile } from '../../agent/dim/profileRecovery'

const name = '.dim-replica-import.json'
const Journal = z
  .object({
    version: z.literal(1),
    phase: z.enum(['pending', 'rolled-back']).default('pending'),
    token: z.string().uuid(),
    replica: z.string().min(1).max(512),
    through: z.number().int().nonnegative().safe(),
    profile: z.string().regex(/^\.dim-restore-[a-zA-Z0-9]+$/)
  })
  .strict()
type State = z.infer<typeof Journal>

/** A per-admission product SQL receipt distinguishes a commit from another batch's cursor. */
export class NativeReplicaRecovery {
  private constructor(
    private readonly root: string,
    readonly state: State
  ) {}

  static async begin(
    root: string,
    profile: string,
    replica: string,
    through: number
  ): Promise<NativeReplicaRecovery> {
    try {
      await readFile(path.join(root, name))
      throw new Error('A Native replica admission requires recovery')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const state = Journal.parse({ version: 1, token: randomUUID(), profile, replica, through })
    await writeDurableJson(path.join(root, name), state)
    return new NativeReplicaRecovery(root, state)
  }

  async clear(database: Database.Database): Promise<void> {
    await rm(path.join(this.root, name), { force: true })
    await syncDirectory(this.root)
    database.prepare('DELETE FROM _sync_native_receipts WHERE token=?').run(this.state.token)
  }

  /** Runs after product SQL opens and before any Native owner can start. */
  static async recover(root: string, database: Database.Database): Promise<void> {
    let value: unknown
    try {
      value = JSON.parse(await readFile(path.join(root, name), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const state = Journal.parse(value)
    const hasReceipts = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_sync_native_receipts'")
      .get()
    const receipt = hasReceipts
      ? (database
          .prepare('SELECT replica,through FROM _sync_native_receipts WHERE token=?')
          .get(state.token) as { replica: string; through: number } | undefined)
      : undefined
    if (receipt && (receipt.replica !== state.replica || receipt.through !== state.through))
      throw new Error('Native replica receipt does not match its admission')
    const directory = path.join(root, state.profile)
    if (receipt) {
      if (!(await profileExists(path.join(root, 'dim'))))
        throw new Error('Committed Native profile is missing')
    } else if (state.phase !== 'rolled-back') {
      await recoverDimProfile(root, state.profile)
      // The rollback is durable before cleanup can remove its per-profile state.
      // A restart after directory removal must not attempt that rollback again.
      await writeDurableJson(path.join(root, name), { ...state, phase: 'rolled-back' })
    }
    await rm(directory, { recursive: true, force: true })
    // The marker disappears durably before its SQL receipt can be removed.
    await rm(path.join(root, name), { force: true })
    await syncDirectory(root)
    if (hasReceipts)
      database.prepare('DELETE FROM _sync_native_receipts WHERE token=?').run(state.token)
  }
}
