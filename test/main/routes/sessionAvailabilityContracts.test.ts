import {
  PublicSessionResolutionSchema,
  sessionsGetActiveRoute,
  sessionsListRoute,
  sessionsRestoreRoute
} from '@shared/contracts/routes'

const session = {
  id: 'session-1',
  agentId: 'deepchat',
  title: 'Session',
  projectDir: '/workspace',
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular' as const,
  parentSessionId: null,
  subagentEnabled: false,
  subagentMeta: null,
  createdAt: 1,
  updatedAt: 2,
  status: 'idle' as const,
  providerId: 'openai',
  modelId: 'gpt-5.4'
}

const record = (({ status: _status, providerId: _providerId, modelId: _modelId, ...value }) =>
  value)(session)

describe('public session availability route contracts', () => {
  it.each([
    { availability: 'available', session },
    {
      availability: 'unavailable',
      sessionId: session.id,
      record,
      reason: 'agent_unknown'
    },
    {
      availability: 'transient_error',
      sessionId: session.id,
      record,
      error: {
        code: 'SESSION_RESOLUTION_FAILED',
        stage: 'state_read',
        retryable: true
      }
    },
    { availability: 'missing', sessionId: session.id }
  ])('parses the $availability state', (resolution) => {
    expect(PublicSessionResolutionSchema.parse(resolution)).toEqual(resolution)
  })

  it('rejects malformed discriminated state combinations', () => {
    expect(() =>
      PublicSessionResolutionSchema.parse({
        availability: 'transient_error',
        sessionId: session.id,
        record: null,
        error: {
          code: 'SESSION_RESOLUTION_FAILED',
          stage: 'not_a_stage',
          retryable: false
        }
      })
    ).toThrow()
    expect(() =>
      PublicSessionResolutionSchema.parse({
        availability: 'available',
        sessionId: session.id
      })
    ).toThrow()
  })

  it('keeps an unbound active result distinct from a bound missing result', () => {
    expect(
      sessionsGetActiveRoute.output.parse({ session: null, resolution: null }).resolution
    ).toBeNull()
    expect(
      sessionsGetActiveRoute.output.parse({
        session: null,
        resolution: { availability: 'missing', sessionId: session.id }
      }).resolution
    ).toEqual({ availability: 'missing', sessionId: session.id })
  })

  it('lets captured legacy output schemas ignore the additive fields', () => {
    const legacyRestoreOutput = sessionsRestoreRoute.output.omit({ resolution: true })
    const legacyListOutput = sessionsListRoute.output.omit({ results: true })
    const legacyActiveOutput = sessionsGetActiveRoute.output.omit({ resolution: true })

    expect(
      legacyRestoreOutput.parse({
        session,
        resolution: { availability: 'available', session },
        messages: [],
        nextCursor: null,
        hasMore: false
      })
    ).toEqual({ session, messages: [], nextCursor: null, hasMore: false })
    expect(
      legacyListOutput.parse({
        sessions: [session],
        results: [{ availability: 'available', session }]
      })
    ).toEqual({ sessions: [session] })
    expect(
      legacyActiveOutput.parse({
        session,
        resolution: { availability: 'available', session }
      })
    ).toEqual({ session })
  })

  it('strips raw internal error data from parsed public transient metadata', () => {
    const parsed = PublicSessionResolutionSchema.parse({
      availability: 'transient_error',
      sessionId: session.id,
      record,
      error: {
        code: 'SESSION_RESOLUTION_FAILED',
        stage: 'state_read',
        retryable: true,
        cause: new Error('secret at /private/path'),
        stack: 'secret stack',
        command: 'launch --token secret'
      }
    })

    expect(parsed).toEqual({
      availability: 'transient_error',
      sessionId: session.id,
      record,
      error: {
        code: 'SESSION_RESOLUTION_FAILED',
        stage: 'state_read',
        retryable: true
      }
    })
  })
})
