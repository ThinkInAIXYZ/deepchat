import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanAndDetectDiscoveriesInWorker } from '../../../../src/main/skill/sync/scanWorker'

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
