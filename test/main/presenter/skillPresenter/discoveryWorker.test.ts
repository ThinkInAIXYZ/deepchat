import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverSkillMetadataInWorker } from '../../../../src/main/presenter/skillPresenter/discoveryWorker'

const tempDirs: string[] = []

afterEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('discoverSkillMetadataInWorker', () => {
  it('discovers skill manifests off-main and preserves derived categories', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const os = await vi.importActual<typeof import('node:os')>('node:os')
    const path = await vi.importActual<typeof import('node:path')>('node:path')
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-skill-worker-'))
    tempDirs.push(rootDir)

    const topLevelSkillDir = path.join(rootDir, 'skill-one')
    const nestedSkillDir = path.join(rootDir, 'category-a', 'skill-two')
    fs.mkdirSync(topLevelSkillDir, { recursive: true })
    fs.mkdirSync(nestedSkillDir, { recursive: true })

    fs.writeFileSync(
      path.join(topLevelSkillDir, 'SKILL.md'),
      ['---', 'name: skill-one', 'description: First skill', '---', '', '# Skill One'].join('\n'),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(nestedSkillDir, 'SKILL.md'),
      ['---', 'name: skill-two', 'description: Second skill', '---', '', '# Skill Two'].join('\n'),
      'utf-8'
    )

    const result = await discoverSkillMetadataInWorker({
      skillsDir: rootDir,
      sidecarDirName: '.deepchat-meta',
      maxDepth: 10
    })

    expect(result.warnings).toEqual([])
    expect(result.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'skill-one',
          category: null
        }),
        expect.objectContaining({
          name: 'skill-two',
          category: 'category-a'
        })
      ])
    )
  })
})
