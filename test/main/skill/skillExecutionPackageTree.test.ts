import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupOwnedSkillExecutionPackageTree,
  materializeSkillExecutionPackageTree,
  type OwnedSkillExecutionPackageTree
} from '@/skill/skillExecutionPackageTree'
import { createTapeSkillMaterializationPayload } from '@/tape/domain/skillMaterialization'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { __esModule: true, ...actual, default: actual }
})

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return { __esModule: true, ...actual, default: actual }
})

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function executionPackage() {
  const project = Buffer.from('[project]\nname = "fixture"\n')
  const script = Buffer.from('from pathlib import Path\nprint(Path(__file__).read_text())\n')
  const support = Buffer.from('runtime support')
  return createTapeSkillMaterializationPayload({
    sessionId: 'session-1',
    expectedTapeIncarnationId: 'incarnation-1',
    agentId: 'agent-1',
    sourceType: 'builtin',
    sourceId: 'source-1',
    skillName: 'fixture',
    effectiveContent: 'Fixture instructions',
    builderVersion: 'builder-1',
    renderedManifestHash: sha256(Buffer.from('manifest')),
    scriptInventoryHash: sha256(Buffer.from('inventory')),
    executionPackage: {
      files: [
        {
          relativePath: 'pyproject.toml',
          base64: project.toString('base64'),
          byteCount: project.byteLength,
          sha256: sha256(project)
        },
        {
          relativePath: 'references/runtime.txt',
          base64: support.toString('base64'),
          byteCount: support.byteLength,
          sha256: sha256(support)
        },
        {
          relativePath: 'scripts/run.py',
          base64: script.toString('base64'),
          byteCount: script.byteLength,
          sha256: sha256(script)
        }
      ],
      executables: [{ relativePath: 'scripts/run.py', runtime: 'python', enabled: true }],
      runtimePolicy: { python: 'auto', node: 'auto' },
      environmentBindingId: null
    }
  }).executionPackage
}

describe('Skill execution package tree', () => {
  const pendingRoots = new Set<string>()

  afterEach(async () => {
    await Promise.all(
      Array.from(pendingRoots, (rootPath) =>
        fs.promises.rm(rootPath, { recursive: true, force: true }).catch(() => {})
      )
    )
    pendingRoots.clear()
  })

  it('extracts canonical package files into a private owned tree and removes it', async () => {
    const tree = await materializeSkillExecutionPackageTree(executionPackage())
    pendingRoots.add(tree.rootPath)

    expect(await fs.promises.realpath(path.dirname(tree.rootPath))).toBe(
      await fs.promises.realpath(os.tmpdir())
    )
    await expect(
      fs.promises.readFile(tree.resolveFile('scripts/run.py'), 'utf8')
    ).resolves.toContain('Path(__file__)')
    await expect(
      fs.promises.readFile(tree.resolveFile('references/runtime.txt'), 'utf8')
    ).resolves.toBe('runtime support')
    const scriptStat = await fs.promises.lstat(tree.resolveFile('scripts/run.py'))
    expect(scriptStat.isFile()).toBe(true)
    expect(scriptStat.isSymbolicLink()).toBe(false)
    expect(scriptStat.nlink).toBe(1)
    if (process.platform !== 'win32') {
      const rootMode = (await fs.promises.stat(tree.rootPath)).mode & 0o777
      const fileMode = scriptStat.mode & 0o777
      expect(rootMode).toBe(0o700)
      expect(fileMode).toBe(0o600)
    }

    await tree.cleanup()
    pendingRoots.delete(tree.rootPath)
    await expect(fs.promises.stat(tree.rootPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['../escape.py', '/absolute.py', 'scripts\\run.py', 'scripts//run.py'])(
    'rejects non-canonical path %s before creating a tree',
    async (relativePath) => {
      const source = executionPackage()
      const invalid = structuredClone(source)
      invalid.files[2].relativePath = relativePath

      await expect(materializeSkillExecutionPackageTree(invalid)).rejects.toThrow(/package path/i)
    }
  )

  it('rejects package byte drift before writing files', async () => {
    const source = executionPackage()
    const invalid = structuredClone(source)
    invalid.files[2].base64 = Buffer.from('different bytes').toString('base64')

    await expect(materializeSkillExecutionPackageTree(invalid)).rejects.toThrow(
      /base64|byte count/i
    )
  })

  it('detects file and inventory drift before process dispatch', async () => {
    const tree = await materializeSkillExecutionPackageTree(executionPackage())
    pendingRoots.add(tree.rootPath)
    await tree.assertIntact()

    await fs.promises.writeFile(tree.resolveFile('scripts/run.py'), 'changed', 'utf8')
    await expect(tree.assertIntact()).rejects.toThrow(/drifted before dispatch/)

    const restored = Buffer.from('from pathlib import Path\nprint(Path(__file__).read_text())\n')
    await fs.promises.writeFile(tree.resolveFile('scripts/run.py'), restored)
    await fs.promises.writeFile(path.join(tree.packageRoot, 'unexpected.txt'), 'unexpected')
    await expect(tree.assertIntact()).rejects.toThrow(/inventory drifted/)
  })

  it('detects package permission drift before process dispatch', async () => {
    if (process.platform === 'win32') return
    const tree = await materializeSkillExecutionPackageTree(executionPackage())
    pendingRoots.add(tree.rootPath)

    await fs.promises.chmod(tree.resolveFile('scripts/run.py'), 0o644)
    await expect(tree.assertIntact()).rejects.toThrow(/permissions drifted/)
  })

  it('rejects unexpected empty directories and nested directory permission drift', async () => {
    const tree = await materializeSkillExecutionPackageTree(executionPackage())
    pendingRoots.add(tree.rootPath)
    const unexpected = path.join(tree.packageRoot, 'unexpected')
    await fs.promises.mkdir(unexpected, { mode: 0o700 })

    await expect(tree.assertIntact()).rejects.toThrow(/directory inventory drifted/)

    await fs.promises.rm(unexpected, { recursive: true })
    if (process.platform !== 'win32') {
      const references = path.join(tree.packageRoot, 'references')
      await fs.promises.chmod(references, 0o755)
      await expect(tree.assertIntact()).rejects.toThrow(/directory.*permissions drifted/)
    }
  })

  it('rejects expected file size drift before reading its contents', async () => {
    const tree = await materializeSkillExecutionPackageTree(executionPackage())
    pendingRoots.add(tree.rootPath)
    await fs.promises.writeFile(tree.resolveFile('scripts/run.py'), Buffer.alloc(1024 * 1024))

    await expect(tree.assertIntact()).rejects.toThrow(/drifted before dispatch/)
  })

  it('rejects non-canonical ownership inventories before reading their trees', async () => {
    const tree = await materializeSkillExecutionPackageTree(executionPackage())
    pendingRoots.add(tree.rootPath)
    const descriptor = structuredClone(tree.descriptor)
    descriptor.files.reverse()

    await expect(cleanupOwnedSkillExecutionPackageTree(descriptor)).rejects.toThrow(/not canonical/)
    await expect(fs.promises.stat(tree.rootPath)).resolves.toBeDefined()
  })

  it('refuses cleanup when the ownership marker no longer matches', async () => {
    const tree = await materializeSkillExecutionPackageTree(executionPackage())
    pendingRoots.add(tree.rootPath)
    const markerPath = path.join(tree.rootPath, '.deepchat-package-owner')
    await fs.promises.writeFile(
      markerPath,
      JSON.stringify({
        schemaVersion: 1,
        ownershipToken: '12345678-1234-4234-9234-000000000000',
        packageHash: tree.descriptor.packageHash
      }),
      'utf8'
    )

    await expect(tree.cleanup()).rejects.toThrow(/ownership marker drifted/)
    await expect(fs.promises.stat(tree.rootPath)).resolves.toBeDefined()

    const descriptor: OwnedSkillExecutionPackageTree = { ...tree.descriptor }
    await fs.promises.writeFile(
      markerPath,
      JSON.stringify({
        schemaVersion: 1,
        ownershipToken: descriptor.ownershipToken,
        packageHash: descriptor.packageHash
      }),
      'utf8'
    )
    await cleanupOwnedSkillExecutionPackageTree(descriptor)
    pendingRoots.delete(tree.rootPath)
  })
})
