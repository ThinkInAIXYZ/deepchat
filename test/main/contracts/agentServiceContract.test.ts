import { describe, expect, it } from 'vitest'
import {
  AGENT_SERVICE_PROTOCOL_VERSION,
  AgentServiceCapabilitiesSchema,
  AgentServiceErrorSchema,
  AgentServiceIdentitySchema,
  AgentServiceSessionRefSchema,
  AgentServiceSubmissionReceiptSchema,
  defineAgentServiceResultSchema
} from '@shared/contracts/agent-service/common'

const identity = {
  serviceInstanceId: 'service-1',
  protocolVersion: AGENT_SERVICE_PROTOCOL_VERSION,
  implementation: { name: 'deepchat-builtin-service', version: '0.1.0' }
}

const sessionRef = { serviceInstanceId: 'service-1', sessionId: 'session-1' }

const receipt = {
  submissionId: 'submission-1',
  outcome: 'accepted' as const,
  sessionId: 'session-1',
  runId: 'run-1',
  requestId: null,
  messageId: null,
  status: 'generating' as const,
  acceptedAt: 1
}

const resultSchema = defineAgentServiceResultSchema(AgentServiceSessionRefSchema)

describe('agent service base contract', () => {
  it('negotiates the protocol version exactly', () => {
    expect(AgentServiceIdentitySchema.parse(identity)).toEqual(identity)

    expect(() => AgentServiceIdentitySchema.parse({ ...identity, protocolVersion: 2 })).toThrow()
  })

  it('reports capability availability explicitly and rejects ambiguity', () => {
    const capabilities = AgentServiceCapabilitiesSchema.parse([
      { id: 'agent.loop', availability: 'available' },
      {
        id: 'desktop.cua',
        availability: 'unavailable',
        reason: 'requires_desktop_client',
        requiredClient: 'desktop'
      }
    ])

    expect(capabilities).toEqual([
      { id: 'agent.loop', availability: 'available' },
      {
        id: 'desktop.cua',
        availability: 'unavailable',
        reason: 'requires_desktop_client',
        requiredClient: 'desktop'
      }
    ])

    expect(() =>
      AgentServiceCapabilitiesSchema.parse([
        { id: 'agent.loop', availability: 'available' },
        { id: 'agent.loop', availability: 'available' }
      ])
    ).toThrow()
    expect(() =>
      AgentServiceCapabilitiesSchema.parse([{ id: 'agent.loop', availability: 'probably' }])
    ).toThrow()
    expect(() =>
      AgentServiceCapabilitiesSchema.parse([
        { id: 'desktop.cua', availability: 'unavailable', requiredClient: 'desktop' }
      ])
    ).toThrow()
    expect(() =>
      AgentServiceCapabilitiesSchema.parse([
        { id: 'agent.loop', availability: 'available', reason: 'not_supported' }
      ])
    ).toThrow()
    expect(() =>
      AgentServiceCapabilitiesSchema.parse([{ id: 'desktop.telepathy', availability: 'available' }])
    ).toThrow()
  })

  it('expresses results and failures through one discriminated envelope', () => {
    expect(resultSchema.parse({ ok: true, value: sessionRef })).toEqual({
      ok: true,
      value: sessionRef
    })

    expect(
      resultSchema.parse({
        ok: false,
        error: {
          code: 'capability_unavailable',
          message: 'CUA requires a connected Desktop client',
          capability: 'desktop.cua'
        }
      })
    ).toEqual({
      ok: false,
      error: {
        code: 'capability_unavailable',
        message: 'CUA requires a connected Desktop client',
        retriable: false,
        capability: 'desktop.cua'
      }
    })

    expect(() =>
      resultSchema.parse({ ok: false, error: { code: 'telepathy', message: 'no' } })
    ).toThrow()
    expect(() =>
      resultSchema.parse({ ok: true, error: { code: 'internal', message: 'no' } })
    ).toThrow()
    expect(() =>
      resultSchema.parse({
        ok: true,
        value: sessionRef,
        error: { code: 'internal', message: 'no' }
      })
    ).toThrow()
  })

  it('keeps a submission receipt queryable and idempotency-aware', () => {
    expect(AgentServiceSubmissionReceiptSchema.parse(receipt)).toEqual(receipt)
    expect(
      AgentServiceSubmissionReceiptSchema.parse({ ...receipt, outcome: 'duplicate' }).outcome
    ).toBe('duplicate')

    expect(() =>
      AgentServiceSubmissionReceiptSchema.parse({ ...receipt, outcome: 'maybe' })
    ).toThrow()
    expect(() =>
      AgentServiceSubmissionReceiptSchema.parse({ ...receipt, absolutePath: '/tmp/session.db' })
    ).toThrow()
    expect(() =>
      AgentServiceSubmissionReceiptSchema.parse({
        ...receipt,
        abortSignal: {},
        callback: () => undefined
      })
    ).toThrow()
  })

  it('keeps every base DTO cloneable and JSON round-trippable', () => {
    const parsed = [
      AgentServiceIdentitySchema.parse(identity),
      AgentServiceCapabilitiesSchema.parse([{ id: 'agent.loop', availability: 'available' }]),
      AgentServiceErrorSchema.parse({ code: 'internal', message: 'boom' }),
      AgentServiceSessionRefSchema.parse(sessionRef),
      AgentServiceSubmissionReceiptSchema.parse(receipt),
      resultSchema.parse({ ok: true, value: sessionRef }),
      resultSchema.parse({ ok: false, error: { code: 'not_found', message: 'missing' } })
    ]

    for (const value of parsed) {
      expect(structuredClone(value)).toEqual(value)
      expect(JSON.parse(JSON.stringify(value))).toEqual(value)
    }
  })
})
