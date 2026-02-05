import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { AgentFileSystemHandler } from '@/presenter/agentPresenter/tools/fileSystemHandler'

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
})
