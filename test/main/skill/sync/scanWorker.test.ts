import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type { ExternalToolConfig, ScanCache } from '../../../../src/shared/types/skillSync'

vi.unmock('fs')
vi.unmock('path')

let scanAndDetectDiscoveriesInWorker: typeof import('../../../../src/main/skill/sync/scanWorker').scanAndDetectDiscoveriesInWorker
let scanExternalToolsInWorker: typeof import('../../../../src/main/skill/sync/scanWorker').scanExternalToolsInWorker
let ToolScanner: typeof import('../../../../src/main/skill/sync/toolScanner').ToolScanner
let compareWithCacheAndSkills: typeof import('../../../../src/main/skill/sync/discoveries').compareWithCacheAndSkills
let buildDir: string

beforeAll(async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  const os = await vi.importActual<typeof import('node:os')>('node:os')
  const path = await vi.importActual<typeof import('node:path')>('node:path')
  buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-scan-build-'))
  execFileSync(
    process.execPath,
    [
      path.resolve('node_modules/electron-vite/bin/electron-vite.js'),
      'build',
      '--config',
      'test/main/skill/sync/scanWorker.build.ts',
      '--outDir',
      buildDir
    ],
    { cwd: process.cwd(), stdio: 'pipe' }
  )
  const load = (name: string) =>
    import(/* @vite-ignore */ pathToFileURL(path.join(buildDir, 'main', name)).href)
  ;({ scanAndDetectDiscoveriesInWorker, scanExternalToolsInWorker } = await load('scanWorker.mjs'))
  ;({ ToolScanner } = await load('toolScanner.mjs'))
  ;({ compareWithCacheAndSkills } = await load('discoveries.mjs'))
}, 60_000)

afterAll(async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  if (buildDir) fs.rmSync(buildDir, { recursive: true, force: true })
})

const tempDirs: string[] = []

const createCursorTool = (skillsDir: string) => ({
  id: 'cursor-global',
  name: 'Cursor (Global)',
  skillsDir,
  filePattern: '*/SKILL.md',
  format: 'cursor',
  capabilities: {
    hasFrontmatter: true,
    supportsName: true,
    supportsDescription: true,
    supportsTools: true,
    supportsModel: true,
    supportsSubfolders: true,
    supportsReferences: true,
    supportsScripts: true
  },
  isProjectLevel: false
})

afterEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('scanAndDetectDiscoveriesInWorker', () => {
  it('matches fallback metadata, filtering and errors on real files', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const os = await vi.importActual<typeof import('node:os')>('node:os')
    const path = await vi.importActual<typeof import('node:path')>('node:path')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-scan-parity-'))
    tempDirs.push(root)
    const write = (name: string, content: string) => {
      const target = path.join(root, name)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
      fs.utimesSync(target, new Date('2026-01-02T03:04:05Z'), new Date('2026-01-02T03:04:05Z'))
    }
    write('folders/alpha/SKILL.md', '---\ndescription: "Alpha summary"\n---\n# Alpha')
    write('folders/cached/SKILL.md', '# Cached\nAlready seen')
    write('folders/imported/SKILL.md', '# Imported\nAlready imported')
    write('folders/empty/SKILL.md', 'No heading or description')
    write('prompts/task.prompt.md', '# Task\nPrompt summary')
    write('prompts/ignore.md', '# Ignore\nWrong extension')
    write('flat/limit.md', '# Limit\n' + 'x'.repeat(10 * 1024 * 1024 - 8))
    write('flat/oversize.md', 'x'.repeat(10 * 1024 * 1024 + 1))
    write('not-directory', 'file')
    fs.mkdirSync(path.join(root, 'folders/not-file/SKILL.md'), { recursive: true })
    fs.mkdirSync(path.join(root, 'folders/missing-entry'))
    const tools: ExternalToolConfig[] = [
      createCursorTool(path.join(root, 'folders')),
      {
        ...createCursorTool('prompts'),
        id: 'prompts-project',
        isProjectLevel: true,
        filePattern: '*.prompt.md'
      },
      { ...createCursorTool(path.join(root, 'flat')), id: 'flat', filePattern: '*.md' },
      { ...createCursorTool(path.join(root, 'absent')), id: 'absent' },
      { ...createCursorTool(path.join(root, 'not-directory')), id: 'not-directory' }
    ]
    const cache: ScanCache = {
      timestamp: '2026-01-01T00:00:00Z',
      tools: [
        {
          toolId: tools[0].id,
          available: true,
          skills: [{ name: 'cached', lastModified: '2025-12-01T00:00:00Z' }]
        }
      ]
    }
    const existingSkillNames = ['imported']
    const fallback = await new ToolScanner(tools).scanExternalTools(root)
    const worker = await scanAndDetectDiscoveriesInWorker({
      tools,
      projectRoot: root,
      cache,
      existingSkillNames
    })
    expect(worker.scanResults).toEqual(fallback)
    expect(worker.discoveries).toEqual(
      compareWithCacheAndSkills(fallback, cache, new Set(existingSkillNames))
    )
    expect(worker.scanResults[0].skills.map((skill) => skill.name)).toEqual([
      'alpha',
      'cached',
      'empty',
      'imported'
    ])
    expect(worker.scanResults[0].skills[0]).toEqual({
      name: 'alpha',
      description: 'Alpha summary',
      path: path.join(root, 'folders/alpha'),
      format: 'cursor',
      lastModified: new Date('2026-01-02T03:04:05Z')
    })
    expect(worker.scanResults[0].skills[2].description).toBeUndefined()
    expect(worker.scanResults[1].skills).toEqual([
      expect.objectContaining({ name: 'task', description: 'Prompt summary' })
    ])
    expect(worker.scanResults[2].skills.map((skill) => skill.name)).toEqual(['limit'])
    expect(worker.scanResults[3]).toMatchObject({ available: false, skills: [] })
    expect(worker.scanResults[4]).toMatchObject({
      available: false,
      skills: [],
      error: `Path is not a directory: ${path.join(root, 'not-directory')}`
    })
    expect(
      worker.discoveries.map((item) => [item.toolId, item.newSkills.map((skill) => skill.name)])
    ).toEqual([
      ['cursor-global', ['alpha', 'empty']],
      ['flat', ['limit']]
    ])
    const userOnly = await scanExternalToolsInWorker({ tools })
    expect(userOnly).toEqual(await new ToolScanner(tools).scanExternalTools())
    expect(userOnly.map((result) => result.toolId)).not.toContain('prompts-project')
  })

  it('rejects cancellation before and after starting a Worker', async () => {
    const before = new AbortController()
    before.abort()
    await expect(scanExternalToolsInWorker({ tools: [] }, before.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    const during = new AbortController()
    const pending = scanExternalToolsInWorker({ tools: [] }, during.signal)
    during.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('scans external tools off-main and returns discoveries', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const os = await vi.importActual<typeof import('node:os')>('node:os')
    const path = await vi.importActual<typeof import('node:path')>('node:path')
    const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-skill-sync-worker-'))
    tempDirs.push(skillsRoot)

    const cursorSkillDir = path.join(skillsRoot, 'alpha')
    fs.mkdirSync(cursorSkillDir, { recursive: true })
    fs.writeFileSync(
      path.join(cursorSkillDir, 'SKILL.md'),
      ['---', 'name: alpha', 'description: Alpha skill', '---', '', '# Alpha'].join('\n'),
      'utf-8'
    )

    const result = await scanAndDetectDiscoveriesInWorker({
      tools: [createCursorTool(skillsRoot)],
      cache: {
        timestamp: new Date().toISOString(),
        tools: []
      },
      existingSkillNames: []
    })

    expect(result.scanResults).toEqual([
      expect.objectContaining({
        toolId: 'cursor-global',
        available: true,
        skills: [
          expect.objectContaining({
            name: 'alpha'
          })
        ]
      })
    ])
    expect(result.discoveries).toEqual([
      expect.objectContaining({
        toolId: 'cursor-global',
        newSkills: [
          expect.objectContaining({
            name: 'alpha'
          })
        ]
      })
    ])
  })
})

describe.skipIf(process.platform === 'win32')(
  'scanAndDetectDiscoveriesInWorker filename guard',
  () => {
    it('rejects escaping file symlinks without rejecting contained targets or linked roots', async () => {
      const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
      const os = await vi.importActual<typeof import('node:os')>('node:os')
      const path = await vi.importActual<typeof import('node:path')>('node:path')
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-scan-links-'))
      tempDirs.push(root)
      const skillsDir = path.join(root, 'skills')
      for (const name of ['escape', 'escape-other', 'outside', 'contained', 'dangling']) {
        fs.mkdirSync(path.join(skillsDir, name), { recursive: true })
      }
      fs.writeFileSync(path.join(skillsDir, 'escape-other/private.md'), '# Private\nMust not leak')
      fs.symlinkSync('../escape-other/private.md', path.join(skillsDir, 'escape/SKILL.md'))
      fs.writeFileSync(path.join(root, 'private.md'), '# Outside\nMust not scan outside root')
      fs.symlinkSync('../../private.md', path.join(skillsDir, 'outside/SKILL.md'))
      fs.writeFileSync(path.join(skillsDir, 'contained/content.md'), '# Safe\nContained summary')
      fs.symlinkSync('content.md', path.join(skillsDir, 'contained/SKILL.md'))
      fs.symlinkSync('missing.md', path.join(skillsDir, 'dangling/SKILL.md'))
      fs.symlinkSync('contained', path.join(skillsDir, 'linked-directory'))
      fs.symlinkSync('skills', path.join(root, 'linked-root'))

      const tools = [createCursorTool(path.join(root, 'linked-root'))]
      const fallback = await new ToolScanner(tools).scanExternalTools()
      const worker = await scanExternalToolsInWorker({ tools })
      expect(worker).toEqual(fallback)
      expect(worker[0].skills).toEqual([
        expect.objectContaining({ name: 'contained', description: 'Contained summary' })
      ])

      fs.symlinkSync('contained/content.md', path.join(skillsDir, 'linked-file.md'))
      const flatTools = [{ ...tools[0], filePattern: '*.md' }]
      expect((await scanExternalToolsInWorker({ tools: flatTools }))[0].skills).toEqual([])
      expect((await new ToolScanner(flatTools).scanExternalTools())[0].skills).toEqual([])
    })

    it('skips skill directories the main-thread scanner rejects', async () => {
      const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
      const os = await vi.importActual<typeof import('node:os')>('node:os')
      const path = await vi.importActual<typeof import('node:path')>('node:path')
      const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-skill-sync-guard-'))
      tempDirs.push(skillsRoot)

      const writeSkill = (dirName: string) => {
        const dir = path.join(skillsRoot, dirName)
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(
          path.join(dir, 'SKILL.md'),
          ['---', 'name: guarded', 'description: Guarded skill', '---', '', '# Guarded'].join('\n'),
          'utf-8'
        )
      }
      writeSkill('alpha')
      writeSkill('back\\slash')
      writeSkill('bell\u0001name')

      const result = await scanAndDetectDiscoveriesInWorker({
        tools: [createCursorTool(skillsRoot)],
        cache: {
          timestamp: new Date().toISOString(),
          tools: []
        },
        existingSkillNames: []
      })

      expect(result.scanResults).toHaveLength(1)
      expect(result.scanResults[0].skills).toHaveLength(1)
      expect(result.scanResults[0].skills[0].path).toBe(path.join(skillsRoot, 'alpha'))
    })
  }
)
