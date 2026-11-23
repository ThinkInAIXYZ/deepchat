import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { DimProfileRecoveryError } from '../agent/dim/profileBackups'
import { recoverDimProfile } from '../agent/dim/profileRecovery'
import { syncDirectory, writeDurableJson } from '../data/durableFile'

const journalName = 'sync-import-recovery.json'
const targets = [
  'app_db/agent.db',
  'app_db/agent.db-wal',
  'app-settings.json',
  'custom_prompts.json',
  'system_prompts.json',
  'mcp-settings.json'
] as const
interface RecoveryFile {
  path: string
  size: number
  sha256: string | null
}
interface RecoveryJournal {
  version: 1
  phase: 'prepared' | 'committed' | 'rolled-back'
  directory: string
  native?: string
  files: RecoveryFile[]
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
async function hash(file: string): Promise<string> {
  const value = createHash('sha256')
  for await (const chunk of createReadStream(file)) value.update(chunk)
  return value.digest('hex')
}
async function flush(file: string): Promise<void> {
  const handle = await open(file, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
function validate(value: unknown): RecoveryJournal {
  if (!value || typeof value !== 'object') throw new Error('Invalid import recovery journal')
  const journal = value as RecoveryJournal
  if (
    journal.version !== 1 ||
    !['prepared', 'committed', 'rolled-back'].includes(journal.phase) ||
    typeof journal.directory !== 'string' ||
    !/^\.sync-import-[a-zA-Z0-9]+$/.test(journal.directory) ||
    (journal.native !== undefined &&
      (typeof journal.native !== 'string' ||
        !/^\.dim-restore-[a-zA-Z0-9]+$/.test(journal.native))) ||
    !Array.isArray(journal.files) ||
    journal.files.length !== targets.length
  )
    throw new Error('Invalid import recovery journal')
  const seen = new Set<string>()
  for (const file of journal.files) {
    if (
      !file ||
      !targets.includes(file.path as (typeof targets)[number]) ||
      seen.has(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      (file.sha256 !== null &&
        (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)))
    )
      throw new Error('Invalid import recovery file')
    seen.add(file.path)
  }
  return journal
}

/** Desktop import transaction journal; recovery runs before settings, SQL or Native are opened. */
export class SyncImportRecovery {
  private constructor(
    private readonly root: string,
    private journal: RecoveryJournal
  ) {}

  static async begin(root: string, native?: string): Promise<SyncImportRecovery> {
    if (await exists(path.join(root, journalName)))
      throw new DimProfileRecoveryError(root, new Error('An import recovery is already pending'))
    const directory = await mkdtemp(path.join(root, '.sync-import-'))
    const journal: RecoveryJournal = {
      version: 1,
      phase: 'prepared',
      directory: path.basename(directory),
      native,
      files: []
    }
    try {
      for (const relative of targets) {
        const source = path.join(root, relative)
        const info = await lstat(source).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        if (!info) {
          journal.files.push({ path: relative, size: 0, sha256: null })
          continue
        }
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error('Invalid import rollback source')
        const backup = path.join(directory, String(journal.files.length))
        await copyFile(source, backup)
        await flush(backup)
        journal.files.push({ path: relative, size: info.size, sha256: await hash(backup) })
      }
      validate(journal)
      await syncDirectory(directory)
      await writeDurableJson(path.join(root, journalName), journal)
      return new SyncImportRecovery(root, journal)
    } catch (error) {
      if (await exists(path.join(root, journalName)))
        throw new DimProfileRecoveryError(directory, error)
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  static async recover(root: string): Promise<boolean> {
    const file = path.join(root, journalName)
    if (!(await exists(file))) return false
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024)
      throw new Error('Invalid import recovery journal file')
    const journal = validate(JSON.parse(await readFile(file, 'utf8')))
    const owner = new SyncImportRecovery(root, journal)
    if (journal.phase === 'prepared') await owner.rollback()
    else await owner.cleanup()
    return true
  }

  async commit(): Promise<void> {
    // A durable commit precedes cleanup; startup must never undo a committed Native profile.
    const committed: RecoveryJournal = { ...this.journal, phase: 'committed' }
    try {
      for (const target of targets) {
        const file = path.join(this.root, target)
        if (await exists(file)) await flush(file)
      }
      await syncDirectory(path.join(this.root, 'app_db'))
      await writeDurableJson(path.join(this.root, journalName), committed)
      this.journal = committed
    } catch (error) {
      throw new DimProfileRecoveryError(path.join(this.root, this.journal.directory), error)
    }
  }

  async rollback(): Promise<void> {
    const directory = path.join(this.root, this.journal.directory)
    try {
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('Invalid import rollback directory')
      // Validate every original before replacing either side of the transaction.
      for (let index = 0; index < this.journal.files.length; index++) {
        const file = this.journal.files[index]
        if (file.sha256 === null) continue
        const backup = path.join(directory, String(index))
        const info = await lstat(backup)
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.size !== file.size ||
          (await hash(backup)) !== file.sha256
        )
          throw new Error('Import rollback snapshot is damaged')
      }
      const parent = await lstat(path.join(this.root, 'app_db')).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      if (parent && (!parent.isDirectory() || parent.isSymbolicLink()))
        throw new Error('Invalid product database recovery directory')
      for (const file of this.journal.files) {
        const target = await lstat(path.join(this.root, file.path)).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        if (target && (!target.isFile() || target.isSymbolicLink()))
          throw new Error('Invalid import rollback target')
      }
      if (this.journal.native) await recoverDimProfile(this.root, this.journal.native)
      await rm(path.join(this.root, 'app_db/agent.db-shm'), { force: true })
      for (let index = 0; index < this.journal.files.length; index++) {
        const file = this.journal.files[index]
        const target = path.join(this.root, file.path)
        if (file.sha256 === null) await rm(target, { force: true })
        else {
          const existing = await lstat(target).catch((error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
            throw error
          })
          if (existing && (!existing.isFile() || existing.isSymbolicLink()))
            throw new Error('Invalid import rollback target')
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
          await copyFile(path.join(directory, String(index)), target)
          await flush(target)
        }
      }
      await syncDirectory(path.join(this.root, 'app_db'))
      this.journal = { ...this.journal, phase: 'rolled-back' }
      await writeDurableJson(path.join(this.root, journalName), this.journal)
      await this.cleanup()
    } catch (error) {
      throw new DimProfileRecoveryError(directory, error)
    }
  }

  async cleanup(): Promise<void> {
    if (this.journal.phase === 'prepared') throw new Error('Import transaction is not settled')
    if (this.journal.native)
      await rm(path.join(this.root, this.journal.native), { recursive: true, force: true })
    await rm(path.join(this.root, this.journal.directory), { recursive: true, force: true })
    await rm(path.join(this.root, journalName), { force: true })
    await syncDirectory(this.root)
  }
}
