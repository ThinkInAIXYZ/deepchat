import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { getSessionsRoot } from '@/agent/shared/storage/sessionPaths'
import { AgentFileSystemHandler } from '@/tool/agentTools/agentFileSystemHandler'

describe('AgentFileSystemHandler diff responses', () => {
  let testDir: string
  let handler: AgentFileSystemHandler

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-fs-test-'))
    handler = new AgentFileSystemHandler([testDir])
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('returns structured diff for editText', async () => {
    const filePath = path.join(testDir, 'edit.ts')
    const content = Array.from({ length: 12 }, (_, index) => `line${index + 1}`).join('\n')
    await fs.writeFile(filePath, content, 'utf-8')

    const responseText = await handler.editText({
      path: filePath,
      operation: 'edit_lines',
      edits: [{ oldText: 'line6', newText: 'line6-mod' }]
    })

    const response = JSON.parse(responseText) as {
      success: boolean
      originalCode: string
      updatedCode: string
      language: string
    }

    expect(response.success).toBe(true)
    expect(response.originalCode).toContain('line6')
    expect(response.updatedCode).toContain('line6-mod')
    expect(response.originalCode).toContain('... [No changes:')
    expect(response.language).toBe('typescript')

    const updatedContent = await fs.readFile(filePath, 'utf-8')
    expect(updatedContent).toContain('line6-mod')
  })

  it('returns structured diff for textReplace with replacements', async () => {
    const filePath = path.join(testDir, 'replace.js')
    await fs.writeFile(filePath, 'alpha\nbeta\nalpha\ndelta', 'utf-8')

    const responseText = await handler.textReplace({
      path: filePath,
      pattern: 'alpha',
      replacement: 'gamma',
      global: true,
      caseSensitive: true,
      dryRun: true
    })

    const response = JSON.parse(responseText) as {
      success: boolean
      originalCode: string
      updatedCode: string
      replacements: number
      language: string
    }

    expect(response.success).toBe(true)
    expect(response.replacements).toBe(2)
    expect(response.originalCode).toContain('alpha')
    expect(response.updatedCode).toContain('gamma')
    expect(response.language).toBe('javascript')
  })

  it('returns plain error text for textReplace failures', async () => {
    const filePath = path.join(testDir, 'invalid.txt')
    await fs.writeFile(filePath, 'alpha', 'utf-8')

    const responseText = await handler.textReplace({
      path: filePath,
      pattern: '(',
      replacement: 'x'
    })

    expect(responseText.length).toBeGreaterThan(0)
    expect(() => JSON.parse(responseText)).toThrow()
  })

  it('limits directoryTree depth based on depth option', async () => {
    await fs.mkdir(path.join(testDir, 'level1', 'level2', 'level3'), { recursive: true })
    await fs.writeFile(path.join(testDir, 'root.txt'), 'root', 'utf-8')
    await fs.writeFile(path.join(testDir, 'level1', 'file1.txt'), 'file1', 'utf-8')
    await fs.writeFile(path.join(testDir, 'level1', 'level2', 'file2.txt'), 'file2', 'utf-8')
    await fs.writeFile(
      path.join(testDir, 'level1', 'level2', 'level3', 'file3.txt'),
      'file3',
      'utf-8'
    )

    const depthZero = JSON.parse(
      await handler.directoryTree({ path: testDir, depth: 0 })
    ) as Array<{ name: string; type: string; children?: unknown }>
    const level1AtZero = depthZero.find((entry) => entry.name === 'level1')
    expect(level1AtZero).toBeDefined()
    expect(level1AtZero?.children).toBeUndefined()

    const depthOne = JSON.parse(await handler.directoryTree({ path: testDir, depth: 1 })) as Array<{
      name: string
      type: string
      children?: any[]
    }>
    const level1AtOne = depthOne.find((entry) => entry.name === 'level1')
    expect(level1AtOne?.children?.some((child) => child.name === 'file1.txt')).toBe(true)
    const level2AtOne = level1AtOne?.children?.find((child) => child.name === 'level2')
    expect(level2AtOne?.children).toBeUndefined()

    const depthTwo = JSON.parse(await handler.directoryTree({ path: testDir, depth: 2 })) as Array<{
      name: string
      type: string
      children?: any[]
    }>
    const level1AtTwo = depthTwo.find((entry) => entry.name === 'level1')
    const level2AtTwo = level1AtTwo?.children?.find((child) => child.name === 'level2')
    expect(level2AtTwo?.children?.some((child) => child.name === 'file2.txt')).toBe(true)
    const level3AtTwo = level2AtTwo?.children?.find((child) => child.name === 'level3')
    expect(level3AtTwo?.children).toBeUndefined()
  })

  it('rejects directoryTree depth above max', async () => {
    await expect(handler.directoryTree({ path: testDir, depth: 4 })).rejects.toThrow()
  })

  it('normalizes line endings when matching oldText in editFile', async () => {
    const filePath = path.join(testDir, 'crlf.txt')
    await fs.writeFile(filePath, 'line1\r\nline2\r\n', 'utf-8')

    const responseText = await handler.editFile({
      path: filePath,
      oldText: 'line1\nline2\n',
      newText: 'line1\nline2-updated\n'
    })

    const response = JSON.parse(responseText) as {
      success: boolean
      replacements: number
      updatedCode: string
    }

    expect(response.success).toBe(true)
    expect(response.replacements).toBe(1)
    expect(response.updatedCode).toContain('line2-updated')

    const updatedContent = await fs.readFile(filePath, 'utf-8')
    expect(updatedContent).toContain('line2-updated')
  })
})

describe('AgentFileSystemHandler path authorization', () => {
  it('normalizes MSYS paths before case-insensitive Windows containment checks', () => {
    const handler = new AgentFileSystemHandler(['C:/Users/Me/Project'], {
      commandShellPathStyle: 'msys'
    })

    const resolved = handler.resolvePath('/c/users/me/project/src/file.ts')

    expect(resolved).toBe('C:\\users\\me\\project\\src\\file.ts')
    expect(handler.isPathAllowedAbsolute(resolved)).toBe(true)
  })

  it.each([
    ['/c/Users/Me/Project/../../Windows/system.ini', 'C:\\Users\\Windows\\system.ini'],
    ['/c/Users/Me/Outside/file.ts', 'C:\\Users\\Me\\Outside\\file.ts'],
    ['/c/Users/Me/Project-sibling/file.ts', 'C:\\Users\\Me\\Project-sibling\\file.ts']
  ])('rejects MSYS paths outside the allowed root: %s', (requestedPath, expectedResolved) => {
    const handler = new AgentFileSystemHandler(['C:\\Users\\Me\\Project'], {
      commandShellPathStyle: 'msys'
    })

    const resolved = handler.resolvePath(requestedPath)

    expect(resolved).toBe(expectedResolved)
    expect(handler.isPathAllowedAbsolute(resolved)).toBe(false)
  })

  it('rejects an MSYS traversal through the write authorization entry point', async () => {
    const handler = new AgentFileSystemHandler(['C:\\Allowed'], {
      commandShellPathStyle: 'msys'
    })

    await expect(
      handler.writeFile({ path: '/c/Allowed/../../outside.txt', content: 'blocked' })
    ).rejects.toThrow('Access denied - path outside allowed directories')
  })

  it('handles Windows drive and UNC root boundaries without prefix leakage', () => {
    const driveHandler = new AgentFileSystemHandler(['C:\\'], {
      commandShellPathStyle: 'msys'
    })
    const uncHandler = new AgentFileSystemHandler(['\\\\server\\share\\Project'], {
      commandShellPathStyle: 'msys'
    })

    expect(driveHandler.isPathAllowedAbsolute('C:\\Users\\Me\\file.ts')).toBe(true)
    expect(driveHandler.isPathAllowedAbsolute('D:\\Users\\Me\\file.ts')).toBe(false)
    expect(uncHandler.isPathAllowedAbsolute('\\\\SERVER\\SHARE\\project\\file.ts')).toBe(true)
    expect(uncHandler.isPathAllowedAbsolute('\\\\server\\share\\Project-other\\file.ts')).toBe(
      false
    )
  })

  it('keeps session reads scoped to the current conversation across Windows casing', () => {
    const conversationId = 'current-conversation'
    const handler = new AgentFileSystemHandler(['C:\\'], {
      commandShellPathStyle: 'msys',
      conversationId
    })
    const sessionsRoot = path.win32.normalize(getSessionsRoot()).toUpperCase()
    const currentFile = path.win32.join(sessionsRoot, conversationId.toUpperCase(), 'data.json')
    const otherFile = path.win32.join(sessionsRoot, 'OTHER-CONVERSATION', 'data.json')

    expect(() => handler.assertReadAllowedAbsolute(currentFile)).not.toThrow()
    expect(() => handler.assertReadAllowedAbsolute(otherFile)).toThrow(
      'Access denied - session files outside current conversation'
    )
  })

  it('preserves protected shared Skill packages across Windows casing', () => {
    const handler = new AgentFileSystemHandler(['C:\\'], {
      commandShellPathStyle: 'msys',
      protectedDirectoryRules: [
        {
          root: 'C:\\Skills',
          allowedDirectories: ['C:\\Skills\\active']
        }
      ]
    })

    expect(handler.isPathAllowedAbsolute('c:\\SKILLS\\active\\file.ts')).toBe(true)
    expect(handler.isPathAllowedAbsolute('c:\\SKILLS\\inactive\\file.ts')).toBe(false)
  })

  it.runIf(process.platform !== 'win32')('preserves case-sensitive POSIX containment', () => {
    const handler = new AgentFileSystemHandler(['/workspace/Project'])

    expect(handler.isPathAllowedAbsolute('/workspace/Project/src/file.ts')).toBe(true)
    expect(handler.isPathAllowedAbsolute('/workspace/project/src/file.ts')).toBe(false)
  })

  it('allows create targets below missing directories inside the allowed root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-fs-create-'))
    try {
      const handler = new AgentFileSystemHandler([root])
      const target = path.join(root, 'new', 'nested', 'file.ts')

      await expect(handler.resolveValidatedCreatePath(target)).resolves.toBe(target)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')(
    'rejects create targets whose existing ancestor escapes through a symlink',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-fs-create-root-'))
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-fs-create-outside-'))
      try {
        await fs.symlink(outside, path.join(root, 'linked'))
        const handler = new AgentFileSystemHandler([root])

        await expect(
          handler.resolveValidatedCreatePath(path.join(root, 'linked', 'nested', 'file.ts'))
        ).rejects.toThrow('Access denied - symlink target outside allowed directories')
      } finally {
        await fs.rm(root, { recursive: true, force: true })
        await fs.rm(outside, { recursive: true, force: true })
      }
    }
  )
})
