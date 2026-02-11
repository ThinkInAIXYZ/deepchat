import { describe, expect, it } from 'vitest'
import {
  normalizeSkillAllowedTools,
  normalizeSkillToolName
} from '@/presenter/skillPresenter/toolNameMapping'

describe('toolNameMapping', () => {
  it('maps Claude Code tool names to canonical names', () => {
    expect(normalizeSkillToolName('Read')).toEqual({ canonical: 'read', mapped: true })
    expect(normalizeSkillToolName('MultiEdit')).toEqual({ canonical: 'edit', mapped: true })
    expect(normalizeSkillToolName('Glob')).toEqual({ canonical: 'find', mapped: true })
    expect(normalizeSkillToolName('Bash')).toEqual({ canonical: 'exec', mapped: true })
  })

  it('maps legacy DeepChat names to canonical names', () => {
    expect(normalizeSkillToolName('read_file')).toEqual({ canonical: 'read', mapped: true })
    expect(normalizeSkillToolName('write_file')).toEqual({ canonical: 'write', mapped: true })
    expect(normalizeSkillToolName('execute_command')).toEqual({
      canonical: 'exec',
      mapped: true
    })
  })

  it('keeps unknown names and emits warnings', () => {
    const result = normalizeSkillAllowedTools(['read_file', 'custom_tool', 'Read'])
    expect(result.tools).toEqual(['read', 'custom_tool'])
    expect(result.warnings.some((msg) => msg.includes('read_file -> read'))).toBe(true)
    expect(result.warnings.some((msg) => msg.includes('Unknown allowedTools entry'))).toBe(true)
  })
})
