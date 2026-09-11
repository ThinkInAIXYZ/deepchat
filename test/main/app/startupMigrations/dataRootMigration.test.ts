import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// setup.ts 为全仓测试把 fs/path 换成了 vi.fn() mock；本测试的被测对象就是真实文件树
// 的幂等合并语义，这里对本文件恢复真实模块（不影响其他套件）。
vi.mock('fs', async () => await vi.importActual<typeof import('fs')>('fs'))
vi.mock('path', async () => await vi.importActual<typeof import('path')>('path'))
import {
  isLegacyDefaultSkillsPath,
  runDataRootMigration,
  MIOWORK_DATA_ROOT,
  LEGACY_DATA_ROOT,
  MIGRATION_MARKER
} from '@/app/startupMigrations/dataRootMigration'

// 数据根迁移单测：全部走真实临时目录（不 mock fs），
// 因为被测对象就是文件树的幂等合并语义本身。
describe('dataRootMigration', () => {
  let homeDir: string

  /** 内存版 skillsPath 存取口，记录每次 set 调用供断言 */
  function createMemoryStore(initial?: string) {
    let value = initial
    const calls: string[] = []
    return {
      calls,
      get: () => value,
      set: (next: string) => {
        calls.push(next)
        value = next
      }
    }
  }

  /** 按旧版盘面造一个 ~/.deepchat：skills 子树 + sessions（不该被拷）+ remote-assets */
  function seedLegacyRoot(options: { withSessions?: boolean } = {}) {
    const legacyRoot = path.join(homeDir, LEGACY_DATA_ROOT)
    const skillsDir = path.join(legacyRoot, 'skills')
    fs.mkdirSync(path.join(skillsDir, 'alpha'), { recursive: true })
    fs.writeFileSync(
      path.join(skillsDir, 'alpha', 'SKILL.md'),
      '---\nname: alpha\n---\nlegacy alpha',
      'utf-8'
    )
    fs.writeFileSync(path.join(skillsDir, 'notes.txt'), 'legacy notes', 'utf-8')
    fs.mkdirSync(path.join(skillsDir, '.deepchat-meta'), { recursive: true })
    fs.writeFileSync(
      path.join(skillsDir, '.deepchat-meta', 'alpha.json'),
      '{"scope":"alpha"}',
      'utf-8'
    )
    if (options.withSessions) {
      fs.mkdirSync(path.join(legacyRoot, 'sessions', 'conv-1'), { recursive: true })
      fs.writeFileSync(path.join(legacyRoot, 'sessions', 'conv-1', 'tool_a.offload'), 'big', 'utf-8')
    }
    return { legacyRoot, skillsDir }
  }

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miowork-dataroot-test-'))
  })

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('copies the skills subtree, renames the legacy sidecar, leaves sessions behind', () => {
    seedLegacyRoot({ withSessions: true })
    const legacyDefault = path.join(homeDir, LEGACY_DATA_ROOT, 'skills')
    const store = createMemoryStore(legacyDefault)

    runDataRootMigration({ homeDir, skillsPathStore: store })

    const newRoot = path.join(homeDir, MIOWORK_DATA_ROOT)
    // skills 子树整体到位
    expect(fs.readFileSync(path.join(newRoot, 'skills', 'alpha', 'SKILL.md'), 'utf-8')).toBe(
      '---\nname: alpha\n---\nlegacy alpha'
    )
    expect(fs.existsSync(path.join(newRoot, 'skills', 'notes.txt'))).toBe(true)
    // sidecar 改名：新名在、旧名不在
    expect(
      fs.readFileSync(path.join(newRoot, 'skills', '.miowork-meta', 'alpha.json'), 'utf-8')
    ).toBe('{"scope":"alpha"}')
    expect(fs.existsSync(path.join(newRoot, 'skills', '.deepchat-meta'))).toBe(false)
    // sessions 只切根不拷贝
    expect(fs.existsSync(path.join(newRoot, 'sessions'))).toBe(false)
    // marker 落位、stored skillsPath 改写为新默认
    expect(fs.existsSync(path.join(newRoot, MIGRATION_MARKER))).toBe(true)
    expect(store.calls).toEqual([path.join(homeDir, MIOWORK_DATA_ROOT, 'skills')])
    // 旧目录原样保留（copy 策略的合同：官方 MioWork 同机共存不受伤）
    expect(fs.existsSync(path.join(homeDir, LEGACY_DATA_ROOT, 'skills', 'notes.txt'))).toBe(true)
  })

  it('skips entirely once the marker exists', () => {
    seedLegacyRoot()
    const store = createMemoryStore(path.join(homeDir, LEGACY_DATA_ROOT, 'skills'))
    runDataRootMigration({ homeDir, skillsPathStore: store })
    expect(store.calls).toHaveLength(1)

    // 用户（或清理逻辑）删掉旧目录后再次启动：marker 在 → 不重拷、不改写、不报错
    fs.rmSync(path.join(homeDir, LEGACY_DATA_ROOT), { recursive: true, force: true })
    runDataRootMigration({ homeDir, skillsPathStore: store })
    expect(store.calls).toHaveLength(1)
    expect(fs.existsSync(path.join(homeDir, MIOWORK_DATA_ROOT, 'skills', 'notes.txt'))).toBe(true)
  })

  it('writes only the marker for a fresh install without a legacy root', () => {
    const store = createMemoryStore()
    runDataRootMigration({ homeDir, skillsPathStore: store })

    const newRoot = path.join(homeDir, MIOWORK_DATA_ROOT)
    expect(fs.existsSync(path.join(newRoot, MIGRATION_MARKER))).toBe(true)
    expect(fs.existsSync(path.join(newRoot, 'skills'))).toBe(false)
    expect(store.calls).toHaveLength(0)
  })

  it('does not touch a custom skillsPath', () => {
    seedLegacyRoot()
    const customPath = path.join(homeDir, 'my-skills', 'custom')
    const store = createMemoryStore(customPath)

    runDataRootMigration({ homeDir, skillsPathStore: store })

    expect(store.calls).toHaveLength(0)
    // 迁移后的 skills 落在默认新根，而不是用户自定义路径（路径改写只针对旧默认值）
    expect(fs.existsSync(path.join(homeDir, MIOWORK_DATA_ROOT, 'skills', 'notes.txt'))).toBe(true)
  })

  it('normalizes trailing separators before comparing with the legacy default', () => {
    seedLegacyRoot()
    const legacyDefaultWithTrailingSep =
      path.join(homeDir, LEGACY_DATA_ROOT, 'skills') + path.sep
    const store = createMemoryStore(legacyDefaultWithTrailingSep)

    runDataRootMigration({ homeDir, skillsPathStore: store })

    expect(store.calls).toEqual([path.join(homeDir, MIOWORK_DATA_ROOT, 'skills')])
  })

  it('merges idempotently: existing targets win, missing files are filled in on retry', () => {
    seedLegacyRoot()
    const store = createMemoryStore()

    // 模拟上次启动拷到一半就失败：新根已有 alpha（内容较新）但缺 notes.txt，
    // 且 marker 尚未写入
    const newSkillsDir = path.join(homeDir, MIOWORK_DATA_ROOT, 'skills')
    fs.mkdirSync(path.join(newSkillsDir, 'alpha'), { recursive: true })
    fs.writeFileSync(path.join(newSkillsDir, 'alpha', 'SKILL.md'), 'newer alpha', 'utf-8')

    runDataRootMigration({ homeDir, skillsPathStore: store })

    // 已存在目标保留目标态（不覆盖），缺失文件补齐，marker 补写
    expect(fs.readFileSync(path.join(newSkillsDir, 'alpha', 'SKILL.md'), 'utf-8')).toBe(
      'newer alpha'
    )
    expect(fs.existsSync(path.join(newSkillsDir, 'notes.txt'))).toBe(true)
    expect(fs.existsSync(path.join(homeDir, MIOWORK_DATA_ROOT, MIGRATION_MARKER))).toBe(true)
  })

  describe('isLegacyDefaultSkillsPath', () => {
    it('matches the legacy default and tolerates separator noise', () => {
      const legacyDefault = path.join(homeDir, LEGACY_DATA_ROOT, 'skills')
      expect(isLegacyDefaultSkillsPath(legacyDefault, homeDir)).toBe(true)
      expect(isLegacyDefaultSkillsPath(legacyDefault + path.sep, homeDir)).toBe(true)
    })

    it('rejects new-root paths and external custom paths', () => {
      expect(
        isLegacyDefaultSkillsPath(path.join(homeDir, MIOWORK_DATA_ROOT, 'skills'), homeDir)
      ).toBe(false)
      expect(isLegacyDefaultSkillsPath(path.join(homeDir, 'elsewhere'), homeDir)).toBe(false)
    })
  })
})
