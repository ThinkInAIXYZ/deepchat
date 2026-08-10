import electronLog from 'electron-log'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElectronMainLogPersistence } from '@/logging/electronMainLogPersistence'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const temporaryDirectories: string[] = []
const MAX_FILE_BYTES = 10 * 1024 * 1024

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createUserData(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-main-log-'))
  temporaryDirectories.push(directory)
  return directory
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
    expect(persistence.enable()).toBe(true)
    expect(persistence.write('info', validLine())).toBe(true)

    expect(electronLog.transports.file.level).toBe(false)
    expect(electronLog.transports.console.level).toBe(originalConsoleLevel)
    expect(fs.readFileSync(path.join(userData, 'logs/main.jsonl'), 'utf8')).toBe(`${validLine()}\n`)
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

  it('disables persistence permanently after rotation or write failure', () => {
    const userData = createUserData()
    const activePath = path.join(userData, 'logs/main.jsonl')
    fs.mkdirSync(path.dirname(activePath), { recursive: true })
    writeCompleteFileAtLimit(activePath)
    const rotationFailure = createPersistence(userData, {
      renameSync: vi.fn(() => {
        throw Object.assign(new Error('rename failed'), { code: 'EACCES' })
      })
    }).persistence
    expect(rotationFailure.enable()).toBe(true)

    expect(rotationFailure.write('info', validLine())).toBe(false)
    expect(rotationFailure.enable()).toBe(false)
    expect(fs.statSync(activePath).size).toBe(MAX_FILE_BYTES)

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

  it('accepts only the bounded projected shape for fatal events', () => {
    const userData = createUserData()
    const { persistence } = createPersistence(userData)
    expect(persistence.enable()).toBe(true)
    const fatalRecord = JSON.parse(validLine())
    fatalRecord.level = 'error'
    fatalRecord.event = 'process.uncaught_exception'
    fatalRecord.context = {
      error: {
        category: 'unknown',
        stack: ['at explode (<app>/src/main/example.ts:10:2)']
      }
    }

    expect(persistence.write('error', JSON.stringify(fatalRecord))).toBe(true)
    fatalRecord.context.error.message = 'SECRET_ERROR_MESSAGE'
    expect(persistence.write('error', JSON.stringify(fatalRecord))).toBe(false)
  })
})
