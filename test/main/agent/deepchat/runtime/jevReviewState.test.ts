import { describe, expect, it } from 'vitest'
import {
  estimateJevTokens,
  fitJevReviewState,
  JEV_REVIEW_MAX_STATE_TOKENS
} from '@/agent/deepchat/runtime/jevReviewState'
import type { ToolPermissionReviewRequest } from '@/agent/deepchat/runtime/types'

const buildRequest = (
  overrides: Partial<ToolPermissionReviewRequest> = {}
): ToolPermissionReviewRequest => ({
  sessionId: 'session-1',
  messageId: 'message-1',
  toolCallId: 'call-1',
  toolName: 'write',
  toolArgs: '{"path":"src/a.ts"}',
  reason: 'tool_call',
  ...overrides
})

const proposedActionOf = (state: Record<string, unknown>): Record<string, unknown> =>
  state.proposedAction as Record<string, unknown>

describe('estimateJevTokens', () => {
  it('charges JSON punctuation heavily, which is where a characters-per-token ratio undercounts', () => {
    const letters = 'a'.repeat(90)
    const json = '{"a":"b",'.repeat(10)

    expect(estimateJevTokens(json)).toBeGreaterThan(estimateJevTokens(letters) * 2)
  })

  it('charges non-ASCII at least as much per character as ASCII letters', () => {
    // CJK is the case that would overflow a request if it were under-counted.
    expect(estimateJevTokens('中'.repeat(300))).toBeGreaterThan(estimateJevTokens('a'.repeat(300)))
  })
})

describe('fitJevReviewState', () => {
  it('leaves a normal action untouched, including the permission payload', () => {
    const fitted = fitJevReviewState({
      request: buildRequest({
        permission: { permissionType: 'write' } as ToolPermissionReviewRequest['permission']
      }),
      recentMessages: [{ role: 'user', content: 'fix the typo in src/a.ts' }]
    })

    expect(fitted?.shape).toBe('full')
    expect(proposedActionOf(fitted!.state).permission).toEqual({ permissionType: 'write' })
    expect(proposedActionOf(fitted!.state).toolArgs).toBe('{"path":"src/a.ts"}')
  })

  it('withholds this app own pre-assessment from the reviewer', () => {
    // A contract, not an implementation detail. Two independent reasons:
    // - `commandInfo.suggestion` asserts the action is safe ("该命令为只读操作，影响较小"), which is one of
    //   the patterns the injection question is defined to catch. Measured against Jev it lifted
    //   injection_pressure from 0.07 to 0.77, past the composition's 0.2 ceiling, so every command
    //   escalated to ask_user regardless of how benign it was.
    // - `commandInfo.riskLevel` is this app's own verdict on the command. A reviewer handed the
    //   conclusion of the layer it exists to check is not reviewing independently.
    const fitted = fitJevReviewState({
      request: buildRequest({
        toolName: 'exec',
        permission: {
          permissionType: 'command',
          description: 'Command execution requires your approval.',
          command: 'git status',
          commandSignature: 'deadbeef',
          commandInfo: {
            command: 'git status',
            riskLevel: 'low',
            suggestion: '该命令为只读操作，影响较小。',
            signature: 'deadbeef',
            baseCommand: 'git'
          }
        } as ToolPermissionReviewRequest['permission']
      }),
      recentMessages: []
    })

    expect(proposedActionOf(fitted!.state).permission).toEqual({
      permissionType: 'command',
      command: 'git status',
      baseCommand: 'git'
    })

    const serialized = JSON.stringify(fitted!.state)
    expect(serialized).not.toContain('该命令为只读操作')
    expect(serialized).not.toContain('requires your approval')
    expect(serialized).not.toContain('riskLevel')
  })

  it('fits a huge tool argument instead of sending an oversized request', () => {
    // The regression this guards: an unbounded `write` body used to exceed Jev's request limit and
    // resolve to ask_user, so every large-argument action was escalated rather than judged.
    const hugeArgs = JSON.stringify({ path: 'src/big.ts', content: 'x'.repeat(500_000) })

    const fitted = fitJevReviewState({
      request: buildRequest({ toolArgs: hugeArgs }),
      recentMessages: []
    })

    expect(fitted).not.toBeNull()
    expect(fitted!.estimatedTokens).toBeLessThanOrEqual(JEV_REVIEW_MAX_STATE_TOKENS)
    expect(proposedActionOf(fitted!.state).toolArgs).toContain('[truncated]')
  })

  it('tightens further when the full shape still exceeds the budget', () => {
    const fitted = fitJevReviewState({
      request: buildRequest({
        permission: {
          permissionType: 'write',
          paths: ['y'.repeat(200_000)]
        } as ToolPermissionReviewRequest['permission']
      }),
      recentMessages: []
    })

    expect(fitted).not.toBeNull()
    expect(fitted!.shape).not.toBe('full')
    expect(typeof proposedActionOf(fitted!.state).permission).toBe('string')
    expect(fitted!.estimatedTokens).toBeLessThanOrEqual(JEV_REVIEW_MAX_STATE_TOKENS)
  })

  it('reports the shape it settled on so fitting frequency is observable', () => {
    const fitted = fitJevReviewState({
      request: buildRequest(),
      recentMessages: [{ role: 'user', content: 'hello' }]
    })

    expect(fitted?.shape).toBe('full')
    expect(fitted!.estimatedTokens).toBeGreaterThan(0)
  })

  it('does not flag re-encoding the permission payload as truncation', () => {
    // In a tighter shape the permission is re-encoded as JSON. That changes its form, not its content,
    // so it must not refuse auto_allow for every action that happens to carry a permission payload.
    const fitted = fitJevReviewState({
      request: buildRequest({
        permission: {
          permissionType: 'command',
          command: 'git status'
        } as ToolPermissionReviewRequest['permission']
      }),
      recentMessages: []
    })

    expect(fitted?.actionTruncated).toBe(false)
  })

  it('flags a truncated tool argument as an action the reviewer did not fully see', () => {
    // The action executes in full, so a verdict on the first N characters is not a verdict on it.
    const fitted = fitJevReviewState({
      request: buildRequest({ toolArgs: JSON.stringify({ content: 'x'.repeat(20_000) }) }),
      recentMessages: []
    })

    expect(fitted?.actionTruncated).toBe(true)
  })

  it('does not flag an action that fits', () => {
    expect(fitJevReviewState({ request: buildRequest(), recentMessages: [] })?.actionTruncated).toBe(
      false
    )
  })

  it('returns null when even the tightest shape does not fit', () => {
    // The caller must escalate rather than send an oversized request.
    expect(
      fitJevReviewState({
        request: buildRequest(),
        recentMessages: [],
        maxStateTokens: 1
      })
    ).toBeNull()
  })
})
