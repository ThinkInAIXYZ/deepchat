import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_SKILL_SCOPES_DIR,
  assertSafeSkillAgentId,
  resolveAgentSkillsRoot
} from '@/skill/agentSkillRoots'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

describe('Agent Skill roots', () => {
  let temporaryRoot: string
  let skillsRoot: string

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-agent-skill-roots-'))
    skillsRoot = path.join(temporaryRoot, 'skills')
    fs.mkdirSync(skillsRoot, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  })

  it('resolves a normal Agent root below the configured Skills root', () => {
    const scopesRoot = path.join(skillsRoot, AGENT_SKILL_SCOPES_DIR)
    const agentRoot = path.join(scopesRoot, 'writer')
    fs.mkdirSync(agentRoot, { recursive: true })

    expect(resolveAgentSkillsRoot(skillsRoot, 'writer')).toBe(agentRoot)
  })

  it('rejects unsafe Agent ids before resolving a path', () => {
    expect(() => assertSafeSkillAgentId('../writer')).toThrow('Invalid Skill Agent id')
    expect(() => assertSafeSkillAgentId('writer/child')).toThrow('Invalid Skill Agent id')
  })

  it.skipIf(process.platform === 'win32')('rejects a symbolic-link Agent scopes directory', () => {
    const outsideRoot = path.join(temporaryRoot, 'outside')
    fs.mkdirSync(outsideRoot)
    fs.symlinkSync(outsideRoot, path.join(skillsRoot, AGENT_SKILL_SCOPES_DIR), 'dir')

    expect(() => resolveAgentSkillsRoot(skillsRoot, 'writer')).toThrow('symbolic link')
  })

  it.skipIf(process.platform === 'win32')('rejects a symbolic-link Agent root', () => {
    const scopesRoot = path.join(skillsRoot, AGENT_SKILL_SCOPES_DIR)
    const outsideRoot = path.join(temporaryRoot, 'outside')
    fs.mkdirSync(scopesRoot)
    fs.mkdirSync(outsideRoot)
    fs.symlinkSync(outsideRoot, path.join(scopesRoot, 'writer'), 'dir')

    expect(() => resolveAgentSkillsRoot(skillsRoot, 'writer')).toThrow('symbolic link')
  })
})
