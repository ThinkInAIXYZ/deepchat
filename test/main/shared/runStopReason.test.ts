import { describe, expect, it } from 'vitest'
import { isGuardRunStopReason, readRunStopReason } from '@shared/lib/runStopReason'

describe('runStopReason', () => {
  it('recognizes only the three guard stop reasons', () => {
    expect(isGuardRunStopReason('max_tool_calls')).toBe(true)
    expect(isGuardRunStopReason('no_progress')).toBe(true)
    expect(isGuardRunStopReason('max_turns')).toBe(true)
    expect(isGuardRunStopReason('complete')).toBe(false)
    expect(isGuardRunStopReason('user_stop')).toBe(false)
    expect(isGuardRunStopReason('unexpected')).toBe(false)
  })

  it('reads a trimmed stop reason from metadata and ignores blanks', () => {
    expect(readRunStopReason({ runStopReason: 'max_tool_calls' })).toBe('max_tool_calls')
    expect(readRunStopReason({ runStopReason: '  max_turns  ' })).toBe('max_turns')
    expect(readRunStopReason({ runStopReason: '   ' })).toBeUndefined()
    expect(readRunStopReason({ runStopReason: 123 })).toBeUndefined()
    expect(readRunStopReason({ runOutcome: 'completed' })).toBeUndefined()
    expect(readRunStopReason(null)).toBeUndefined()
  })
})
