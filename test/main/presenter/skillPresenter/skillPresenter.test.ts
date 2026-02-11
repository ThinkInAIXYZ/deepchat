import { describe, it, expect, beforeEach, vi, Mock, afterEach } from 'vitest'
import type { IConfigPresenter } from '../../../../src/shared/presenter'
import type { SkillMetadata } from '../../../../src/shared/types/skill'
import { app } from 'electron'

// Mock external dependencies
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockImplementation((name: string) => {
      if (name === 'home') return '/mock/home'
      if (name === 'temp') return '/mock/temp'
      return '/mock/' + name
    }),
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
    isPackaged: false
  },
  shell: {
    openPath: vi.fn().mockResolvedValue('')
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    copyFileSync: vi.fn(),
    renameSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({
      isFile: () => true,
      size: 1024
    }),
    mkdtempSync: vi.fn().mockReturnValue('/mock/temp/deepchat-skill-123')
  }
}))

vi.mock('path', () => ({
  default: {
    join: vi.fn((...args: string[]) => args.join('/')),
    dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
    basename: vi.fn((p: string) => p.split('/').pop() || ''),
    resolve: vi.fn((...args: string[]) => {
      const p = args[args.length - 1]
      if (p.startsWith('/')) return p
      return '/' + args.join('/')
    }),
    relative: vi.fn((from: string, to: string) => {
      if (to.startsWith(from)) {
        return to.substring(from.length + 1)
      }
      return '../' + to
    }),
    isAbsolute: vi.fn((p: string) => p.startsWith('/'))
  }
}))

vi.mock('chokidar', () => ({
  watch: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    close: vi.fn()
  }))
}))

vi.mock('gray-matter', () => ({
  default: vi.fn()
}))

vi.mock('fflate', () => ({
  unzipSync: vi.fn()
}))

vi.mock('../../../../src/main/eventbus', () => ({
  eventBus: {
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'all'
  }
}))

vi.mock('../../../../src/main/events', () => ({
  SKILL_EVENTS: {
    DISCOVERED: 'skill:discovered',
    METADATA_UPDATED: 'skill:metadata-updated',
    INSTALLED: 'skill:installed',
    UNINSTALLED: 'skill:uninstalled',
    ACTIVATED: 'skill:activated',
    DEACTIVATED: 'skill:deactivated'
  }
}))

vi.mock('../../../../src/main/presenter', () => ({
  presenter: {
    sessionPresenter: {
      getConversation: vi.fn(),
      updateConversationSettings: vi.fn()
    }
  }
}))

// Import mocked modules
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { watch } from 'chokidar'
import { unzipSync } from 'fflate'
import { eventBus } from '../../../../src/main/eventbus'
import { SKILL_EVENTS } from '../../../../src/main/events'
import { presenter } from '../../../../src/main/presenter'
import { SkillPresenter } from '../../../../src/main/presenter/skillPresenter/index'

describe('SkillPresenter', () => {
  let skillPresenter: SkillPresenter
  let mockConfigPresenter: IConfigPresenter

  beforeEach(() => {
    vi.clearAllMocks()

    mockConfigPresenter = {
      getSkillsPath: vi.fn().mockReturnValue('')
    } as unknown as IConfigPresenter

    // Setup default mocks
    ;(fs.existsSync as Mock).mockReturnValue(true)
    ;(fs.mkdirSync as Mock).mockReturnValue(undefined)
    ;(fs.readdirSync as Mock).mockReturnValue([])
    ;(fs.statSync as Mock).mockReturnValue({
      isFile: () => true,
      size: 1024
    })
    ;(matter as unknown as Mock).mockReturnValue({
      data: { name: 'test-skill', description: 'Test skill' },
      content: '# Test content'
    })

    skillPresenter = new SkillPresenter(mockConfigPresenter)
  })

  afterEach(() => {
    skillPresenter.destroy()
  })

  describe('constructor', () => {
    it('should initialize with default skills directory', () => {
      expect(fs.existsSync).toHaveBeenCalled()
    })

    it('should use configured skills path when provided', () => {
      ;(mockConfigPresenter.getSkillsPath as Mock).mockReturnValue('/custom/skills/path')

      const presenter = new SkillPresenter(mockConfigPresenter)
      expect(mockConfigPresenter.getSkillsPath).toHaveBeenCalled()
      presenter.destroy()
    })

    it('should create skills directory if it does not exist', () => {
      ;(fs.existsSync as Mock).mockReturnValue(false)

      const presenter = new SkillPresenter(mockConfigPresenter)
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
      presenter.destroy()
    })

    it('should repair malformed .deepchat path segments', async () => {
      ;(mockConfigPresenter.getSkillsPath as Mock).mockReturnValue('/mock/home.deepchat/skills')
      ;(app.getPath as Mock).mockImplementation((name: string) => {
        if (name === 'home') return '/mock/home'
        if (name === 'temp') return '/mock/temp'
        return '/mock/' + name
      })

      const presenter = new SkillPresenter(mockConfigPresenter)
      await expect(presenter.getSkillsDir()).resolves.toBe('/mock/home/.deepchat/skills')
      presenter.destroy()
    })
  })

  describe('getSkillsDir', () => {
    it('should return the skills directory path', async () => {
      const dir = await skillPresenter.getSkillsDir()
      expect(dir).toBeTruthy()
      expect(typeof dir).toBe('string')
    })
  })

  describe('discoverSkills', () => {
    it('should return empty array when skills directory does not exist', async () => {
      ;(fs.existsSync as Mock).mockReturnValue(false)

      const skills = await skillPresenter.discoverSkills()
      expect(skills).toEqual([])
    })

    it('should discover skills from directories with SKILL.md', async () => {
      ;(fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p.endsWith('SKILL.md')) return true
        return true
      })
      ;(fs.readdirSync as Mock).mockReturnValue([
        { name: 'skill-one', isDirectory: () => true },
        { name: 'skill-two', isDirectory: () => true }
      ])
      ;(fs.readFileSync as Mock).mockReturnValue(
        '---\nname: test\ndescription: test\n---\n# Content'
      )
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'test-skill', description: 'Test description' },
        content: '# Test'
      })

      const skills = await skillPresenter.discoverSkills()

      expect(skills.length).toBe(2)
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
        SKILL_EVENTS.DISCOVERED,
        'all',
        expect.any(Array)
      )
    })

    it('should skip non-directory entries', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([
        { name: 'file.txt', isDirectory: () => false },
        { name: 'skill-one', isDirectory: () => true }
      ])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'skill-one', description: 'Test' },
        content: ''
      })

      const skills = await skillPresenter.discoverSkills()

      expect(skills.length).toBe(1)
    })

    it('should skip directories without SKILL.md', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([{ name: 'no-skill', isDirectory: () => true }])
      ;(fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p.endsWith('SKILL.md')) return false
        return true
      })

      const skills = await skillPresenter.discoverSkills()

      expect(skills.length).toBe(0)
    })

    it('should handle parse errors gracefully', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([{ name: 'bad-skill', isDirectory: () => true }])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockImplementation(() => {
        throw new Error('Read error')
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const skills = await skillPresenter.discoverSkills()

      expect(skills.length).toBe(0)
      consoleSpy.mockRestore()
    })
  })

  describe('getMetadataList', () => {
    it('should return cached metadata', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([{ name: 'test', isDirectory: () => true }])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'test', description: 'Test' },
        content: ''
      })

      // First call triggers discovery
      const first = await skillPresenter.getMetadataList()
      // Second call returns from cache
      const second = await skillPresenter.getMetadataList()

      expect(first).toEqual(second)
    })
  })

  describe('getMetadataPrompt', () => {
    it('should return formatted prompt with no skills', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([])

      const prompt = await skillPresenter.getMetadataPrompt()

      expect(prompt).toContain('# Available Skills')
      expect(prompt).toContain('Skills directory: `')
      expect(prompt).toContain('No skills are currently installed')
    })

    it('should return formatted prompt with skills list', async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([{ name: 'my-skill', isDirectory: () => true }])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'my-skill', description: 'My skill description' },
        content: ''
      })

      const prompt = await skillPresenter.getMetadataPrompt()

      expect(prompt).toContain('# Available Skills')
      expect(prompt).toContain('my-skill')
      expect(prompt).toContain('My skill description')
    })
  })

  describe('loadSkillContent', () => {
    beforeEach(() => {
      ;(fs.readdirSync as Mock).mockReturnValue([{ name: 'test-skill', isDirectory: () => true }])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test content')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'test-skill', description: 'Test' },
        content: '# Skill content here'
      })
    })

    it('should load skill content by name', async () => {
      await skillPresenter.discoverSkills()
      const content = await skillPresenter.loadSkillContent('test-skill')

      expect(content).toBeTruthy()
      expect(content?.name).toBe('test-skill')
      expect(content?.content).toContain('Skill content')
    })

    it('should return null for non-existent skill', async () => {
      await skillPresenter.discoverSkills()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const content = await skillPresenter.loadSkillContent('non-existent')

      expect(content).toBeNull()
      consoleSpy.mockRestore()
    })

    it('should cache loaded content', async () => {
      await skillPresenter.discoverSkills()

      const first = await skillPresenter.loadSkillContent('test-skill')
      const second = await skillPresenter.loadSkillContent('test-skill')

      expect(first).toBe(second)
    })

    it('should replace path variables in content', async () => {
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'test-skill', description: 'Test' },
        content: 'Root: ${SKILL_ROOT} Dir: ${SKILLS_DIR}'
      })

      await skillPresenter.discoverSkills()
      const content = await skillPresenter.loadSkillContent('test-skill')

      expect(content?.content).not.toContain('${SKILL_ROOT}')
      expect(content?.content).not.toContain('${SKILLS_DIR}')
    })
  })

  describe('installFromFolder', () => {
    it('should fail if folder does not exist', async () => {
      ;(fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p === '/nonexistent') return false
        return true
      })

      const result = await skillPresenter.installFromFolder('/nonexistent')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should fail if SKILL.md does not exist in folder', async () => {
      ;(fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p.endsWith('SKILL.md')) return false
        return true
      })

      const result = await skillPresenter.installFromFolder('/valid/folder')

      expect(result.success).toBe(false)
      expect(result.error).toContain('SKILL.md not found')
    })

    it('should fail if skill name is missing in frontmatter', async () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { description: 'Test' },
        content: ''
      })

      const result = await skillPresenter.installFromFolder('/valid/folder')

      expect(result.success).toBe(false)
      expect(result.error).toContain('name not found')
    })

    it('should fail if skill description is missing', async () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'test-skill' },
        content: ''
      })

      const result = await skillPresenter.installFromFolder('/valid/folder')

      expect(result.success).toBe(false)
      expect(result.error).toContain('description not found')
    })

    it('should fail if skill name contains invalid characters', async () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'invalid/name', description: 'Test' },
        content: ''
      })

      const result = await skillPresenter.installFromFolder('/valid/folder')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid skill name')
    })

    it('should fail if skill already exists without overwrite option', async () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'existing-skill', description: 'Test' },
        content: ''
      })
      ;(path.resolve as Mock).mockImplementation((p: string) => {
        if (p.startsWith('/')) return p
        return '/' + p
      })
      ;(path.relative as Mock).mockReturnValue('../something')

      const result = await skillPresenter.installFromFolder('/source/folder')

      expect(result.success).toBe(false)
      expect(result.error).toContain('already exists')
    })

    it('should successfully install a valid skill', async () => {
      // Mock path functions first
      ;(path.resolve as Mock).mockImplementation((p: string) => {
        if (p.startsWith('/')) return p
        return '/' + p
      })
      ;(path.relative as Mock).mockReturnValue('../skills/new-skill')

      // Mock fs.existsSync to return appropriate values
      ;(fs.existsSync as Mock).mockImplementation((p: string) => {
        // Source folder and SKILL.md exist
        if (p === '/source/new-skill' || p === '/source/new-skill/SKILL.md') return true
        // Target folder doesn't exist yet
        if (p.includes('/.deepchat/skills/new-skill')) return false
        // Skills dir exists
        return true
      })
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(fs.readdirSync as Mock).mockReturnValue([])
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'new-skill', description: 'New skill description' },
        content: '# Content'
      })

      const result = await skillPresenter.installFromFolder('/source/new-skill')

      expect(result.success).toBe(true)
      expect(result.skillName).toBe('new-skill')
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
        SKILL_EVENTS.INSTALLED,
        'all',
        expect.objectContaining({ name: 'new-skill' })
      )
    })
  })

  describe('installFromZip', () => {
    it('should fail if zip file does not exist', async () => {
      ;(fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p.endsWith('.zip')) return false
        return true
      })

      const result = await skillPresenter.installFromZip('/path/to/skill.zip')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should fail if SKILL.md not found in zip', async () => {
      // Reset path mock to default behavior
      ;(path.resolve as Mock).mockImplementation((...args: string[]) => {
        const last = args[args.length - 1]
        if (last && last.startsWith('/')) return last
        return '/' + args.filter(Boolean).join('/')
      })
      ;(fs.existsSync as Mock).mockImplementation((p: string) => {
        // Zip file exists
        if (p === '/path/to/skill.zip') return true
        // SKILL.md doesn't exist in extracted dir
        if (p.endsWith('SKILL.md')) return false
        // Temp dir exists
        return true
      })
      ;(fs.readFileSync as Mock).mockReturnValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
      ;(unzipSync as Mock).mockReturnValue({})
      ;(fs.readdirSync as Mock).mockReturnValue([])

      const result = await skillPresenter.installFromZip('/path/to/skill.zip')

      expect(result.success).toBe(false)
      expect(result.error).toContain('SKILL.md not found')
    })
  })

  describe('uninstallSkill', () => {
    it('should fail if skill does not exist', async () => {
      ;(fs.existsSync as Mock).mockReturnValue(false)

      const result = await skillPresenter.uninstallSkill('nonexistent')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should successfully uninstall a skill', async () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.rmSync as Mock).mockReturnValue(undefined)

      const result = await skillPresenter.uninstallSkill('test-skill')

      expect(result.success).toBe(true)
      expect(result.skillName).toBe('test-skill')
      expect(fs.rmSync).toHaveBeenCalled()
      expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
        SKILL_EVENTS.UNINSTALLED,
        'all',
        expect.objectContaining({ name: 'test-skill' })
      )
    })
  })

  describe('updateSkillFile', () => {
    beforeEach(async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([{ name: 'test-skill', isDirectory: () => true }])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'test-skill', description: 'Test' },
        content: ''
      })
      await skillPresenter.discoverSkills()
    })

    it('should fail if skill does not exist', async () => {
      const result = await skillPresenter.updateSkillFile('nonexistent', 'new content')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should successfully update skill file', async () => {
      ;(fs.writeFileSync as Mock).mockReturnValue(undefined)

      const result = await skillPresenter.updateSkillFile('test-skill', 'new content')

      expect(result.success).toBe(true)
      expect(fs.writeFileSync).toHaveBeenCalled()
    })
  })

  describe('getSkillFolderTree', () => {
    beforeEach(async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([{ name: 'test-skill', isDirectory: () => true }])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'test-skill', description: 'Test' },
        content: ''
      })
      await skillPresenter.discoverSkills()
    })

    it('should return empty array for non-existent skill', async () => {
      const tree = await skillPresenter.getSkillFolderTree('nonexistent')
      expect(tree).toEqual([])
    })

    it('should return folder tree for existing skill', async () => {
      // Reset readdirSync to return files for the skill folder
      let callCount = 0
      ;(fs.readdirSync as Mock).mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // First call is for discovering skills
          return [{ name: 'test-skill', isDirectory: () => true }]
        }
        // Subsequent calls are for building tree - return empty to prevent recursion
        return [{ name: 'SKILL.md', isDirectory: () => false }]
      })

      const tree = await skillPresenter.getSkillFolderTree('test-skill')

      expect(Array.isArray(tree)).toBe(true)
      expect(tree.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getActiveSkills', () => {
    it('should return active skills for a conversation', async () => {
      ;(presenter.sessionPresenter.getConversation as Mock).mockResolvedValue({
        settings: { activeSkills: ['skill-1', 'skill-2'] }
      })
      // Setup skills in metadata cache with proper matter mock
      ;(fs.readdirSync as Mock).mockReturnValue([
        { name: 'skill-1', isDirectory: () => true },
        { name: 'skill-2', isDirectory: () => true }
      ])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')

      // Matter mock returns name matching directory name
      let callIndex = 0
      ;(matter as unknown as Mock).mockImplementation(() => {
        callIndex++
        if (callIndex === 1) {
          return { data: { name: 'skill-1', description: 'Test 1' }, content: '' }
        }
        return { data: { name: 'skill-2', description: 'Test 2' }, content: '' }
      })

      await skillPresenter.discoverSkills()

      const active = await skillPresenter.getActiveSkills('conv-123')

      expect(active).toEqual(['skill-1', 'skill-2'])
    })

    it('should return empty array if conversation has no active skills', async () => {
      ;(presenter.sessionPresenter.getConversation as Mock).mockResolvedValue({
        settings: {}
      })

      const active = await skillPresenter.getActiveSkills('conv-123')

      expect(active).toEqual([])
    })

    it('should filter out non-existent skills', async () => {
      ;(presenter.sessionPresenter.getConversation as Mock).mockResolvedValue({
        settings: { activeSkills: ['exists', 'removed'] }
      })
      ;(fs.readdirSync as Mock).mockReturnValue([{ name: 'exists', isDirectory: () => true }])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'exists', description: 'Test' },
        content: ''
      })
      await skillPresenter.discoverSkills()

      const active = await skillPresenter.getActiveSkills('conv-123')

      expect(active).toEqual(['exists'])
      expect(presenter.sessionPresenter.updateConversationSettings).toHaveBeenCalled()
    })
  })

  describe('setActiveSkills', () => {
    beforeEach(async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([
        { name: 'skill-1', isDirectory: () => true },
        { name: 'skill-2', isDirectory: () => true }
      ])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockImplementation(() => ({
        data: { name: 'skill-1', description: 'Test' },
        content: ''
      }))
      await skillPresenter.discoverSkills()
    })

    it('should set active skills for a conversation', async () => {
      ;(presenter.sessionPresenter.getConversation as Mock).mockResolvedValue({
        settings: { activeSkills: [] }
      })
      ;(presenter.sessionPresenter.updateConversationSettings as Mock).mockResolvedValue(undefined)

      await skillPresenter.setActiveSkills('conv-123', ['skill-1'])

      expect(presenter.sessionPresenter.updateConversationSettings).toHaveBeenCalledWith(
        'conv-123',
        expect.objectContaining({ activeSkills: expect.any(Array) })
      )
    })

    it('should emit activated event when skills are activated', async () => {
      ;(presenter.sessionPresenter.getConversation as Mock).mockResolvedValue({
        settings: { activeSkills: [] }
      })

      await skillPresenter.setActiveSkills('conv-123', ['skill-1'])

      expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
        SKILL_EVENTS.ACTIVATED,
        'all',
        expect.objectContaining({
          conversationId: 'conv-123',
          skills: expect.arrayContaining(['skill-1'])
        })
      )
    })

    it('should emit deactivated event when skills are deactivated', async () => {
      ;(presenter.sessionPresenter.getConversation as Mock).mockResolvedValue({
        settings: { activeSkills: ['skill-1', 'skill-2'] }
      })
      ;(matter as unknown as Mock).mockImplementation(() => ({
        data: { name: 'skill-2', description: 'Test' },
        content: ''
      }))

      await skillPresenter.setActiveSkills('conv-123', ['skill-2'])

      expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
        SKILL_EVENTS.DEACTIVATED,
        'all',
        expect.objectContaining({
          conversationId: 'conv-123',
          skills: expect.arrayContaining(['skill-1'])
        })
      )
    })
  })

  describe('validateSkillNames', () => {
    beforeEach(async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([{ name: 'valid-skill', isDirectory: () => true }])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: { name: 'valid-skill', description: 'Test' },
        content: ''
      })
      await skillPresenter.discoverSkills()
    })

    it('should return only valid skill names', async () => {
      const result = await skillPresenter.validateSkillNames(['valid-skill', 'invalid-skill'])

      expect(result).toEqual(['valid-skill'])
    })

    it('should return empty array for all invalid names', async () => {
      const result = await skillPresenter.validateSkillNames(['invalid1', 'invalid2'])

      expect(result).toEqual([])
    })
  })

  describe('getActiveSkillsAllowedTools', () => {
    beforeEach(async () => {
      ;(fs.readdirSync as Mock).mockReturnValue([
        { name: 'skill-with-tools', isDirectory: () => true }
      ])
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue('test')
      ;(matter as unknown as Mock).mockReturnValue({
        data: {
          name: 'skill-with-tools',
          description: 'Test',
          allowedTools: ['read_file', 'write_file']
        },
        content: ''
      })
      await skillPresenter.discoverSkills()
    })

    it('should return union of allowed tools from active skills', async () => {
      ;(presenter.sessionPresenter.getConversation as Mock).mockResolvedValue({
        settings: { activeSkills: ['skill-with-tools'] }
      })

      const tools = await skillPresenter.getActiveSkillsAllowedTools('conv-123')

      expect(tools).toContain('read')
      expect(tools).toContain('write')
    })

    it('should return empty array when no active skills', async () => {
      ;(presenter.sessionPresenter.getConversation as Mock).mockResolvedValue({
        settings: { activeSkills: [] }
      })

      const tools = await skillPresenter.getActiveSkillsAllowedTools('conv-123')

      expect(tools).toEqual([])
    })
  })

  describe('watchSkillFiles', () => {
    it('should start file watcher', () => {
      skillPresenter.watchSkillFiles()

      expect(watch).toHaveBeenCalled()
    })

    it('should not start watcher twice', () => {
      skillPresenter.watchSkillFiles()
      skillPresenter.watchSkillFiles()

      expect(watch).toHaveBeenCalledTimes(1)
    })
  })

  describe('stopWatching', () => {
    it('should stop the file watcher', () => {
      skillPresenter.watchSkillFiles()
      skillPresenter.stopWatching()

      // Watcher should be null after stopping
      skillPresenter.watchSkillFiles()
      expect(watch).toHaveBeenCalledTimes(2)
    })
  })

  describe('destroy', () => {
    it('should cleanup all resources', () => {
      skillPresenter.watchSkillFiles()
      skillPresenter.destroy()

      // Should be able to start watcher again after destroy
      skillPresenter.watchSkillFiles()
      expect(watch).toHaveBeenCalledTimes(2)
    })
  })
})
