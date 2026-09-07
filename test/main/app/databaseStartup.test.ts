import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appQuit: vi.fn(),
  classify: vi.fn(),
  allocate: vi.fn(),
  quarantine: vi.fn(),
  initialize: vi.fn(),
  DatabaseInitializer: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    quit: mocks.appQuit
  }
}))

vi.mock('@/data/databaseStartupRecovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/databaseStartupRecovery')>()
  return {
    ...actual,
    classifyDatabaseStartupFailure: mocks.classify,
    allocateQuarantineDirectory: mocks.allocate,
    quarantineDatabaseFiles: mocks.quarantine
  }
})

vi.mock('@/app/databaseInitializer', () => ({
  DatabaseInitializer: mocks.DatabaseInitializer
}))

describe('initializeMainDatabaseWithRecovery', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.appQuit.mockReset()
    mocks.classify.mockReset()
    mocks.allocate.mockReset()
    mocks.quarantine.mockReset()
    mocks.initialize.mockReset()
    mocks.DatabaseInitializer.mockReset()
    mocks.DatabaseInitializer.mockImplementation(() => ({
      initialize: mocks.initialize
    }))
    mocks.quarantine.mockImplementation((_dbPath: string, directory: string) => directory)
    let allocated = 0
    mocks.allocate.mockImplementation(
      (dbPath: string) => `${dbPath}.corrupt.${String(++allocated).padStart(3, '0')}`
    )
  })

  function createPorts(overrides?: {
    password?: string
    recovery?: Array<{ action: 'start-empty' } | { action: 'password'; password: string } | null>
  }) {
    const recovery = [...(overrides?.recovery ?? [])]
    return {
      security: {
        getDatabasePath: () => '/tmp/deepchat-test/app_db/agent.db',
        resolveStartupPassword: vi.fn(async () => overrides?.password),
        validatePassword: vi.fn(),
        persistRecoveredEncryptionMetadata: vi.fn(),
        clearEncryptionMetadata: vi.fn()
      },
      splash: {
        requestDatabaseUnlock: vi.fn(),
        requestDatabaseRecovery: vi.fn(async () => recovery.shift() ?? null)
      }
    }
  }

  it('returns the opened database when startup succeeds', async () => {
    const database = { id: 'db' }
    mocks.initialize.mockResolvedValue(database)
    const { initializeMainDatabaseWithRecovery } =
      await import('../../../src/main/app/databaseStartup')
    const ports = createPorts({ password: 'secret' })

    await expect(initializeMainDatabaseWithRecovery(ports as never)).resolves.toBe(database)
    expect(ports.splash.requestDatabaseRecovery).not.toHaveBeenCalled()
    expect(mocks.quarantine).not.toHaveBeenCalled()
  })

  it('quarantines a damaged database only after the user chooses start empty', async () => {
    const database = { id: 'fresh' }
    mocks.initialize
      .mockRejectedValueOnce(new Error('SQLITE_CORRUPT: malformed page'))
      .mockResolvedValueOnce(database)
    mocks.classify.mockReturnValue('true-corruption')
    const { initializeMainDatabaseWithRecovery } =
      await import('../../../src/main/app/databaseStartup')
    const ports = createPorts({
      password: 'secret',
      recovery: [{ action: 'start-empty' }]
    })

    await expect(initializeMainDatabaseWithRecovery(ports as never)).resolves.toBe(database)
    const shownPath = ports.splash.requestDatabaseRecovery.mock.calls[0]?.[0].preservedPath
    expect(shownPath).toMatch(/agent\.db\.corrupt\./)
    expect(mocks.quarantine).toHaveBeenCalledWith('/tmp/deepchat-test/app_db/agent.db', shownPath)
    expect(ports.security.clearEncryptionMetadata).not.toHaveBeenCalled()
    expect(mocks.initialize).toHaveBeenCalledTimes(2)
  })

  it('repairs encryption metadata after a recovered password opens the file', async () => {
    const database = { id: 'opened' }
    mocks.initialize
      .mockRejectedValueOnce(new Error('file is not a database'))
      .mockResolvedValueOnce(database)
    mocks.classify.mockReturnValue('unreadable')
    const { initializeMainDatabaseWithRecovery } =
      await import('../../../src/main/app/databaseStartup')
    const ports = createPorts({
      recovery: [{ action: 'password', password: 'recovered' }]
    })

    await expect(initializeMainDatabaseWithRecovery(ports as never)).resolves.toBe(database)
    expect(ports.security.validatePassword).toHaveBeenCalledWith('recovered')
    expect(ports.security.persistRecoveredEncryptionMetadata).toHaveBeenCalledWith('recovered')
    expect(mocks.quarantine).not.toHaveBeenCalled()
  })

  it('clears encryption metadata when starting empty from an unreadable file', async () => {
    const database = { id: 'fresh' }
    mocks.initialize
      .mockRejectedValueOnce(new Error('file is not a database'))
      .mockResolvedValueOnce(database)
    mocks.classify.mockReturnValue('unreadable')
    const { initializeMainDatabaseWithRecovery } =
      await import('../../../src/main/app/databaseStartup')
    const ports = createPorts({
      recovery: [{ action: 'start-empty' }]
    })

    await expect(initializeMainDatabaseWithRecovery(ports as never)).resolves.toBe(database)
    expect(ports.security.clearEncryptionMetadata).toHaveBeenCalledTimes(1)
  })

  it('asks again when a recovery password fails validation', async () => {
    const database = { id: 'opened' }
    mocks.initialize
      .mockRejectedValueOnce(new Error('file is not a database'))
      .mockResolvedValueOnce(database)
    mocks.classify.mockReturnValue('unreadable')
    const { initializeMainDatabaseWithRecovery } =
      await import('../../../src/main/app/databaseStartup')
    const ports = createPorts({
      recovery: [
        { action: 'password', password: 'wrong' },
        { action: 'password', password: 'right' }
      ]
    })
    ports.security.validatePassword.mockImplementation((value: string) => {
      if (value === 'wrong') {
        throw new Error('file is not a database')
      }
    })

    await expect(initializeMainDatabaseWithRecovery(ports as never)).resolves.toBe(database)
    expect(ports.splash.requestDatabaseRecovery).toHaveBeenCalledTimes(2)
    expect(ports.splash.requestDatabaseRecovery.mock.calls[1]?.[0]).toMatchObject({
      invalidPassword: true
    })
    expect(mocks.initialize).toHaveBeenCalledTimes(2)
  })

  it('promotes a decrypted corruption error to true-corruption instead of wrong password', async () => {
    const database = { id: 'fresh' }
    mocks.initialize
      .mockRejectedValueOnce(new Error('file is not a database'))
      .mockResolvedValueOnce(database)
    mocks.classify.mockReturnValueOnce('unreadable')
    const { initializeMainDatabaseWithRecovery } =
      await import('../../../src/main/app/databaseStartup')
    const ports = createPorts({
      recovery: [{ action: 'password', password: 'secret' }, { action: 'start-empty' }]
    })
    ports.security.validatePassword.mockImplementation(() => {
      throw new Error('SQLITE_CORRUPT: malformed page')
    })

    await expect(initializeMainDatabaseWithRecovery(ports as never)).resolves.toBe(database)
    expect(ports.security.persistRecoveredEncryptionMetadata).toHaveBeenCalledWith('secret')
    expect(ports.splash.requestDatabaseRecovery.mock.calls[1]?.[0]).toMatchObject({
      kind: 'true-corruption',
      invalidPassword: false
    })
    expect(ports.security.clearEncryptionMetadata).not.toHaveBeenCalled()
  })

  it('starts empty with encryption after unlock proves the password on a corrupt file', async () => {
    const database = { id: 'fresh' }
    mocks.initialize
      .mockRejectedValueOnce(new Error('SQLITE_CORRUPT: malformed page'))
      .mockResolvedValueOnce(database)
    mocks.classify.mockImplementation((input: { password?: string }) =>
      input.password === undefined ? 'unreadable' : 'true-corruption'
    )
    const { initializeMainDatabaseWithRecovery } =
      await import('../../../src/main/app/databaseStartup')
    const ports = createPorts({
      password: 'secret',
      recovery: [{ action: 'start-empty' }]
    })

    await expect(initializeMainDatabaseWithRecovery(ports as never)).resolves.toBe(database)
    expect(mocks.classify).toHaveBeenCalledWith(expect.objectContaining({ password: 'secret' }))
    expect(ports.splash.requestDatabaseRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'true-corruption' })
    )
    expect(ports.security.clearEncryptionMetadata).not.toHaveBeenCalled()
  })

  it('does not treat leftover WAL as a wrong recovery password', async () => {
    const { OrphanWalDatabaseError } =
      await import('../../../src/main/data/databaseStartupRecovery')
    const database = { id: 'fresh' }
    mocks.initialize
      .mockRejectedValueOnce(new Error('file is not a database'))
      .mockResolvedValueOnce(database)
    mocks.classify.mockReturnValueOnce('unreadable')
    const { initializeMainDatabaseWithRecovery } =
      await import('../../../src/main/app/databaseStartup')
    const ports = createPorts({
      recovery: [{ action: 'password', password: 'secret' }, { action: 'start-empty' }]
    })
    ports.security.validatePassword.mockImplementation(() => {
      throw new OrphanWalDatabaseError('/tmp/deepchat-test/app_db/agent.db')
    })

    await expect(initializeMainDatabaseWithRecovery(ports as never)).resolves.toBe(database)
    expect(ports.splash.requestDatabaseRecovery.mock.calls[1]?.[0]).toMatchObject({
      kind: 'orphaned-sidecar',
      invalidPassword: false
    })
  })

  it('redisplays recovery when quarantining the original files fails', async () => {
    const database = { id: 'fresh' }
    mocks.initialize
      .mockRejectedValueOnce(new Error('SQLITE_CORRUPT: malformed page'))
      .mockResolvedValueOnce(database)
    mocks.classify.mockReturnValue('true-corruption')
    mocks.quarantine.mockImplementationOnce(() => {
      throw new Error('EBUSY: resource busy or locked')
    })
    const { initializeMainDatabaseWithRecovery } =
      await import('../../../src/main/app/databaseStartup')
    const ports = createPorts({
      password: 'secret',
      recovery: [{ action: 'start-empty' }, { action: 'start-empty' }]
    })

    await expect(initializeMainDatabaseWithRecovery(ports as never)).resolves.toBe(database)
    expect(ports.splash.requestDatabaseRecovery).toHaveBeenCalledTimes(2)
    expect(ports.splash.requestDatabaseRecovery.mock.calls[1]?.[0]).toMatchObject({
      quarantineFailed: true
    })
    expect(mocks.quarantine).toHaveBeenCalledTimes(2)
    const shownPath = ports.splash.requestDatabaseRecovery.mock.calls[0]?.[0].preservedPath
    expect(ports.splash.requestDatabaseRecovery.mock.calls[1]?.[0].preservedPath).toBe(shownPath)
    expect(mocks.quarantine.mock.calls[0]?.[1]).toBe(shownPath)
    expect(mocks.quarantine.mock.calls[1]?.[1]).toBe(shownPath)
  })
})
