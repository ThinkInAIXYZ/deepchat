import { describe, expect, it } from 'vitest'
import {
  stampInteractionResolution,
  stampTerminalMetadata
} from '@/agent/deepchat/runtime/runtimeMetadata'

describe('runtimeMetadata stamps', () => {
  const paused = {
    runId: 'run-paused',
    runOutcome: 'paused' as const,
    runStopReason: 'interaction',
    toolCalls: 2
  }

  it('writes a new physical run outcome without touching interactionResolution', () => {
    expect(stampTerminalMetadata(paused, 'completed', 'complete', 'run-next')).toEqual({
      ...paused,
      runId: 'run-next',
      runOutcome: 'completed',
      runStopReason: 'complete'
    })
  })

  it('records a session-layer resolution without rewriting the paused run outcome', () => {
    expect(stampInteractionResolution(paused, 'cancelled')).toEqual({
      ...paused,
      interactionResolution: 'cancelled'
    })
    expect(stampInteractionResolution(paused, 'pending_input').runOutcome).toBe('paused')
    expect(stampInteractionResolution(paused, 'follow_up').runStopReason).toBe('interaction')
  })
})
