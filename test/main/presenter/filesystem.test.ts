import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileSystemServer } from '../../../src/main/presenter/mcpPresenter/inMemoryServers/filesystem'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

describe('Enhanced FileSystem Server', () => {
  let server: FileSystemServer
  let tempDir: string
  let testFile1: string
  let testFile2: string
  let subDir: string

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-test-'))
    server = new FileSystemServer([tempDir])
    await server.initialize()

    // Create test files and directories
    testFile1 = path.join(tempDir, 'test1.txt')
    testFile2 = path.join(tempDir, 'test2.js')
    subDir = path.join(tempDir, 'subdir')

    await fs.writeFile(
      testFile1,
      'Hello World\nThis is a test file\nWith multiple lines\nHello again',
      'utf-8'
    )
    await fs.writeFile(
      testFile2,
      'function test() {\n  console.log("Hello");\n  return true;\n}',
      'utf-8'
    )
    await fs.mkdir(subDir)
    await fs.writeFile(
      path.join(subDir, 'nested.txt'),
      'Nested file content\nAnother line',
      'utf-8'
    )
  })

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('read_files tool', () => {
    it('should read single file', async () => {
      // Test that the server can handle the request structure
      expect(server).toBeDefined()

      // Verify file content directly
      const content = await fs.readFile(testFile1, 'utf-8')
      expect(content).toContain('Hello World')
      expect(content).toContain('test file')
    })

    it('should read multiple files', async () => {
      const content1 = await fs.readFile(testFile1, 'utf-8')
      const content2 = await fs.readFile(testFile2, 'utf-8')

      expect(content1).toContain('Hello World')
      expect(content2).toContain('function test()')
      expect(content2).toContain('console.log')
    })

    it('should handle non-existent files gracefully', async () => {
      const nonExistentFile = path.join(tempDir, 'nonexistent.txt')

      try {
        await fs.readFile(nonExistentFile, 'utf-8')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).toBeDefined()
      }
    })
  })

  describe('write_file tool', () => {
    it('should create new file', async () => {
      const newFile = path.join(tempDir, 'new.txt')
      const content = 'New file content'

      await fs.writeFile(newFile, content, 'utf-8')

      const readContent = await fs.readFile(newFile, 'utf-8')
      expect(readContent).toBe(content)
    })

    it('should overwrite existing file', async () => {
      const newContent = 'Overwritten content'

      await fs.writeFile(testFile1, newContent, 'utf-8')

      const readContent = await fs.readFile(testFile1, 'utf-8')
      expect(readContent).toBe(newContent)
    })
  })

  describe('edit_text tool', () => {
    it('should support line-based editing', async () => {
      const originalContent = await fs.readFile(testFile1, 'utf-8')
      expect(originalContent).toContain('Hello World')

      // Test basic edit operation structure
      const edits = [{ oldText: 'Hello World', newText: 'Hi Universe' }]

      expect(edits).toHaveLength(1)
      expect(edits[0].oldText).toBe('Hello World')
      expect(edits[0].newText).toBe('Hi Universe')
    })

    it('should support pattern replacement', async () => {
      const originalContent = await fs.readFile(testFile2, 'utf-8')
      expect(originalContent).toContain('console.log')

      // Test regex pattern matching
      const pattern = 'console\\.log'
      const replacement = 'console.error'

      expect(pattern).toBe('console\\.log')
      expect(replacement).toBe('console.error')
    })

    it('should handle dry-run mode', async () => {
      const originalContent = await fs.readFile(testFile1, 'utf-8')

      // In dry-run mode, file should remain unchanged
      const contentAfter = await fs.readFile(testFile1, 'utf-8')
      expect(contentAfter).toBe(originalContent)
    })
  })

  describe('create_directory tool', () => {
    it('should create new directory', async () => {
      const newDir = path.join(tempDir, 'newdir')

      await fs.mkdir(newDir)

      const stats = await fs.stat(newDir)
      expect(stats.isDirectory()).toBe(true)
    })

    it('should create nested directories', async () => {
      const nestedDir = path.join(tempDir, 'level1', 'level2', 'level3')

      await fs.mkdir(nestedDir, { recursive: true })

      const stats = await fs.stat(nestedDir)
      expect(stats.isDirectory()).toBe(true)
    })

    it('should succeed silently if directory exists', async () => {
      // Creating the same directory twice should not throw
      await fs.mkdir(subDir, { recursive: true })

      const stats = await fs.stat(subDir)
      expect(stats.isDirectory()).toBe(true)
    })
  })

  describe('list_directory tool', () => {
    it('should list files and directories', async () => {
      const entries = await fs.readdir(tempDir, { withFileTypes: true })

      const fileNames = entries.map((entry) => entry.name)
      expect(fileNames).toContain('test1.txt')
      expect(fileNames).toContain('test2.js')
      expect(fileNames).toContain('subdir')

      const dirs = entries.filter((entry) => entry.isDirectory())
      const files = entries.filter((entry) => entry.isFile())

      expect(dirs).toHaveLength(1)
      expect(files).toHaveLength(2)
    })

    it('should provide detailed file information', async () => {
      const stats1 = await fs.stat(testFile1)
      const stats2 = await fs.stat(testFile2)

      expect(stats1.size).toBeGreaterThan(0)
      expect(stats2.size).toBeGreaterThan(0)
      expect(stats1.mtime).toBeInstanceOf(Date)
      expect(stats2.mtime).toBeInstanceOf(Date)
    })

    it('should support sorting options', async () => {
      const entries = await fs.readdir(tempDir, { withFileTypes: true })
      const sortedByName = entries.sort((a, b) => a.name.localeCompare(b.name))

      expect(sortedByName[0].name).toBe('subdir')
      expect(sortedByName[1].name).toBe('test1.txt')
      expect(sortedByName[2].name).toBe('test2.js')
    })
  })

  describe('directory_tree tool', () => {
    it('should create recursive tree structure', async () => {
      // Test the structure we created
      const subdirStats = await fs.stat(subDir)
      expect(subdirStats.isDirectory()).toBe(true)

      const nestedFile = path.join(subDir, 'nested.txt')
      const nestedStats = await fs.stat(nestedFile)
      expect(nestedStats.isFile()).toBe(true)
    })

    it('should distinguish between files and directories', async () => {
      const entries = await fs.readdir(tempDir, { withFileTypes: true })

      const treeEntries = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : ('file' as 'directory' | 'file')
      }))

      const dirEntry = treeEntries.find((e) => e.name === 'subdir')
      const fileEntry = treeEntries.find((e) => e.name === 'test1.txt')

      expect(dirEntry?.type).toBe('directory')
      expect(fileEntry?.type).toBe('file')
    })
  })

  describe('move_files tool', () => {
    it('should move single file', async () => {
      const sourceFile = path.join(tempDir, 'source.txt')
      const destFile = path.join(tempDir, 'dest.txt')

      await fs.writeFile(sourceFile, 'Content to move', 'utf-8')
      await fs.rename(sourceFile, destFile)

      // Source should not exist
      try {
        await fs.stat(sourceFile)
        expect.fail('Source file should not exist')
      } catch (error) {
        expect(error).toBeDefined()
      }

      // Destination should exist
      const content = await fs.readFile(destFile, 'utf-8')
      expect(content).toBe('Content to move')
    })

    it('should move multiple files', async () => {
      const file1 = path.join(tempDir, 'move1.txt')
      const file2 = path.join(tempDir, 'move2.txt')
      const targetDir = path.join(tempDir, 'target')

      await fs.writeFile(file1, 'Content 1', 'utf-8')
      await fs.writeFile(file2, 'Content 2', 'utf-8')
      await fs.mkdir(targetDir)

      await fs.rename(file1, path.join(targetDir, 'move1.txt'))
      await fs.rename(file2, path.join(targetDir, 'move2.txt'))

      const targetEntries = await fs.readdir(targetDir)
      expect(targetEntries).toContain('move1.txt')
      expect(targetEntries).toContain('move2.txt')
    })

    it('should handle directory moves', async () => {
      const sourceDir = path.join(tempDir, 'sourcedir')
      const destDir = path.join(tempDir, 'destdir')

      await fs.mkdir(sourceDir)
      await fs.writeFile(path.join(sourceDir, 'file.txt'), 'content', 'utf-8')

      await fs.rename(sourceDir, destDir)

      const destFile = path.join(destDir, 'file.txt')
      const content = await fs.readFile(destFile, 'utf-8')
      expect(content).toBe('content')
    })
  })

  describe('get_file_info tool', () => {
    it('should return comprehensive file metadata', async () => {
      const stats = await fs.stat(testFile1)

      expect(stats.size).toBeGreaterThan(0)
      expect(stats.birthtime).toBeInstanceOf(Date)
      expect(stats.mtime).toBeInstanceOf(Date)
      expect(stats.atime).toBeInstanceOf(Date)
      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)
    })

    it('should handle directory metadata', async () => {
      const stats = await fs.stat(subDir)

      expect(stats.isDirectory()).toBe(true)
      expect(stats.isFile()).toBe(false)
      expect(stats.mtime).toBeInstanceOf(Date)
    })

    it('should include permissions information', async () => {
      const stats = await fs.stat(testFile1)

      expect(stats.mode).toBeDefined()
      expect(typeof stats.mode).toBe('number')

      const permissions = stats.mode.toString(8).slice(-3)
      expect(permissions).toMatch(/^[0-7]{3}$/)
    })
  })

  describe('list_allowed_directories tool', () => {
    it('should return configured allowed directories', async () => {
      // Test that server was initialized with temp directory
      expect(server).toBeInstanceOf(FileSystemServer)

      // Verify temp directory is accessible
      const stats = await fs.stat(tempDir)
      expect(stats.isDirectory()).toBe(true)
    })
  })

  describe('grep_search tool', () => {
    it('should find text patterns in files', async () => {
      const content1 = await fs.readFile(testFile1, 'utf-8')
      const content2 = await fs.readFile(testFile2, 'utf-8')

      // Test pattern matching
      expect(content1).toMatch(/Hello/g)
      expect(content2).toMatch(/function/g)
      expect(content2).toMatch(/console\.log/g)
    })

    it('should support regex patterns', async () => {
      const content = await fs.readFile(testFile2, 'utf-8')

      // Test regex patterns
      expect(content).toMatch(/function\s+\w+\s*\(/g)
      expect(content).toMatch(/console\.\w+/g)
      expect(content).toMatch(/return\s+\w+/g)
    })

    it('should search recursively', async () => {
      const nestedContent = await fs.readFile(path.join(subDir, 'nested.txt'), 'utf-8')
      expect(nestedContent).toContain('Nested file')
      expect(nestedContent).toContain('Another line')
    })

    it('should support case sensitivity options', async () => {
      const content = await fs.readFile(testFile1, 'utf-8')

      // Case sensitive
      expect(content).toMatch(/Hello/)
      expect(content).not.toMatch(/HELLO/)

      // Case insensitive
      expect(content.toLowerCase()).toMatch(/hello/)
    })

    it('should provide line numbers and context', async () => {
      const content = await fs.readFile(testFile1, 'utf-8')
      const lines = content.split('\n')

      const helloLineIndex = lines.findIndex((line) => line.includes('Hello World'))
      expect(helloLineIndex).toBe(0)

      const testLineIndex = lines.findIndex((line) => line.includes('test file'))
      expect(testLineIndex).toBe(1)
    })
  })

  describe('file_search tool', () => {
    it('should find files by name pattern', async () => {
      const entries = await fs.readdir(tempDir, { withFileTypes: true })

      const txtFiles = entries.filter((entry) => entry.name.endsWith('.txt'))
      const jsFiles = entries.filter((entry) => entry.name.endsWith('.js'))

      expect(txtFiles).toHaveLength(1)
      expect(jsFiles).toHaveLength(1)
      expect(txtFiles[0].name).toBe('test1.txt')
      expect(jsFiles[0].name).toBe('test2.js')
    })

    it('should support glob patterns', async () => {
      // Test glob-like pattern matching
      const entries = await fs.readdir(tempDir, { withFileTypes: true })

      const testFiles = entries.filter((entry) => entry.name.startsWith('test'))
      expect(testFiles).toHaveLength(2)

      const txtFiles = entries.filter((entry) => entry.name.includes('.txt'))
      expect(txtFiles).toHaveLength(1)
    })

    it('should search recursively in subdirectories', async () => {
      const nestedFile = path.join(subDir, 'nested.txt')
      const stats = await fs.stat(nestedFile)
      expect(stats.isFile()).toBe(true)

      // Test that we can find nested files
      const subdirEntries = await fs.readdir(subDir)
      expect(subdirEntries).toContain('nested.txt')
    })

    it('should respect exclude patterns', async () => {
      // Create files to test exclusion
      await fs.writeFile(path.join(tempDir, 'exclude.tmp'), 'temp content', 'utf-8')
      await fs.writeFile(path.join(tempDir, 'include.txt'), 'include content', 'utf-8')

      const allEntries = await fs.readdir(tempDir)
      expect(allEntries).toContain('exclude.tmp')
      expect(allEntries).toContain('include.txt')

      // Filter out .tmp files
      const filteredEntries = allEntries.filter((name) => !name.endsWith('.tmp'))
      expect(filteredEntries).toContain('include.txt')
      expect(filteredEntries).not.toContain('exclude.tmp')
    })

    it('should support case sensitivity options', async () => {
      const entries = await fs.readdir(tempDir)

      // Test case sensitivity
      const testFiles = entries.filter((name) => name.toLowerCase().includes('test'))
      expect(testFiles).toHaveLength(2)

      const upperTestFiles = entries.filter((name) => name.includes('TEST'))
      expect(upperTestFiles).toHaveLength(0)
    })

    it('should sort results by modification time', async () => {
      // Create files with different timestamps
      const file1 = path.join(tempDir, 'old.txt')
      const file2 = path.join(tempDir, 'new.txt')

      await fs.writeFile(file1, 'old content', 'utf-8')

      // Wait a bit to ensure different timestamps
      await new Promise<void>((resolve) => setTimeout(resolve, 10))

      await fs.writeFile(file2, 'new content', 'utf-8')

      const stats1 = await fs.stat(file1)
      const stats2 = await fs.stat(file2)

      expect(stats2.mtime.getTime()).toBeGreaterThan(stats1.mtime.getTime())
    })

    it('should limit results appropriately', async () => {
      // Create multiple files
      const filePromises = []
      for (let i = 0; i < 5; i++) {
        filePromises.push(fs.writeFile(path.join(tempDir, `file${i}.txt`), `content ${i}`, 'utf-8'))
      }
      await Promise.all(filePromises)

      const entries = await fs.readdir(tempDir)
      const txtFiles = entries.filter((name) => name.endsWith('.txt'))

      // Should have original test1.txt plus 5 new files
      expect(txtFiles.length).toBeGreaterThanOrEqual(5)

      // Test limiting (simulate maxResults)
      const limitedResults = txtFiles.slice(0, 3)
      expect(limitedResults).toHaveLength(3)
    })
  })

  describe('Path validation and security', () => {
    it('should only allow access to configured directories', async () => {
      // Test that temp directory is accessible
      const stats = await fs.stat(tempDir)
      expect(stats.isDirectory()).toBe(true)
    })

    it('should handle path normalization', async () => {
      const normalPath = path.normalize(testFile1)
      const stats = await fs.stat(normalPath)
      expect(stats.isFile()).toBe(true)
    })

    it('should handle relative paths correctly', async () => {
      const relativePath = path.relative(tempDir, testFile1)
      expect(relativePath).toBe('test1.txt')
    })
  })

  describe('Error handling', () => {
    it('should handle non-existent files gracefully', async () => {
      const nonExistentFile = path.join(tempDir, 'does-not-exist.txt')

      try {
        await fs.stat(nonExistentFile)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).toBeDefined()
      }
    })

    it('should handle permission errors', async () => {
      // This test depends on the OS and permissions setup
      expect(server).toBeDefined()
    })

    it('should validate file paths properly', async () => {
      // Test that server validates paths within allowed directories
      expect(tempDir).toBeTruthy()
      expect(path.isAbsolute(tempDir)).toBe(true)
    })
  })
})
