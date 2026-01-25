import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { AcpFsHandler } from '@/presenter/acpPresenter/handlers/fsHandler'

describe('AcpFsHandler', () => {
  let testDir: string
  let handler: AcpFsHandler

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-fs-test-'))
    handler = new AcpFsHandler({ workspaceRoot: testDir })
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('validatePath', () => {
    it('allows paths within workspace', async () => {
      const testFile = path.join(testDir, 'test.txt')
      await fs.writeFile(testFile, 'hello')

      const result = await handler.readTextFile({
        path: testFile,
        sessionId: 'test-session'
      })

      expect(result.content).toBe('hello')
    })

    it('rejects paths escaping workspace with ..', async () => {
      const escapePath = path.join(testDir, '..', 'outside.txt')

      await expect(
        handler.readTextFile({
          path: escapePath,
          sessionId: 'test-session'
        })
      ).rejects.toThrow(/Path escapes workspace/)
    })

    it('allows any path when workspaceRoot is null', async () => {
      const unrestrictedHandler = new AcpFsHandler({ workspaceRoot: null })

      // Create a file outside the typical workspace
      const outsideFile = path.join(os.tmpdir(), `acp-test-unrestricted-${Date.now()}.txt`)
      await fs.writeFile(outsideFile, 'unrestricted')

      try {
        const result = await unrestrictedHandler.readTextFile({
          path: outsideFile,
          sessionId: 'test-session'
        })
        expect(result.content).toBe('unrestricted')
      } finally {
        await fs.unlink(outsideFile).catch(() => {})
      }
    })
  })

  describe('readTextFile', () => {
    it('reads entire file when no line/limit specified', async () => {
      const testFile = path.join(testDir, 'multi-line.txt')
      await fs.writeFile(testFile, 'line1\nline2\nline3')

      const result = await handler.readTextFile({
        path: testFile,
        sessionId: 'test-session'
      })

      expect(result.content).toBe('line1\nline2\nline3')
    })

    it('respects line offset (1-based)', async () => {
      const testFile = path.join(testDir, 'multi-line.txt')
      await fs.writeFile(testFile, 'line1\nline2\nline3\nline4')

      const result = await handler.readTextFile({
        path: testFile,
        sessionId: 'test-session',
        line: 2
      })

      expect(result.content).toBe('line2\nline3\nline4')
    })

    it('respects limit parameter', async () => {
      const testFile = path.join(testDir, 'multi-line.txt')
      await fs.writeFile(testFile, 'line1\nline2\nline3\nline4')

      const result = await handler.readTextFile({
        path: testFile,
        sessionId: 'test-session',
        limit: 2
      })

      expect(result.content).toBe('line1\nline2')
    })

    it('respects both line and limit parameters', async () => {
      const testFile = path.join(testDir, 'multi-line.txt')
      await fs.writeFile(testFile, 'line1\nline2\nline3\nline4\nline5')

      const result = await handler.readTextFile({
        path: testFile,
        sessionId: 'test-session',
        line: 2,
        limit: 2
      })

      expect(result.content).toBe('line2\nline3')
    })

    it('throws resourceNotFound for missing files', async () => {
      await expect(
        handler.readTextFile({
          path: path.join(testDir, 'nonexistent.txt'),
          sessionId: 'test-session'
        })
      ).rejects.toThrow()
    })

    it('throws invalidParams for files exceeding maxReadSize', async () => {
      const smallHandler = new AcpFsHandler({
        workspaceRoot: testDir,
        maxReadSize: 10
      })

      const testFile = path.join(testDir, 'large.txt')
      await fs.writeFile(testFile, 'this is more than 10 bytes')

      await expect(
        smallHandler.readTextFile({
          path: testFile,
          sessionId: 'test-session'
        })
      ).rejects.toThrow(/File too large/)
    })
  })

  describe('writeTextFile', () => {
    it('writes content to new file', async () => {
      const testFile = path.join(testDir, 'new-file.txt')

      await handler.writeTextFile({
        path: testFile,
        content: 'new content',
        sessionId: 'test-session'
      })

      const written = await fs.readFile(testFile, 'utf-8')
      expect(written).toBe('new content')
    })

    it('overwrites existing file', async () => {
      const testFile = path.join(testDir, 'existing.txt')
      await fs.writeFile(testFile, 'old content')

      await handler.writeTextFile({
        path: testFile,
        content: 'new content',
        sessionId: 'test-session'
      })

      const written = await fs.readFile(testFile, 'utf-8')
      expect(written).toBe('new content')
    })

    it('creates parent directories if missing', async () => {
      const testFile = path.join(testDir, 'nested', 'dir', 'file.txt')

      await handler.writeTextFile({
        path: testFile,
        content: 'nested content',
        sessionId: 'test-session'
      })

      const written = await fs.readFile(testFile, 'utf-8')
      expect(written).toBe('nested content')
    })

    it('validates path before writing', async () => {
      const escapePath = path.join(testDir, '..', 'escape.txt')

      await expect(
        handler.writeTextFile({
          path: escapePath,
          content: 'should not write',
          sessionId: 'test-session'
        })
      ).rejects.toThrow(/Path escapes workspace/)
    })
  })
})
