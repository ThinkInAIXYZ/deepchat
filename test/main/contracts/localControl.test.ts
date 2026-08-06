import { describe, expect, it } from 'vitest'
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SURFACE_VERSION,
  LocalControlDescriptorSchema,
  LocalControlRpcRequestSchema,
  LocalControlScopesSchema,
  createLocalControlFailure,
  createLocalControlSuccess
} from '@shared/contracts/localControl'
import { LocalControlCapabilitySchema } from '@shared/contracts/routes'

const validDescriptor = {
  protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
  surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
  appVersion: '1.2.3',
  endpoint: { kind: 'unix', path: '/tmp/deepchat.sock' },
  pid: 42,
  token: 'a'.repeat(43),
  startedAt: 1_000
} as const

const validRpcRequest = {
  protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
  surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
  id: 'request-1',
  method: 'models.invoke',
  params: { prompt: 'hello' }
} as const

describe('local-control contracts', () => {
  it('accepts a bounded private endpoint descriptor', () => {
    expect(LocalControlDescriptorSchema.parse(validDescriptor)).toMatchObject({
      endpoint: { kind: 'unix', path: '/tmp/deepchat.sock' },
      token: 'a'.repeat(43)
    })
  })

  it.each([
    ['unsupported protocol version', { protocolVersion: 2 }],
    [
      'NUL in the endpoint path',
      { endpoint: { kind: 'unix', path: '/tmp/deepchat.sock\0hidden' } }
    ],
    ['non-positive pid', { pid: 0 }],
    ['short token', { token: 'secret' }],
    ['unknown key', { ignored: true }]
  ])('rejects a descriptor with %s', (_label, override) => {
    expect(
      LocalControlDescriptorSchema.safeParse({ ...validDescriptor, ...override }).success
    ).toBe(false)
  })

  it('rejects duplicate scopes and capability callers', () => {
    expect(() => LocalControlScopesSchema.parse(['models:invoke', 'models:invoke'])).toThrow(
      'Duplicate local-control scope'
    )
    expect(() =>
      LocalControlCapabilitySchema.parse({
        method: 'models.invoke',
        possibleEffects: ['compute'],
        callers: ['human', 'human'],
        scopes: ['models:invoke'],
        transport: 'stream',
        approval: 'never',
        maxBodyBytes: 1024,
        timeoutMs: 1000
      })
    ).toThrow('Duplicate local-control caller')
  })

  it('requires versioned JSON RPC requests with domain methods', () => {
    expect(LocalControlRpcRequestSchema.parse(validRpcRequest)).toMatchObject({
      id: 'request-1',
      method: 'models.invoke'
    })
  })

  it.each([
    ['invalid request id', { id: 'request with spaces' }],
    ['non-domain method', { method: 'invoke' }]
  ])('rejects an RPC request with %s', (_label, override) => {
    expect(
      LocalControlRpcRequestSchema.safeParse({ ...validRpcRequest, ...override }).success
    ).toBe(false)
  })

  it('creates stable success and failure envelopes', () => {
    expect(createLocalControlSuccess('request-1', { ready: true })).toEqual({
      protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
      surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
      id: 'request-1',
      ok: true,
      result: { ready: true }
    })
    expect(
      createLocalControlFailure('request-2', {
        code: 'unavailable',
        message: 'Desktop application is not running',
        retriable: true
      })
    ).toMatchObject({
      id: 'request-2',
      ok: false,
      error: { code: 'unavailable', retriable: true }
    })
  })
})
