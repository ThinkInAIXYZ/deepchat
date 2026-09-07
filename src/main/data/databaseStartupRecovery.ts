import type { DatabaseStartupFailureKind } from '@shared/contracts/databaseSecurity'

const fs = process.getBuiltinModule('fs')
const path = process.getBuiltinModule('path')

export const SQLITE_MAGIC_HEADER = Buffer.from('SQLite format 3\0')
export type { DatabaseStartupFailureKind }

const DESTRUCTIVE_DATABASE_ERROR_PATTERNS = [
  /database disk image is malformed/i,
  /file is not a database/i,
  /SQLITE_CORRUPT/i,
  /SQLITE_NOTADB/i
]

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '')
  }

  return String(error ?? '')
}

export function isDestructiveDatabaseError(error: unknown): boolean {
  return DESTRUCTIVE_DATABASE_ERROR_PATTERNS.some((pattern) => pattern.test(getErrorMessage(error)))
}

export function isDecryptedDatabaseCorruptionError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return /database disk image is malformed/i.test(message) || /SQLITE_CORRUPT/i.test(message)
}

export class OrphanWalDatabaseError extends Error {
  readonly code = 'ORPHAN_WAL'

  constructor(readonly dbPath: string) {
    super(`Refusing to create "${dbPath}" because a leftover WAL sidecar exists`)
    this.name = 'OrphanWalDatabaseError'
  }
}

export function sqliteWalPath(dbPath: string): string {
  return `${dbPath}-wal`
}

export function sqliteShmPath(dbPath: string): string {
  return `${dbPath}-shm`
}

export function hasOrphanWalSidecar(dbPath: string): boolean {
  return !fs.existsSync(dbPath) && fs.existsSync(sqliteWalPath(dbPath))
}

export function assertNoOrphanWalSidecar(dbPath: string): void {
  if (hasOrphanWalSidecar(dbPath)) {
    throw new OrphanWalDatabaseError(dbPath)
  }
}

export function classifyDatabaseStartupFailure(input: {
  error: unknown
  dbPath: string
  password?: string
}): DatabaseStartupFailureKind | null {
  if (input.error instanceof OrphanWalDatabaseError || hasOrphanWalSidecar(input.dbPath)) {
    return 'orphaned-sidecar'
  }

  if (!isDestructiveDatabaseError(input.error)) {
    return null
  }

  if (input.password !== undefined) {
    return 'true-corruption'
  }

  const header = readDatabaseHeader(input.dbPath)
  if (!header || header.length < SQLITE_MAGIC_HEADER.length || hasSqliteMagic(header)) {
    return 'true-corruption'
  }

  return 'unreadable'
}

export function allocateQuarantineDirectory(dbPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  let directory = `${dbPath}.corrupt.${timestamp}`
  let suffix = 0
  while (fs.existsSync(directory)) {
    suffix += 1
    directory = `${dbPath}.corrupt.${timestamp}.${suffix}`
  }
  return directory
}

export function quarantineDatabaseFiles(dbPath: string, directory: string): string {
  fs.mkdirSync(directory, { recursive: true })

  for (const source of [dbPath, sqliteWalPath(dbPath), sqliteShmPath(dbPath)]) {
    if (!fs.existsSync(source)) {
      continue
    }

    fs.renameSync(source, path.join(directory, path.basename(source)))
  }

  return directory
}

function readDatabaseHeader(dbPath: string): Buffer | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(dbPath, 'r')
    const header = Buffer.alloc(SQLITE_MAGIC_HEADER.length)
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0)
    return header.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd)
    }
  }
}

function hasSqliteMagic(header: Buffer): boolean {
  return header.length === SQLITE_MAGIC_HEADER.length && header.equals(SQLITE_MAGIC_HEADER)
}
