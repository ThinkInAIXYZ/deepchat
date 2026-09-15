import { describe, expect, it } from 'vitest'
import {
  AGENT_SERVICE_CAPABILITIES,
  AGENT_SERVICE_ERROR_CODES,
  AGENT_SERVICE_ERROR_CODE_TO_LOCAL_CONTROL_CODE,
  AGENT_SERVICE_ERROR_DETAILS_MAX_KEYS,
  AGENT_SERVICE_ERROR_DETAIL_KEY_MAX_LENGTH,
  AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES,
  AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH,
  AGENT_SERVICE_ERROR_MESSAGE_MAX_LENGTH,
  AGENT_SERVICE_PROTOCOL_VERSION,
  AgentServiceCapabilitiesSchema,
  AgentServiceErrorSchema,
  AgentServiceIdentitySchema,
  AgentServiceSessionRefSchema,
  AgentServiceSubmissionReceiptSchema,
  defineAgentServiceResultSchema
} from '@shared/contracts/agent-service/common'
import type { JsonValue } from '@shared/contracts/json'
import { LOCAL_CONTROL_ERROR_CODES } from '@shared/contracts/localControl'

// Fixed literals on purpose: these sets are the wire vocabulary, so a silent addition, removal, or
// rename must fail this suite instead of agreeing with whatever the module exports.
const EXPECTED_CAPABILITY_IDS = [
  'provider.model_request',
  'agent.loop',
  'session.persistence',
  'session.events',
  'tools.builtin',
  'tools.mcp',
  'tools.process',
  'tools.file',
  'skills',
  'memory',
  'media.ocr',
  'media.voice',
  'desktop.cua',
  'desktop.browser_preview',
  'desktop.native_window'
] as const

const EXPECTED_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'duplicate_submission',
  'capability_unavailable',
  'service_unavailable',
  'internal'
] as const

const EXPECTED_LOCAL_CONTROL_MAPPING = {
  invalid_request: 'invalid_request',
  unauthorized: 'authentication_failed',
  forbidden: 'permission_denied',
  not_found: 'not_found',
  conflict: 'conflict',
  duplicate_submission: 'conflict',
  capability_unavailable: 'unavailable',
  service_unavailable: 'unavailable',
  internal: 'internal_error'
} as const

const NON_CAPABILITY_ERROR_CODES = EXPECTED_ERROR_CODES.filter(
  (code) => code !== 'capability_unavailable'
)

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

const desktopCuaUnavailable = {
  id: 'desktop.cua',
  availability: 'unavailable',
  reason: 'requires_desktop_client',
  requiredClient: 'desktop'
}

const desktopCuaAvailable = { id: 'desktop.cua', availability: 'available' }

// The service states the availability of every declared capability; a fixture only overrides the
// entries a case wants to change. Overrides stay loosely typed so invalid shapes remain constructible.
const capabilitySet = (overrides: Record<string, unknown> = {}): unknown[] =>
  EXPECTED_CAPABILITY_IDS.map((id) => overrides[id] ?? { id, availability: 'available' })

const capabilityUnavailableError = {
  code: 'capability_unavailable',
  message: 'CUA requires a connected Desktop client',
  capability: 'desktop.cua',
  requiredClient: 'desktop'
}

const nestedDetailValue = (levels: number): JsonValue =>
  levels <= 1 ? 'leaf' : { child: nestedDetailValue(levels - 1) }

const detailKeys = (count: number): Record<string, number> =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`key${index}`, index]))

const parseError = (error: unknown) => AgentServiceErrorSchema.safeParse(error).success

const resultSchema = defineAgentServiceResultSchema(AgentServiceSessionRefSchema)

describe('agent service base contract', () => {
  it('negotiates the protocol version exactly', () => {
    expect(AGENT_SERVICE_PROTOCOL_VERSION).toBe(1)
    expect(AgentServiceIdentitySchema.parse(identity)).toEqual(identity)

    expect(() => AgentServiceIdentitySchema.parse({ ...identity, protocolVersion: 2 })).toThrow()
  })

  it('freezes the capability and error code vocabulary', () => {
    expect(AGENT_SERVICE_CAPABILITIES).toEqual(EXPECTED_CAPABILITY_IDS)
    expect(AGENT_SERVICE_ERROR_CODES).toEqual(EXPECTED_ERROR_CODES)
  })

  it('maps every error code onto a maintained local-control code', () => {
    expect(AGENT_SERVICE_ERROR_CODE_TO_LOCAL_CONTROL_CODE).toEqual(EXPECTED_LOCAL_CONTROL_MAPPING)
    expect(Object.keys(AGENT_SERVICE_ERROR_CODE_TO_LOCAL_CONTROL_CODE)).toEqual(
      EXPECTED_ERROR_CODES
    )

    for (const code of Object.values(AGENT_SERVICE_ERROR_CODE_TO_LOCAL_CONTROL_CODE)) {
      expect(LOCAL_CONTROL_ERROR_CODES).toContain(code)
    }
  })

  it('reports capability availability explicitly and rejects ambiguity', () => {
    const parsed = AgentServiceCapabilitiesSchema.parse(
      capabilitySet({ 'desktop.cua': desktopCuaUnavailable })
    )

    expect(parsed).toHaveLength(EXPECTED_CAPABILITY_IDS.length)
    expect(parsed).toContainEqual({ id: 'agent.loop', availability: 'available' })
    expect(parsed).toContainEqual(desktopCuaUnavailable)

    const cases: Array<[string, unknown[]]> = [
      [
        'unavailable without a reason',
        capabilitySet({
          'desktop.cua': { id: 'desktop.cua', availability: 'unavailable', requiredClient: null }
        })
      ],
      [
        'unavailable without a required client',
        capabilitySet({
          'desktop.cua': {
            id: 'desktop.cua',
            availability: 'unavailable',
            reason: 'requires_desktop_client'
          }
        })
      ],
      [
        'available with an availability reason',
        capabilitySet({
          'desktop.cua': { ...desktopCuaAvailable, reason: 'not_supported' }
        })
      ],
      ['unknown availability', [{ id: 'agent.loop', availability: 'probably' }]],
      [
        'unknown required client',
        capabilitySet({
          'desktop.cua': { ...desktopCuaUnavailable, requiredClient: 'cli' }
        })
      ],
      ['unknown capability id', [{ id: 'desktop.telepathy', availability: 'available' }]]
    ]

    for (const [label, capabilities] of cases) {
      expect(AgentServiceCapabilitiesSchema.safeParse(capabilities).success, label).toBe(false)
    }
  })

  it('fails closed on an empty, partial, duplicated, or oversized capability set', () => {
    expect(AgentServiceCapabilitiesSchema.safeParse([]).success).toBe(false)

    for (const id of EXPECTED_CAPABILITY_IDS) {
      const partial = capabilitySet().filter((entry) => (entry as { id: string }).id !== id)
      expect(AgentServiceCapabilitiesSchema.safeParse(partial).success, id).toBe(false)
    }

    const duplicated = capabilitySet().map((entry) =>
      (entry as { id: string }).id === 'memory'
        ? { id: 'agent.loop', availability: 'available' }
        : entry
    )
    const unknownId = capabilitySet().map((entry) =>
      (entry as { id: string }).id === 'media.voice'
        ? { id: 'desktop.telepathy', availability: 'available' }
        : entry
    )
    const oversized = [...capabilitySet(), { id: 'agent.loop', availability: 'available' }]

    expect(oversized).toHaveLength(EXPECTED_CAPABILITY_IDS.length + 1)
    expect(AgentServiceCapabilitiesSchema.safeParse(duplicated).success).toBe(false)
    expect(AgentServiceCapabilitiesSchema.safeParse(unknownId).success).toBe(false)
    expect(AgentServiceCapabilitiesSchema.safeParse(oversized).success).toBe(false)
    expect(
      AgentServiceCapabilitiesSchema.safeParse(
        capabilitySet({ 'desktop.cua': desktopCuaUnavailable })
      ).success
    ).toBe(true)
  })

  it('requires the missing capability and required client for capability_unavailable', () => {
    expect(AgentServiceErrorSchema.parse(capabilityUnavailableError)).toEqual({
      ...capabilityUnavailableError,
      retriable: false
    })
    expect(
      AgentServiceErrorSchema.parse({
        code: 'capability_unavailable',
        message: 'MCP host is not configured',
        capability: 'tools.mcp',
        requiredClient: null
      })
    ).toEqual({
      code: 'capability_unavailable',
      message: 'MCP host is not configured',
      capability: 'tools.mcp',
      requiredClient: null,
      retriable: false
    })

    const cases: Array<[string, unknown]> = [
      [
        'no capability named',
        {
          code: 'capability_unavailable',
          message: 'no capability named',
          requiredClient: 'desktop'
        }
      ],
      [
        'no required client named',
        {
          code: 'capability_unavailable',
          message: 'no required client named',
          capability: 'desktop.cua'
        }
      ],
      [
        'unknown capability',
        {
          code: 'capability_unavailable',
          message: 'unknown capability',
          capability: 'desktop.telepathy',
          requiredClient: null
        }
      ],
      [
        'unknown required client',
        {
          code: 'capability_unavailable',
          message: 'unknown required client',
          capability: 'desktop.cua',
          requiredClient: 'cli'
        }
      ]
    ]

    for (const [label, error] of cases) {
      expect(parseError(error), label).toBe(false)
    }
  })

  it('rejects capability fields on any other error code', () => {
    for (const code of NON_CAPABILITY_ERROR_CODES) {
      expect(AgentServiceErrorSchema.parse({ code, message: 'plain failure' })).toEqual({
        code,
        message: 'plain failure',
        retriable: false
      })
      expect(parseError({ code, message: 'no', capability: 'desktop.cua' }), code).toBe(false)
      expect(parseError({ code, message: 'no', requiredClient: 'desktop' }), code).toBe(false)
      expect(parseError({ code, message: 'no', requiredClient: null }), code).toBe(false)
    }
  })

  it('bounds the error message and rejects unknown envelope fields', () => {
    expect(AGENT_SERVICE_ERROR_MESSAGE_MAX_LENGTH).toBe(4096)

    expect(AgentServiceErrorSchema.parse({ code: 'internal', message: 'boom' })).toEqual({
      code: 'internal',
      message: 'boom',
      retriable: false
    })
    expect(
      AgentServiceErrorSchema.parse({
        code: 'internal',
        message: 'x'.repeat(AGENT_SERVICE_ERROR_MESSAGE_MAX_LENGTH)
      }).message
    ).toHaveLength(AGENT_SERVICE_ERROR_MESSAGE_MAX_LENGTH)

    const cases: Array<[string, unknown]> = [
      ['unknown code', { code: 'telepathy', message: 'no' }],
      ['blank message', { code: 'internal', message: '' }],
      ['whitespace-only message', { code: 'internal', message: '   ' }],
      [
        'over-long message',
        { code: 'internal', message: 'x'.repeat(AGENT_SERVICE_ERROR_MESSAGE_MAX_LENGTH + 1) }
      ],
      ['claimed principal', { code: 'internal', message: 'no', principal: 'human' }],
      ['claimed renderer', { code: 'internal', message: 'no', renderer: true }],
      ['non-boolean retriable', { code: 'internal', message: 'no', retriable: 'yes' }]
    ]

    for (const [label, error] of cases) {
      expect(parseError(error), label).toBe(false)
    }
  })

  it('bounds error details instead of passing host internals through', () => {
    expect(AGENT_SERVICE_ERROR_DETAILS_MAX_KEYS).toBe(8)
    expect(AGENT_SERVICE_ERROR_DETAIL_KEY_MAX_LENGTH).toBe(128)
    expect(AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH).toBe(4)
    expect(AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES).toBe(1024)

    const details = {
      attempt: 1,
      retriable: true,
      provider: { id: 'openai', model: 'gpt-4o' }
    }
    expect(AgentServiceErrorSchema.parse({ code: 'internal', message: 'boom', details })).toEqual({
      code: 'internal',
      message: 'boom',
      retriable: false,
      details
    })

    expect(parseError({ code: 'internal', message: 'boom', details: detailKeys(8) })).toBe(true)
    expect(parseError({ code: 'internal', message: 'boom', details: detailKeys(9) })).toBe(false)

    const cases: Array<[string, unknown]> = [
      ['absolute-path key', { '/tmp/deepchat/session.db': 'locked' }],
      ['over-long key', { ['x'.repeat(AGENT_SERVICE_ERROR_DETAIL_KEY_MAX_LENGTH + 1)]: 'over' }],
      ['snake-case credential key', { access_token: 'redacted' }],
      ['camel-case credential key', { apiKey: 'redacted' }],
      ['request header key', { Authorization: 'redacted' }],
      ['credential-store key', { safeStorageCredential: 'redacted' }],
      ['path key', { path: '/tmp/deepchat/session.db' }],
      ['handle key', { processHandle: 42 }],
      ['runtime object key', { abortSignal: {} }],
      ['callback key', { callback: 'onDone' }],
      [
        'value deeper than the depth budget',
        { context: nestedDetailValue(AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH + 1) }
      ],
      [
        'value larger than the size budget',
        { excerpt: 'x'.repeat(AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES) }
      ],
      ['non-JSON value', { when: new Date(0) }]
    ]

    for (const [label, detail] of cases) {
      expect(parseError({ code: 'internal', message: 'boom', details: detail }), label).toBe(false)
    }

    expect(
      parseError({
        code: 'internal',
        message: 'boom',
        details: { context: nestedDetailValue(AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH) }
      })
    ).toBe(true)
    expect(
      parseError({
        code: 'internal',
        message: 'boom',
        details: { excerpt: 'x'.repeat(AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES / 2) }
      })
    ).toBe(true)
  })

  it('expresses results and failures through one discriminated envelope', () => {
    expect(resultSchema.parse({ ok: true, value: sessionRef })).toEqual({
      ok: true,
      value: sessionRef
    })

    expect(resultSchema.parse({ ok: false, error: capabilityUnavailableError })).toEqual({
      ok: false,
      error: { ...capabilityUnavailableError, retriable: false }
    })

    expect(() =>
      resultSchema.parse({
        ok: false,
        error: { code: 'capability_unavailable', message: 'no capability named' }
      })
    ).toThrow()
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
      AgentServiceCapabilitiesSchema.parse(capabilitySet({ 'desktop.cua': desktopCuaUnavailable })),
      AgentServiceErrorSchema.parse({ code: 'internal', message: 'boom' }),
      AgentServiceErrorSchema.parse({
        code: 'internal',
        message: 'boom',
        retriable: true,
        details: { attempt: 2, provider: { id: 'openai', nested: { model: 'gpt-4o' } } }
      }),
      AgentServiceErrorSchema.parse(capabilityUnavailableError),
      AgentServiceErrorSchema.parse({
        code: 'capability_unavailable',
        message: 'MCP host is not configured',
        capability: 'tools.mcp',
        requiredClient: null,
        details: { serverId: 'mcp-1' }
      }),
      AgentServiceSessionRefSchema.parse(sessionRef),
      AgentServiceSubmissionReceiptSchema.parse(receipt),
      resultSchema.parse({ ok: true, value: sessionRef }),
      resultSchema.parse({ ok: false, error: capabilityUnavailableError }),
      resultSchema.parse({
        ok: false,
        error: {
          code: 'duplicate_submission',
          message: 'submission-1 already accepted',
          details: { submissionId: 'submission-1' }
        }
      })
    ]

    for (const value of parsed) {
      expect(structuredClone(value)).toEqual(value)
      expect(JSON.parse(JSON.stringify(value))).toEqual(value)
    }
  })
})
