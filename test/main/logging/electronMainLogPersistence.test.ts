import electronLog from 'electron-log'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElectronMainLogPersistence } from '@/logging/electronMainLogPersistence'
import { MAX_MAIN_LOG_RECORD_BYTES } from '@/logging/mainLogger'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const temporaryDirectories: string[] = []
const persistenceInstances: ElectronMainLogPersistence[] = []
const MAX_FILE_BYTES = 10 * 1024 * 1024

afterEach(() => {
  for (const persistence of persistenceInstances.splice(0)) persistence.disable()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createUserData(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-main-log-'))
  temporaryDirectories.push(directory)
  return directory
}

function fstatWithOptions(descriptor: number, options?: { bigint?: boolean }) {
  return options?.bigint ? fs.fstatSync(descriptor, { bigint: true }) : fs.fstatSync(descriptor)
}

function lstatWithOptions(filePath: fs.PathLike, options?: { bigint?: boolean }) {
  return options?.bigint ? fs.lstatSync(filePath, { bigint: true }) : fs.lstatSync(filePath)
}

function createElectronLog() {
  const fileTransport = { level: 'info' as string | false }
  const consoleTransport = { level: 'info' as string | false }
  const processMessage = vi.fn(
    (message: { data: unknown[] }, options: { transports: Array<(message: unknown) => void> }) => {
      for (const transport of options.transports) transport(message)
    }
  )
  return {
    transports: { file: fileTransport, console: consoleTransport },
    processMessage
  }
}

function createPersistence(userData: string, overrides: Record<string, unknown> = {}) {
  const log = createElectronLog()
  const persistence = new ElectronMainLogPersistence({
    getUserDataPath: () => userData,
    log: log as never,
    fs: { ...fs, ...overrides } as never
  })
  persistenceInstances.push(persistence)
  return { log, persistence }
}

function writeCompleteFileAtLimit(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'w')
  try {
    fs.ftruncateSync(descriptor, MAX_FILE_BYTES)
    fs.writeSync(descriptor, Buffer.from('\n'), 0, 1, MAX_FILE_BYTES - 1)
  } finally {
    fs.closeSync(descriptor)
  }
}

function validLine(seq = 1): string {
  return JSON.stringify({
    v: 1,
    ts: '2026-08-10T12:34:56.789Z',
    seq,
    level: 'info',
    event: 'app.shutdown.started',
    process: 'main',
    processInstanceId: '3f70b2a5-b28b-4786-8e45-e50ec018a02f',
    appVersion: '1.2.3',
    context: { reason: 'app_quit' }
  })
}

describe('ElectronMainLogPersistence', () => {
  it('stays inert until enabled and writes one LF-terminated JSON object', () => {
    const userData = createUserData()
    const getUserDataPath = vi.fn(() => userData)
    const log = createElectronLog()
    const persistence = new ElectronMainLogPersistence({
      getUserDataPath,
      log: log as never,
      fs
    })
    persistenceInstances.push(persistence)

    expect(getUserDataPath).not.toHaveBeenCalled()
    expect(log.transports.file.level).toBe(false)
    expect(log.transports.console.level).toBe(false)
    expect(persistence.enable()).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs/main.jsonl'))).toBe(false)

    const line = validLine()
    expect(persistence.write('info', line)).toBe(true)
    expect(fs.readFileSync(path.join(userData, 'logs/main.jsonl'), 'utf8')).toBe(`${line}\n`)
    expect(log.processMessage).toHaveBeenCalledWith(
      { data: [line], date: expect.any(Date), level: 'info' },
      { transports: [expect.any(Function)] }
    )
  })

  it('creates a dedicated logger and disables the unused default file sink', () => {
    const userData = createUserData()
    const originalConsoleLevel = electronLog.transports.console.level

    const persistence = new ElectronMainLogPersistence({ getUserDataPath: () => userData, fs })
    persistenceInstances.push(persistence)
    expect(persistence.enable()).toBe(true)
    expect(persistence.write('info', validLine())).toBe(true)

    expect(electronLog.transports.file.level).toBe(false)
    expect(electronLog.transports.console.level).toBe(originalConsoleLevel)
    expect(fs.readFileSync(path.join(userData, 'logs/main.jsonl'), 'utf8')).toBe(`${validLine()}\n`)
  })

  it('reuses one validated append descriptor until persistence is disabled', () => {
    const userData = createUserData()
    const openSync = vi.fn((...args: Parameters<typeof fs.openSync>) =>
      fs.openSync(...args)
    ) as typeof fs.openSync
    const fstatSync = vi.fn(fstatWithOptions)
    const closeSync = vi.fn((descriptor: number) => fs.closeSync(descriptor))
    const { persistence } = createPersistence(userData, { openSync, fstatSync, closeSync })
    expect(persistence.enable()).toBe(true)

    expect(persistence.write('info', validLine())).toBe(true)
    expect(persistence.write('info', validLine(2))).toBe(true)

    expect(openSync).toHaveBeenCalledOnce()
    expect(fstatSync).toHaveBeenCalledOnce()
    expect(closeSync).not.toHaveBeenCalled()
    persistence.disable()
    expect(closeSync).toHaveBeenCalledOnce()
  })

  it('repairs only an incomplete active-file tail and leaves legacy logs untouched', () => {
    const userData = createUserData()
    const logDirectory = path.join(userData, 'logs')
    const activePath = path.join(logDirectory, 'main.jsonl')
    const legacyPath = path.join(logDirectory, 'main.log')
    fs.mkdirSync(logDirectory, { recursive: true })
    fs.writeFileSync(activePath, '{"seq":1}\n{"seq":2')
    fs.writeFileSync(legacyPath, 'legacy text\n')
    const { persistence } = createPersistence(userData)

    expect(persistence.enable()).toBe(true)
    expect(fs.readFileSync(activePath, 'utf8')).toBe('{"seq":1}\n')
    expect(fs.readFileSync(legacyPath, 'utf8')).toBe('legacy text\n')
  })

  it('disables persistence after a bounded scan of an oversized incomplete tail', () => {
    const userData = createUserData()
    const activePath = path.join(userData, 'logs/main.jsonl')
    fs.mkdirSync(path.dirname(activePath), { recursive: true })
    const descriptor = fs.openSync(activePath, 'w')
    try {
      fs.ftruncateSync(descriptor, MAX_FILE_BYTES * 100)
    } finally {
      fs.closeSync(descriptor)
    }
    const readSync = vi.fn(
      (
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        offset: number,
        length: number,
        position: number | null
      ) => fs.readSync(fd, buffer, offset, length, position)
    )
    const { persistence } = createPersistence(userData, { readSync })

    expect(persistence.enable()).toBe(false)
    expect(readSync.mock.calls.reduce((total, call) => total + call[3], 0)).toBeLessThanOrEqual(
      MAX_MAIN_LOG_RECORD_BYTES + 2
    )
    expect(fs.statSync(activePath).size).toBe(MAX_FILE_BYTES * 100)
  })

  it.each([
    { tailBytes: MAX_MAIN_LOG_RECORD_BYTES - 1, enabled: true },
    { tailBytes: MAX_MAIN_LOG_RECORD_BYTES, enabled: false },
    { tailBytes: MAX_MAIN_LOG_RECORD_BYTES + 1, enabled: false }
  ])(
    'handles an incomplete tail of $tailBytes bytes at the repair boundary',
    ({ tailBytes, enabled }) => {
      const userData = createUserData()
      const activePath = path.join(userData, 'logs/main.jsonl')
      const prefix = Buffer.from('{"seq":1}\n')
      const original = Buffer.concat([prefix, Buffer.alloc(tailBytes, 0x78)])
      fs.mkdirSync(path.dirname(activePath), { recursive: true })
      fs.writeFileSync(activePath, original)
      const { persistence } = createPersistence(userData)

      expect(persistence.enable()).toBe(enabled)
      expect(fs.readFileSync(activePath)).toEqual(enabled ? prefix : original)
    }
  )

  it.each([MAX_MAIN_LOG_RECORD_BYTES, MAX_MAIN_LOG_RECORD_BYTES + 1])(
    'preserves and rejects a %i-byte incomplete tail without a complete prefix',
    (tailBytes) => {
      const userData = createUserData()
      const activePath = path.join(userData, 'logs/main.jsonl')
      const original = Buffer.alloc(tailBytes, 0x78)
      fs.mkdirSync(path.dirname(activePath), { recursive: true })
      fs.writeFileSync(activePath, original)
      const { persistence } = createPersistence(userData)

      expect(persistence.enable()).toBe(false)
      expect(fs.readFileSync(activePath)).toEqual(original)
    }
  )

  it('rotates before crossing the limit and retains one complete archive', () => {
    const userData = createUserData()
    const logDirectory = path.join(userData, 'logs')
    const activePath = path.join(logDirectory, 'main.jsonl')
    const archivePath = path.join(logDirectory, 'main.old.jsonl')
    fs.mkdirSync(logDirectory, { recursive: true })
    writeCompleteFileAtLimit(activePath)
    fs.writeFileSync(archivePath, '{"seq":0}\n')
    const { persistence } = createPersistence(userData)
    expect(persistence.enable()).toBe(true)

    const line = validLine(2)
    expect(persistence.write('info', line)).toBe(true)

    expect(fs.statSync(archivePath).size).toBe(MAX_FILE_BYTES)
    expect(fs.readFileSync(activePath, 'utf8')).toBe(`${line}\n`)
  })

  it('does not rotate a path that changed after its append descriptor was opened', () => {
    const userData = createUserData()
    const logDirectory = path.join(userData, 'logs')
    const activePath = path.join(logDirectory, 'main.jsonl')
    const replacementPath = path.join(logDirectory, 'replacement.jsonl')
    const replacementContents = '{"replacement":true}\n'
    fs.mkdirSync(logDirectory, { recursive: true })
    writeCompleteFileAtLimit(activePath)
    fs.writeFileSync(replacementPath, replacementContents)
    let appendDescriptorOpened = false
    let postOpenPathChecks = 0
    const openSync = vi.fn(
      (filePath: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null): number => {
        const descriptor = fs.openSync(filePath, flags, mode)
        if (typeof flags === 'number' && (flags & fs.constants.O_APPEND) !== 0) {
          appendDescriptorOpened = true
        }
        return descriptor
      }
    )
    const lstatSync = vi.fn((filePath: fs.PathLike, options?: { bigint?: boolean }) => {
      if (filePath === activePath && appendDescriptorOpened && ++postOpenPathChecks === 2) {
        return lstatWithOptions(replacementPath, options)
      }
      return lstatWithOptions(filePath, options)
    })
    const renameSync = vi.fn((oldPath: fs.PathLike, newPath: fs.PathLike) =>
      fs.renameSync(oldPath, newPath)
    )
    const { persistence } = createPersistence(userData, { lstatSync, openSync, renameSync })
    expect(persistence.enable()).toBe(true)

    expect(persistence.write('info', validLine())).toBe(false)
    expect(renameSync).not.toHaveBeenCalled()
    expect(fs.statSync(activePath).size).toBe(MAX_FILE_BYTES)
    expect(fs.readFileSync(replacementPath, 'utf8')).toBe(replacementContents)
  })

  it('disables persistence permanently after rotation or write failure', () => {
    const userData = createUserData()
    const activePath = path.join(userData, 'logs/main.jsonl')
    const archivePath = path.join(userData, 'logs/main.old.jsonl')
    const archiveContents = '{"seq":0}\n'
    fs.mkdirSync(path.dirname(activePath), { recursive: true })
    writeCompleteFileAtLimit(activePath)
    fs.writeFileSync(archivePath, archiveContents)
    const rotationFailure = createPersistence(userData, {
      renameSync: vi.fn(() => {
        throw Object.assign(new Error('rename failed'), { code: 'EACCES' })
      })
    }).persistence
    expect(rotationFailure.enable()).toBe(true)

    expect(rotationFailure.write('info', validLine())).toBe(false)
    expect(rotationFailure.enable()).toBe(false)
    expect(fs.statSync(activePath).size).toBe(MAX_FILE_BYTES)
    expect(fs.readFileSync(archivePath, 'utf8')).toBe(archiveContents)

    fs.rmSync(activePath)
    const writeFailure = createPersistence(userData, {
      writeSync: vi.fn(() => {
        throw Object.assign(new Error('write failed'), { code: 'EIO' })
      })
    }).persistence
    expect(writeFailure.enable()).toBe(true)
    expect(writeFailure.write('info', validLine())).toBe(false)
    expect(writeFailure.write('info', validLine(2))).toBe(false)
  })

  it('refuses symlinked log directories and active files', () => {
    const externalDirectory = createUserData()
    const linkedDirectoryProfile = createUserData()
    fs.symlinkSync(externalDirectory, path.join(linkedDirectoryProfile, 'logs'))
    const linkedDirectoryPersistence = createPersistence(linkedDirectoryProfile).persistence

    expect(linkedDirectoryPersistence.enable()).toBe(false)
    expect(fs.existsSync(path.join(externalDirectory, 'main.jsonl'))).toBe(false)

    const linkedFileProfile = createUserData()
    const linkedFileDirectory = path.join(linkedFileProfile, 'logs')
    const externalFile = path.join(externalDirectory, 'external.jsonl')
    const linkedFile = path.join(linkedFileDirectory, 'main.jsonl')
    fs.mkdirSync(linkedFileDirectory)
    fs.writeFileSync(externalFile, '{"safe":true}\n')
    fs.symlinkSync(externalFile, linkedFile)
    const linkedFilePersistence = createPersistence(linkedFileProfile).persistence

    expect(linkedFilePersistence.enable()).toBe(false)
    expect(fs.readFileSync(externalFile, 'utf8')).toBe('{"safe":true}\n')
  })

  it('rejects a file replaced by a symlink between validation and open', () => {
    const userData = createUserData()
    const externalDirectory = createUserData()
    const activePath = path.join(userData, 'logs/main.jsonl')
    const externalFile = path.join(externalDirectory, 'external.jsonl')
    const externalContents = '{"safe":true}\n'
    fs.mkdirSync(path.dirname(activePath), { recursive: true })
    fs.writeFileSync(externalFile, externalContents)
    const closeSync = vi.fn((descriptor: number) => fs.closeSync(descriptor))
    const openSync = vi.fn(
      (filePath: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null): number => {
        if (filePath === activePath) fs.symlinkSync(externalFile, activePath)
        return fs.openSync(filePath, flags, mode)
      }
    )
    const { persistence } = createPersistence(userData, {
      closeSync,
      constants: { ...fs.constants, O_NOFOLLOW: 0 },
      openSync
    })
    expect(persistence.enable()).toBe(true)

    expect(persistence.write('info', validLine())).toBe(false)
    expect(closeSync).toHaveBeenCalledOnce()
    expect(fs.readFileSync(externalFile, 'utf8')).toBe(externalContents)
  })

  it('rejects a regular file replaced after open before repairing its tail', () => {
    const userData = createUserData()
    const logDirectory = path.join(userData, 'logs')
    const activePath = path.join(logDirectory, 'main.jsonl')
    const replacementPath = path.join(logDirectory, 'replacement.jsonl')
    const originalContents = '{"seq":1}\n{"partial":true'
    const replacementContents = '{"replacement":true}\n'
    fs.mkdirSync(logDirectory, { recursive: true })
    fs.writeFileSync(activePath, originalContents)
    fs.writeFileSync(replacementPath, replacementContents)
    const closeSync = vi.fn((descriptor: number) => fs.closeSync(descriptor))
    const ftruncateSync = vi.fn((descriptor: number, length?: number) =>
      fs.ftruncateSync(descriptor, length)
    )
    let activePathChecks = 0
    const lstatSync = vi.fn((filePath: fs.PathLike, options?: { bigint?: boolean }) => {
      if (filePath === activePath && ++activePathChecks === 2) {
        return lstatWithOptions(replacementPath, options)
      }
      return lstatWithOptions(filePath, options)
    })
    const { persistence } = createPersistence(userData, {
      closeSync,
      ftruncateSync,
      lstatSync
    })

    expect(persistence.enable()).toBe(false)
    expect(closeSync).toHaveBeenCalledOnce()
    expect(ftruncateSync).not.toHaveBeenCalled()
    expect(fs.readFileSync(activePath, 'utf8')).toBe(originalContents)
    expect(fs.readFileSync(replacementPath, 'utf8')).toBe(replacementContents)
  })

  it('compares file identities without rounding distinct 64-bit inode values', () => {
    const userData = createUserData()
    const logDirectory = path.join(userData, 'logs')
    const activePath = path.join(logDirectory, 'main.jsonl')
    const originalContents = '{"safe":true}\n'
    const descriptorInode = 9_007_199_254_740_992n
    const pathInode = descriptorInode + 1n
    fs.mkdirSync(logDirectory, { recursive: true })
    fs.writeFileSync(activePath, originalContents)
    const fstatSync = vi.fn((descriptor: number, options?: { bigint?: boolean }) => {
      const stat = fstatWithOptions(descriptor, options)
      return new Proxy(stat, {
        get: (target, property, receiver) =>
          property === 'ino' ? descriptorInode : Reflect.get(target, property, receiver)
      })
    })
    const lstatSync = vi.fn((filePath: fs.PathLike, options?: { bigint?: boolean }) => {
      const stat = lstatWithOptions(filePath, options)
      if (filePath !== activePath || !options?.bigint) return stat
      return new Proxy(stat, {
        get: (target, property, receiver) =>
          property === 'ino' ? pathInode : Reflect.get(target, property, receiver)
      })
    })
    const { persistence } = createPersistence(userData, { fstatSync, lstatSync })

    expect(Number(descriptorInode)).toBe(Number(pathInode))
    expect(persistence.enable()).toBe(false)
    expect(fs.readFileSync(activePath, 'utf8')).toBe(originalContents)
  })

  it('rejects a log directory replaced by a symlink while opening the active file', () => {
    const userData = createUserData()
    const externalDirectory = createUserData()
    const logDirectory = path.join(userData, 'logs')
    const parkedDirectory = path.join(userData, 'original-logs')
    const activePath = path.join(logDirectory, 'main.jsonl')
    const externalFile = path.join(externalDirectory, 'main.jsonl')
    const externalContents = '{"safe":true}\n'
    fs.mkdirSync(logDirectory, { recursive: true })
    fs.writeFileSync(externalFile, externalContents)
    const closeSync = vi.fn((descriptor: number) => fs.closeSync(descriptor))
    const openSync = vi.fn(
      (filePath: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null): number => {
        if (filePath === activePath) {
          fs.renameSync(logDirectory, parkedDirectory)
          fs.symlinkSync(externalDirectory, logDirectory)
        }
        return fs.openSync(filePath, flags, mode)
      }
    )
    const { persistence } = createPersistence(userData, { closeSync, openSync })
    expect(persistence.enable()).toBe(true)

    expect(persistence.write('info', validLine())).toBe(false)
    expect(closeSync).toHaveBeenCalledOnce()
    expect(fs.readFileSync(externalFile, 'utf8')).toBe(externalContents)
  })

  it('rejects non-object JSON and physical newlines before dispatch', () => {
    const userData = createUserData()
    const { log, persistence } = createPersistence(userData)
    expect(persistence.enable()).toBe(true)

    expect(persistence.write('info', 'plain text')).toBe(false)
    expect(persistence.write('info', '[]')).toBe(false)
    expect(persistence.write('info', '{"v":1}\n{"v":2}')).toBe(false)
    expect(log.processMessage).not.toHaveBeenCalled()
  })

  it('rejects fields outside the selected event schema', () => {
    const userData = createUserData()
    const { log, persistence } = createPersistence(userData)
    expect(persistence.enable()).toBe(true)

    const contextPayload = JSON.parse(validLine())
    contextPayload.context.prompt = 'SECRET_PROMPT'
    expect(persistence.write('info', JSON.stringify(contextPayload))).toBe(false)

    const envelopePayload = JSON.parse(validLine())
    envelopePayload.toolResponse = 'SECRET_TOOL_RESPONSE'
    expect(persistence.write('info', JSON.stringify(envelopePayload))).toBe(false)
    expect(log.processMessage).not.toHaveBeenCalled()
  })

  it('accepts only the category-only projected shape for fatal events', () => {
    const userData = createUserData()
    const { persistence } = createPersistence(userData)
    expect(persistence.enable()).toBe(true)
    const fatalRecord = JSON.parse(validLine())
    fatalRecord.level = 'error'
    fatalRecord.event = 'process.uncaught_exception'
    fatalRecord.context = {
      error: {
        category: 'unknown'
      }
    }

    expect(persistence.write('error', JSON.stringify(fatalRecord))).toBe(true)
    fatalRecord.context.error.stack = ['at explode (<app>/src/main/example.ts:10:2)']
    expect(persistence.write('error', JSON.stringify(fatalRecord))).toBe(false)
  })
})
