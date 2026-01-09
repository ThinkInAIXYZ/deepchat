import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { AgentFileSystemHandler } from '@/presenter/agentPresenter/acp'

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
})
