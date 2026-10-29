import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeIfNativeSqlite } from '../nativeSqliteHarness'
import { openSQLiteDatabase } from '@/data/databaseConnection'
import {
  DatabaseSecurityService,
  DEFAULT_DATABASE_SECURITY_METADATA,
  type DatabaseSecurityMetadata
} from '@/app/databaseSecurity'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

describeIfNativeSqlite('Database security SQLCipher commit', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    for (const cleanup of cleanups.reverse()) cleanup()
    cleanups.length = 0
  })

  function fixture(password?: string) {
    const directory = mkdtempSync(join(tmpdir(), 'deepchat-database-security-'))
    const dbPath = join(directory, 'agent.db')
    const metadataPath = join(directory, 'database-security.json')
    const initial: DatabaseSecurityMetadata = password
      ? { version: 1, enabled: true, cipher: 'sqlcipher', passwordStorage: 'manual' }
      : { ...DEFAULT_DATABASE_SECURITY_METADATA }
    writeFileSync(metadataPath, JSON.stringify(initial))
    const metadata = {
      get: (_key: 'metadata') =>
        JSON.parse(readFileSync(metadataPath, 'utf8')) as DatabaseSecurityMetadata,
      set: vi.fn((_key: 'metadata', value: DatabaseSecurityMetadata) => {
        writeFileSync(metadataPath, JSON.stringify(value))
      })
    }
    const crypto = {
      isAvailable: vi.fn(async () => true),
      encrypt: vi.fn(async (value: string) => Buffer.from(value).toString('base64')),
      decrypt: vi.fn(async (wrapped: string) => Buffer.from(wrapped, 'base64').toString()),
      getBackend: vi.fn(async (): Promise<string | undefined> => undefined)
    }
    let db = openSQLiteDatabase(dbPath, password)
    db.exec(`
      CREATE TABLE agent_memory (id TEXT PRIMARY KEY, content TEXT NOT NULL);
      INSERT INTO agent_memory VALUES ('claim', 'durable memory');
      CREATE TABLE deepchat_tape_entries (id TEXT PRIMARY KEY, parent_id TEXT);
      INSERT INTO deepchat_tape_entries VALUES ('root', NULL), ('child', 'root');
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      INSERT INTO app_settings VALUES ('copyWithCotEnabled', 'false');
    `)
    const database = {
      getDatabasePath: () => dbPath,
      checkpointAndClose: vi.fn(() => {
        db.pragma('wal_checkpoint(TRUNCATE)')
        db.close()
      }),
      close: () => {
        if (db.open) db.close()
      },
      reopenWithPassword: vi.fn((key?: string) => {
        db = openSQLiteDatabase(dbPath, key)
      }),
      isOpen: () => db.open
    }
    const providerSettings = { cleanupLegacyProviderJsonForDatabaseEncryption: vi.fn(() => 0) }
    const service = new DatabaseSecurityService({ dbPath, metadata, crypto })
    cleanups.push(() => {
      service.stop()
      database.close()
      rmSync(directory, { recursive: true, force: true })
    })
    return {
      service,
      metadata,
      crypto,
      database,
      providerSettings,
      dbPath,
      metadataPath,
      initial,
      assertData(key?: string) {
        const check = openSQLiteDatabase(dbPath, key)
        try {
          expect(check.pragma('quick_check', { simple: true })).toBe('ok')
          expect(check.prepare('SELECT * FROM agent_memory').all()).toEqual([
            { id: 'claim', content: 'durable memory' }
          ])
          expect(check.prepare('SELECT * FROM deepchat_tape_entries ORDER BY id').all()).toEqual([
            { id: 'child', parent_id: 'root' },
            { id: 'root', parent_id: null }
          ])
          expect(check.prepare('SELECT * FROM app_settings').get()).toEqual({
            key: 'copyWithCotEnabled',
            value_json: 'false'
          })
        } finally {
          check.close()
        }
        expect(existsSync(`${dbPath}.migration-tmp`)).toBe(false)
        expect(existsSync(`${dbPath}.migration-rollback`)).toBe(false)
      }
    }
  }

  it('preserves durable rows across enable, rekey, manual unlock and disable', async () => {
    const f = fixture()
    expect(await f.service.enableEncryption({ password: 'first', ...f })).toMatchObject({
      enabled: true,
      migrationInProgress: false
    })
    f.assertData('first')
    expect(() => openSQLiteDatabase(f.dbPath)).toThrow()
    await expect(
      f.service.changePassword({ currentPassword: 'wrong', newPassword: 'next', ...f })
    ).rejects.toThrow()
    f.assertData('first')
    expect(
      await f.service.changePassword({ currentPassword: 'first', newPassword: 'next', ...f })
    ).toMatchObject({ enabled: true, migrationInProgress: false })
    f.assertData('next')
    expect(() => openSQLiteDatabase(f.dbPath, 'first')).toThrow()
    f.crypto.isAvailable.mockResolvedValue(false)
    const manual = await f.service.changePassword({
      currentPassword: 'next',
      newPassword: 'manual',
      ...f
    })
    expect(manual).toMatchObject({
      enabled: true,
      passwordStorage: 'manual',
      manualUnlockRequired: true
    })
    expect(f.metadata.get('metadata').wrappedPassword).toBeUndefined()
    await expect(f.service.resolveStartupPassword(async () => 'manual')).resolves.toBe('manual')
    expect(await f.service.disableEncryption({ currentPassword: 'manual', ...f })).toMatchObject({
      enabled: false,
      passwordStorage: 'none',
      migrationInProgress: false
    })
    f.assertData()
  })

  it('keeps the original writer and metadata when native wrapping fails', async () => {
    const f = fixture()
    f.crypto.encrypt.mockRejectedValueOnce(new Error('vault locked'))
    await expect(f.service.enableEncryption({ password: 'next', ...f })).rejects.toThrow(
      'vault locked'
    )
    expect(f.database.checkpointAndClose).not.toHaveBeenCalled()
    expect(f.providerSettings.cleanupLegacyProviderJsonForDatabaseEncryption).not.toHaveBeenCalled()
    expect(f.metadata.get('metadata')).toEqual(f.initial)
    f.assertData()
    await f.service.enableEncryption({ password: 'next', ...f })
    f.assertData('next')
  })

  it.each(['enable', 'change-password', 'disable'] as const)(
    'rolls back database and metadata together when %s metadata persistence fails',
    async (direction) => {
      const sourceKey = direction === 'enable' ? undefined : 'original'
      const f = fixture(sourceKey)
      f.metadata.set.mockImplementationOnce((_key, value) => {
        writeFileSync(f.metadataPath, JSON.stringify(value))
        throw new Error('metadata write failed')
      })
      const result =
        direction === 'enable'
          ? f.service.enableEncryption({ password: 'next', ...f })
          : direction === 'change-password'
            ? f.service.changePassword({ currentPassword: 'original', newPassword: 'next', ...f })
            : f.service.disableEncryption({ currentPassword: 'original', ...f })
      await expect(result).rejects.toThrow('metadata write failed')
      expect(f.database.isOpen()).toBe(true)
      expect(f.metadata.get('metadata')).toEqual(f.initial)
      f.assertData(sourceKey)
      expect(() => openSQLiteDatabase(f.dbPath, 'next')).toThrow()
    }
  )

  it('restores the original encrypted writer after target reopen fails', async () => {
    const f = fixture('original')
    f.database.reopenWithPassword.mockImplementationOnce(() => {
      throw new Error('reopen failed')
    })
    await expect(
      f.service.changePassword({ currentPassword: 'original', newPassword: 'next', ...f })
    ).rejects.toThrow('reopen failed')
    expect(f.database.isOpen()).toBe(true)
    expect(f.metadata.get('metadata')).toEqual(f.initial)
    f.assertData('original')
    expect(() => openSQLiteDatabase(f.dbPath, 'next')).toThrow()
  })

  it('locks the profile through pending crypto and discards stopped results before mutation', async () => {
    const f = fixture()
    let finish!: (wrapped: string) => void
    f.crypto.encrypt.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
    const result = f.service.enableEncryption({ password: 'next', ...f })
    const rejected = expect(result).rejects.toThrow('Database security operation interrupted')
    await vi.waitFor(() => expect(f.crypto.encrypt).toHaveBeenCalled())
    await expect(f.service.enableEncryption({ password: 'other', ...f })).rejects.toThrow(
      'already in progress'
    )
    await expect(f.service.persistRecoveredEncryptionMetadata('other')).rejects.toThrow(
      'already in progress'
    )
    expect(
      () =>
        new DatabaseSecurityService({ dbPath: f.dbPath, metadata: f.metadata, crypto: f.crypto })
    ).toThrow('already in progress')
    f.service.stop()
    finish('late-ciphertext')
    await rejected
    expect(f.database.checkpointAndClose).not.toHaveBeenCalled()
    expect(f.metadata.get('metadata')).toEqual(f.initial)
    f.assertData()
    const replacement = new DatabaseSecurityService({
      dbPath: f.dbPath,
      metadata: f.metadata,
      crypto: f.crypto
    })
    try {
      expect(await replacement.getStatus()).toMatchObject({
        enabled: false,
        migrationInProgress: false
      })
    } finally {
      replacement.stop()
    }
  })
})
