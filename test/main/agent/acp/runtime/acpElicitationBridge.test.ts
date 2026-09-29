import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpElicitationBridge } from '@/agent/acp/runtime/acpElicitationBridge'
import {
  buildCapabilitySnapshot,
  buildClientCapabilities
} from '@/agent/acp/runtime/acpCapabilities'
import { parseLodyNotification } from '@/agent/acp/runtime/acpLodyExtensions'
import { agent, client, type AnyMessage } from '@agentclientprotocol/sdk'
import { connectAcpClient } from '@/agent/acp/runtime/acpConnection'

const context = (controller = new AbortController(), connectionId = 'connection-a') => ({
  connectionId,
  agentId: 'fixture',
  agentName: 'Fixture',
  conversationId: 'conversation',
  signal: controller.signal
})
const hints = (value: Record<string, unknown>) => ({
  lody: { elicitation: { version: 1, ...value } }
})

afterEach(() => vi.useRealTimers())

describe('ACP rich elicitation contract', () => {
  it('settles the exact SDK request when the peer sends $/cancel_request', async () => {
    const bridge = new AcpElicitationBridge(vi.fn())
    const toAgent = new TransformStream<AnyMessage>()
    const toClient = new TransformStream<AnyMessage>()
    const peer = agent().connect({ readable: toAgent.readable, writable: toClient.writable })
    const connection = connectAcpClient(
      client().onRequest('elicitation/create', ({ params, signal }) =>
        bridge.request(params, context({ signal } as AbortController))
      ),
      { readable: toClient.readable, writable: toAgent.writable }
    )
    const cancelled = new AbortController()
    const response = peer.client.request(
      'elicitation/create',
      { mode: 'form', sessionId: 'remote', message: 'Choose', requestedSchema: {} },
      { cancellationSignal: cancelled.signal }
    )
    await vi.waitFor(() => expect(bridge.list()).toHaveLength(1))
    cancelled.abort()
    expect(await response).toEqual({ action: 'cancel' })
    expect(bridge.list()).toEqual([])
    connection.close()
    peer.close()
  })
  it('returns schema values, independent notes, and a custom answer without persisting private values', async () => {
    const bridge = new AcpElicitationBridge(vi.fn())
    const response = bridge.request(
      {
        mode: 'form',
        sessionId: 'remote',
        message: 'Choose a deployment',
        requestedSchema: {
          type: 'object',
          properties: {
            region: {
              type: 'string',
              oneOf: [
                { const: 'eu', title: 'Europe' },
                { const: 'us', title: 'America' }
              ]
            },
            note: { type: 'string', _meta: hints({ noteFor: 'region', secret: true }) },
            checks: {
              type: 'array',
              items: {
                anyOf: [
                  { const: 'types', title: 'Type check' },
                  { const: 'lint', title: 'Lint' }
                ]
              }
            },
            custom: { type: 'string', _meta: hints({ customAnswerFor: 'checks' }) }
          }
        },
        _meta: hints({
          questions: [
            {
              id: 'region',
              header: 'Region',
              question: 'Where?',
              options: [{ label: 'Europe', preview: 'EU preview' }, { label: 'America' }],
              multiSelect: false,
              note: { fieldId: 'note', isSecret: true }
            },
            {
              id: 'checks',
              header: 'Checks',
              question: 'What checks?',
              options: [],
              multiSelect: true
            }
          ]
        })
      },
      context()
    )
    const request = bridge.list()[0]
    expect(request.fields[0].options?.[0]).toMatchObject({
      value: 'eu',
      title: 'Europe',
      preview: 'EU preview'
    })
    await expect(
      bridge.respond({
        requestId: request.requestId,
        action: 'accept',
        content: { region: 'Europe' }
      })
    ).rejects.toThrow('does not match')
    expect(bridge.list()).toHaveLength(1)
    await expect(
      bridge.respond({
        requestId: request.requestId,
        action: 'accept',
        content: {
          region: 'eu',
          note: 'private rollout note',
          checks: ['types', 'lint'],
          custom: 'Run smoke checks'
        }
      })
    ).resolves.toBe(true)
    expect(await response).toEqual({
      action: 'accept',
      content: { region: 'eu', note: 'private rollout note', custom: 'Run smoke checks' },
      _meta: hints({
        answers: { region: 'eu', note: 'private rollout note', checks: 'Run smoke checks' }
      })
    })
    expect(bridge.list()).toEqual([])
    expect(bridge.redact('connection-a', 'Echo: private rollout note')).toBe('Echo: [redacted]')
    expect(bridge.redact('connection-b', 'Echo: private rollout note')).toBe(
      'Echo: private rollout note'
    )
    await expect(
      bridge.respond({ requestId: request.requestId, action: 'accept', content: {} })
    ).resolves.toBe(false)
    bridge.closeConnection('connection-a')
  })

  it('keeps multi-select arrays and numeric answers in standard content', async () => {
    const bridge = new AcpElicitationBridge(vi.fn())
    const response = bridge.request(
      {
        mode: 'form',
        sessionId: 'remote',
        message: 'Configuration',
        requestedSchema: {
          properties: {
            count: { type: 'integer', minimum: 1 },
            enabled: { type: 'boolean' },
            choices: { type: 'array', items: { enum: ['a,b', 'c'] } }
          },
          required: ['count']
        }
      },
      context()
    )
    const { requestId } = bridge.list()[0]
    await bridge.respond({
      requestId,
      action: 'accept',
      content: { count: 2, enabled: false, choices: ['a,b', 'c'] }
    })
    expect(await response).toEqual({
      action: 'accept',
      content: { count: 2, enabled: false, choices: ['a,b', 'c'] }
    })
  })

  it.each([false, true])(
    'keeps custom answers independent of field order (custom first: %s)',
    async (customFirst) => {
      const bridge = new AcpElicitationBridge(vi.fn())
      const properties = {
        choice: { type: 'string', enum: ['selected'] },
        custom: { type: 'string', _meta: hints({ customAnswerFor: 'choice' }) }
      }
      for (const custom of ['', '  ', 'another answer']) {
        const response = bridge.request(
          {
            mode: 'form',
            sessionId: 'remote',
            message: 'Choose',
            requestedSchema: {
              properties: customFirst
                ? { custom: properties.custom, choice: properties.choice }
                : properties
            },
            _meta: hints({})
          },
          context()
        )
        await bridge.respond({
          requestId: bridge.list()[0].requestId,
          action: 'accept',
          content: { choice: 'selected', custom }
        })
        expect(await response).toMatchObject({
          content: custom.trim() ? { custom } : { choice: 'selected', custom },
          _meta: hints({ answers: { choice: custom.trim() ? custom : 'selected' } })
        })
      }
    }
  )

  it('matches option hints by schema value after unsupported options are omitted', async () => {
    const bridge = new AcpElicitationBridge(vi.fn())
    const response = bridge.request(
      {
        mode: 'form',
        sessionId: 'remote',
        message: 'Choose',
        requestedSchema: {
          properties: {
            choice: {
              type: 'string',
              oneOf: [
                { const: 'unsupported', description: 'Not the retained option' },
                {
                  const: 'retained',
                  title: 'Retained',
                  _meta: hints({ preview: 'Correct preview' })
                }
              ]
            }
          }
        },
        _meta: hints({
          questions: [
            {
              id: 'choice',
              question: 'Choose',
              header: 'Choice',
              multiSelect: false,
              options: [
                { label: 'Unsupported', description: 'Wrong hint' },
                { label: 'Retained', description: 'Correct hint' }
              ]
            }
          ]
        })
      },
      context()
    )
    const request = bridge.list()[0]
    expect(request.fields[0].options).toEqual([
      {
        value: 'retained',
        title: 'Retained',
        description: 'Correct hint',
        preview: 'Correct preview'
      }
    ])
    await bridge.respond({ requestId: request.requestId, action: 'cancel' })
    await response
  })

  it.each([false, true])(
    'expires accepted URL views even if completion is %s',
    async (completed) => {
      vi.useFakeTimers()
      const bridge = new AcpElicitationBridge(vi.fn())
      const response = bridge.request(
        {
          mode: 'url',
          sessionId: 'remote',
          message: 'Sign in',
          elicitationId: 'external',
          url: 'https://example.com'
        },
        context()
      )
      await bridge.respond({ requestId: bridge.list()[0].requestId, action: 'accept' })
      expect(await response).toEqual({ action: 'accept' })
      if (completed) bridge.complete('connection-a', 'external')
      await vi.advanceTimersByTimeAsync(15 * 60_000)
      expect(bridge.list()).toEqual([])
    }
  )

  it('cancels only the owning connection and request, including expired defaults', async () => {
    vi.useFakeTimers()
    const bridge = new AcpElicitationBridge(vi.fn())
    const controller = new AbortController()
    const params = {
      mode: 'form' as const,
      requestId: 7,
      message: 'Confirm',
      requestedSchema: {
        properties: {
          value: { type: 'string' as const, default: 'never auto-submit' }
        }
      },
      _meta: hints({ autoResolveAfterSeconds: 1 })
    }
    const first = bridge.request(params, context(controller))
    const second = bridge.request(params, context(new AbortController(), 'connection-b'))
    controller.abort()
    expect(await first).toEqual({ action: 'cancel' })
    expect(bridge.list()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await second).toEqual({ action: 'cancel' })
    expect(bridge.list()).toEqual([])
  })

  it('waits for URL completion and rejects unsafe URLs and note collisions', async () => {
    const bridge = new AcpElicitationBridge(vi.fn())
    const params = {
      mode: 'url' as const,
      requestId: 1,
      message: 'Sign in',
      elicitationId: 'url-1',
      url: 'https://example.com/login'
    }
    expect(() => bridge.request({ ...params, url: 'file:///etc/passwd' }, context())).toThrow(
      expect.objectContaining({ code: -32602 })
    )
    expect(() => bridge.request({ ...params, url: 'https://[' }, context())).toThrow(
      expect.objectContaining({ code: -32602 })
    )
    expect(() =>
      bridge.request(
        {
          mode: 'form',
          sessionId: 'remote',
          message: 'Invalid',
          requestedSchema: {
            properties: {
              note: { type: 'string', _meta: hints({ noteFor: 'missing' }) }
            }
          }
        },
        context()
      )
    ).toThrow(expect.objectContaining({ code: -32602 }))
    const response = bridge.request(params, context())
    const { requestId } = bridge.list()[0]
    await bridge.respond({ requestId, action: 'accept' })
    expect(await response).toEqual({ action: 'accept' })
    expect(bridge.list()[0].status).toBe('waiting_external')
    bridge.cancelOrigin('connection-a', 1)
    expect(bridge.list()[0].status).toBe('waiting_external')
    bridge.complete('connection-b', 'url-1')
    expect(bridge.list()[0].status).toBe('waiting_external')
    bridge.complete('connection-a', 'url-1')
    expect(bridge.list()[0].status).toBe('completed')
    bridge.closeConnection('connection-a')
    expect(bridge.list()).toEqual([])
  })
})

it('negotiates each Lody capability independently and rejects malformed notifications', () => {
  const snapshot = buildCapabilitySnapshot({
    protocolVersion: 1,
    agentCapabilities: {
      _meta: {
        lody: {
          usage: { version: 2 },
          sessionTitle: { version: 1 },
          steering: {
            version: 1,
            transport: 'request',
            upstreamTurn: 'same',
            configPolicy: 'active'
          },
          subagents: { version: 1, lifecycle: false }
        }
      }
    }
  })
  expect(snapshot.extensions.usage).toBeUndefined()
  expect(snapshot.extensions.subagents).toBeUndefined()
  expect(snapshot.extensions.sessionTitle).toEqual({ version: 1 })
  expect(snapshot.extensions.steering?.transport).toBe('request')
  expect(buildClientCapabilities().elicitation).toBeUndefined()
  expect(buildClientCapabilities({ enableElicitation: true }).elicitation).toEqual({
    form: {},
    url: {}
  })
  expect(
    parseLodyNotification('_lody/session/usage_update', {
      sessionId: 'a',
      usage: { inputTokens: -1 }
    })
  ).toBeNull()
})
