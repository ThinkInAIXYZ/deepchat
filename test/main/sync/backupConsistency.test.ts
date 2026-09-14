import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fsModule from 'fs'
import { unzipSync } from 'fflate'
import Database from 'better-sqlite3-multiple-ciphers'
import { openSQLiteDatabase } from '@/data/databaseConnection'
import { withBackupReadLock } from '@/data/backupReadLock'

vi.mock('../../../src/main/sync/cloudStorageService', () => ({
  CloudStorageService: vi.fn(() => ({}))
}))

const AGENT_DB_ENTRY = 'database/agent.db'
const SEED_ROWS = 120
const ROW_PAYLOAD = 'payload-'.repeat(64)

const realFs = await vi.importActual<typeof import('fs')>('fs')
const path = await vi.importActual<typeof import('path')>('path')
const osActual = await vi.importActual<typeof import('os')>('os')
Object.assign(fsModule, realFs)
;(fsModule as unknown as { promises: unknown }).promises = (
  realFs as unknown as { promises: unknown }
).promises
const fs = realFs

const { app } = await import('electron')
const { SyncService } = await import('../../../src/main/sync')

let userDataDir: string
let syncDir: string
let dbPath: string
let writerDb: Database.Database | null = null
let sidecarConnections: Database.Database[] = []
let postCheckpointImages: Buffer[] = []
let getPathSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(osActual.tmpdir(), 'deepchat-user-'))
  syncDir = fs.mkdtempSync(path.join(osActual.tmpdir(), 'deepchat-sync-'))
  dbPath = path.join(userDataDir, 'app_db', 'agent.db')
  postCheckpointImages = []
  getPathSpy = vi.spyOn(app, 'getPath').mockImplementation((type: string) => {
    if (type === 'userData') return userDataDir
    return osActual.tmpdir()
  })
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'app-settings.json'), JSON.stringify({ theme: 'dark' }))
})

afterEach(() => {
  for (const connection of sidecarConnections) {
    try {
      connection.exec('COMMIT')
    } catch {}
    connection.close()
  }
  sidecarConnections = []
  writerDb?.close()
  writerDb = null
  getPathSpy.mockRestore()
  fs.rmSync(userDataDir, { recursive: true, force: true })
  fs.rmSync(syncDir, { recursive: true, force: true })
})

function buildService(password: string | undefined): InstanceType<typeof SyncService> {
  const connection = openSQLiteDatabase(dbPath, password)
  writerDb = connection
  connection.exec('CREATE TABLE backup_probe (id INTEGER PRIMARY KEY, payload TEXT)')
  const insert = connection.prepare('INSERT INTO backup_probe (payload) VALUES (?)')
  connection.transaction(() => {
    for (let index = 0; index < SEED_ROWS; index++) insert.run(ROW_PAYLOAD)
  })()

  const checkpointingHandle = {
    open: true,
    pragma: (source: string, options?: unknown) => {
      const result = connection.pragma(source, options as never)
      if (source.startsWith('wal_checkpoint')) {
        postCheckpointImages.push(fs.readFileSync(dbPath))
      }
      return result
    }
  }

  return new SyncService(
    {
      getFolderPath: () => syncDir,
      getEnabled: () => true,
      getLastSyncTime: () => 0,
      setLastSyncTime: () => undefined
    } as never,
    {
      getDatabasePassword: () => password,
      openDatabaseConnection: (target: string) => openSQLiteDatabase(target, password),
      withBackupReadLock: (work: () => Promise<unknown>) =>
        withBackupReadLock(checkpointingHandle, () => openSQLiteDatabase(dbPath, password), work)
    } as never,
    {
      get appSettingsTable() {
        return { hasConfigMigration: () => true }
      }
    } as never,
    {} as never,
    vi.fn() as never
  )
}

function copiesInChunks(mutate: () => void) {
  const originalReadFile = fs.promises.readFile.bind(fs.promises)
  return vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
    target: unknown,
    options?: unknown
  ) => {
    if (target !== dbPath) {
      return originalReadFile(target as never, options as never)
    }
    const handle = await fs.promises.open(dbPath, 'r')
    try {
      const { size } = await handle.stat()
      const chunks: Buffer[] = []
      let offset = 0
      let mutated = false
      while (offset < size) {
        const length = Math.min(8192, size - offset)
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        if (bytesRead === 0) break
        chunks.push(buffer.subarray(0, bytesRead))
        offset += bytesRead
        if (!mutated && offset >= size / 2) {
          mutate()
          mutated = true
        }
      }
      return Buffer.concat(chunks)
    } finally {
      await handle.close()
    }
  }) as never)
}

function writeDuringCopy() {
  const connection = writerDb as Database.Database
  const insert = connection.prepare('INSERT INTO backup_probe (payload) VALUES (?)')
  connection.transaction(() => {
    for (let index = 0; index < 1500; index++) insert.run(ROW_PAYLOAD)
  })()
  connection.pragma('wal_checkpoint(PASSIVE)')
}

function archivedDatabaseEntry(fileName: string): Buffer {
  const archive = fs.readFileSync(path.join(syncDir, fileName))
  const entries = unzipSync(new Uint8Array(archive)) as unknown as Record<string, Uint8Array>
  return Buffer.from(entries[AGENT_DB_ENTRY])
}

function openCopiedImage(image: Buffer, password: string | undefined): Database.Database {
  const restoredPath = path.join(userDataDir, 'restored.db')
  fs.writeFileSync(restoredPath, image)
  const db = new Database(restoredPath)
  if (password) {
    db.pragma("cipher='sqlcipher'")
    db.pragma('legacy=4')
    db.key(Buffer.from(password, 'utf8'))
  }
  return db
}

function expectUsableProbeTable(image: Buffer, password: string | undefined): void {
  const restored = openCopiedImage(image, password)
  try {
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok')
    const { count } = restored.prepare('SELECT count(*) AS count FROM backup_probe').get() as {
      count: number
    }
    expect(count).toBeGreaterThanOrEqual(SEED_ROWS)
  } finally {
    restored.close()
  }
}

describe('backup database image consistency', () => {
  it('copies the checkpointed image even while other writes commit mid-read', async () => {
    const service = buildService(undefined)
    const copySpy = copiesInChunks(writeDuringCopy)

    const backup = await service.startBackup()

    expect(backup).not.toBeNull()
    copySpy.mockRestore()
    const archived = archivedDatabaseEntry((backup as { fileName: string }).fileName)

    expect(archived.equals(postCheckpointImages[postCheckpointImages.length - 1])).toBe(true)
    expectUsableProbeTable(archived, undefined)
  })

  it('holds the image steady for an encrypted database too', async () => {
    const password = 'backup-consistency-key'
    const service = buildService(password)
    const copySpy = copiesInChunks(writeDuringCopy)

    const backup = await service.startBackup()

    expect(backup).not.toBeNull()
    copySpy.mockRestore()
    const archived = archivedDatabaseEntry((backup as { fileName: string }).fileName)
    expect(archived.equals(postCheckpointImages[postCheckpointImages.length - 1])).toBe(true)

    expect(() => {
      const withoutKey = openCopiedImage(archived, undefined)
      try {
        withoutKey.prepare('SELECT count(*) AS count FROM backup_probe').get()
      } finally {
        withoutKey.close()
      }
    }).toThrow()

    expectUsableProbeTable(archived, password)
  })

  it('writes a multi-slice archive that still round-trips', async () => {
    const service = buildService(undefined)
    const connection = writerDb as Database.Database
    const insert = connection.prepare('INSERT INTO backup_probe (payload) VALUES (?)')
    const bigPayload = ROW_PAYLOAD.repeat(16)
    connection.transaction(() => {
      for (let index = 0; index < 700; index++) insert.run(bigPayload)
    })()

    const backup = await service.startBackup()

    expect(backup).not.toBeNull()
    const archivePath = path.join(syncDir, (backup as { fileName: string }).fileName)
    expect(fs.statSync(archivePath).size).toBeGreaterThan(0)
    const entries = unzipSync(new Uint8Array(fs.readFileSync(archivePath))) as unknown as Record<
      string,
      Uint8Array
    >
    expect(entries[AGENT_DB_ENTRY].length).toBeGreaterThan(4 * 1024 * 1024)
    expect(Object.keys(entries).sort()).toEqual(
      [AGENT_DB_ENTRY, 'configs/app-settings.json', 'manifest.json'].sort()
    )
    expectUsableProbeTable(Buffer.from(entries[AGENT_DB_ENTRY]), undefined)
  })

  it('captures the supporting files alongside the image, not after it', async () => {
    const service = buildService(undefined)
    const settingsPath = path.join(userDataDir, 'app-settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'before' }))

    const copySpy = copiesInChunks(() => {
      writeDuringCopy()
      fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'after' }))
    })

    const backup = await service.startBackup()

    expect(backup).not.toBeNull()
    copySpy.mockRestore()
    const archive = fs.readFileSync(path.join(syncDir, (backup as { fileName: string }).fileName))
    const entries = unzipSync(new Uint8Array(archive)) as unknown as Record<string, Uint8Array>
    expect(JSON.parse(Buffer.from(entries['configs/app-settings.json']).toString('utf-8'))).toEqual(
      {
        theme: 'before'
      }
    )
    expectUsableProbeTable(Buffer.from(entries[AGENT_DB_ENTRY]), undefined)
  })

  it('still produces a usable image when another reader blocks the checkpoint', async () => {
    const service = buildService(undefined)
    const connection = writerDb as Database.Database
    connection.pragma('wal_checkpoint(PASSIVE)')

    const holder = openSQLiteDatabase(dbPath, undefined)
    sidecarConnections.push(holder)
    holder.exec('BEGIN')
    holder.prepare('SELECT count(*) AS count FROM backup_probe').get()
    const insert = connection.prepare('INSERT INTO backup_probe (payload) VALUES (?)')
    connection.transaction(() => {
      for (let index = 0; index < 40; index++) insert.run(ROW_PAYLOAD)
    })()

    const copySpy = copiesInChunks(writeDuringCopy)
    const backup = await service.startBackup()

    expect(backup).not.toBeNull()
    copySpy.mockRestore()
    const archived = archivedDatabaseEntry((backup as { fileName: string }).fileName)

    expect(postCheckpointImages.length).toBeGreaterThan(1)
    expectUsableProbeTable(archived, undefined)
  })
})
