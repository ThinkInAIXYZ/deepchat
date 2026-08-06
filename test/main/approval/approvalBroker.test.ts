import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalBroker, ApprovalCapacityError, type ApprovalEvent } from '@/approval'

const binding = (argumentsValue: unknown, scopeKey = 'scope-1') => ({
  domain: 'test',
  scopeKey,
  operation: 'resource.update',
  effect: 'write',
  bindingKey: 'resource-1',
  arguments: argumentsValue,
  metadata: { privateValue: 'metadata-secret' }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ApprovalBroker', () => {
  it('deduplicates canonical pending bindings and consumes approval exactly once', () => {
    const broker = new ApprovalBroker()
    const first = broker.create(binding({ z: 1, a: 2 }), {
      deduplicatePending: true,
      includeArgumentsPreview: true
    })
    const second = broker.create(binding({ a: 2, z: 1 }), {
      deduplicatePending: true,
      includeArgumentsPreview: true
    })

    expect(second.requestId).toBe(first.requestId)
    expect(first.argumentsPreview).toBe('{"a":2,"z":1}')
    expect(
      broker.resolve({
        requestId: first.requestId,
        scopeKey: first.scopeKey,
        decision: 'approved'
      })
    ).toBe(true)

    const match = {
      domain: first.domain,
      scopeKey: first.scopeKey,
      operation: first.operation,
      effect: first.effect,
      bindingKey: 'resource-1',
      arguments: { a: 2, z: 1 }
    }
    expect(broker.consumeApproved(match)).toBe(true)
    expect(broker.consumeApproved(match)).toBe(false)
  })

  it('keeps identical non-deduplicated approvals isolated', () => {
    const broker = new ApprovalBroker()
    const first = broker.create(binding({ value: 1 }))
    const second = broker.create(binding({ value: 1 }))

    expect(first.requestId).not.toBe(second.requestId)
    expect(
      broker.resolve({
        requestId: first.requestId,
        scopeKey: first.scopeKey,
        decision: 'approved'
      })
    ).toBe(true)
    expect(
      broker.consumeApproved({
        requestId: second.requestId,
        domain: second.domain,
        scopeKey: second.scopeKey,
        operation: second.operation,
        effect: second.effect,
        bindingKey: 'resource-1',
        arguments: { value: 1 }
      })
    ).toBe(false)
    broker.clear()
  })

  it('settles every waiter before removing consume-on-approve entries', async () => {
    const broker = new ApprovalBroker()
    const first = broker.create(binding({ value: 1 }), {
      deduplicatePending: true,
      consumeOnApprove: true
    })
    const second = broker.create(binding({ value: 1 }), {
      deduplicatePending: true,
      consumeOnApprove: true
    })
    const firstDecision = broker.wait(first.requestId)
    const secondDecision = broker.wait(second.requestId)

    expect(
      broker.resolve({
        requestId: first.requestId,
        scopeKey: first.scopeKey,
        decision: 'approved'
      })
    ).toBe(true)
    await expect(firstDecision).resolves.toEqual({ allowed: true })
    await expect(secondDecision).resolves.toEqual({ allowed: true })
    expect(
      broker.resolve({
        requestId: first.requestId,
        scopeKey: first.scopeKey,
        decision: 'approved'
      })
    ).toBe(false)
  })

  it('settles timeout and abort without leaving resolvable requests', async () => {
    vi.useFakeTimers()
    const broker = new ApprovalBroker({ defaultTimeoutMs: 50 })
    const timed = broker.create(binding({ value: 1 }))
    const timedDecision = broker.wait(timed.requestId)
    await vi.advanceTimersByTimeAsync(50)
    await expect(timedDecision).resolves.toEqual({ allowed: false, reason: 'timeout' })

    const controller = new AbortController()
    const aborted = broker.create(binding({ value: 2 }))
    const abortedDecision = broker.wait(aborted.requestId, controller.signal)
    controller.abort()
    await expect(abortedDecision).resolves.toEqual({ allowed: false, reason: 'cancelled' })
    expect(
      broker.resolve({
        requestId: aborted.requestId,
        scopeKey: aborted.scopeKey,
        decision: 'approved'
      })
    ).toBe(false)
  })

  it('cancels only the selected scope and enforces its pending limit', async () => {
    const broker = new ApprovalBroker({ maxPendingPerScope: 1 })
    const first = broker.create(binding({ value: 1 }, 'scope-a'))
    const other = broker.create(binding({ value: 1 }, 'scope-b'))
    const firstDecision = broker.wait(first.requestId)

    expect(() => broker.create(binding({ value: 2 }, 'scope-a'))).toThrow(ApprovalCapacityError)
    broker.cancelScope('scope-a')
    await expect(firstDecision).resolves.toEqual({ allowed: false, reason: 'cancelled' })
    expect(
      broker.resolve({
        requestId: other.requestId,
        scopeKey: other.scopeKey,
        decision: 'approved'
      })
    ).toBe(true)
    broker.clear()
  })

  it('clears one adapter domain without cancelling another', async () => {
    const broker = new ApprovalBroker()
    const tool = broker.create(binding({ value: 1 }))
    const cli = broker.create({
      ...binding({ value: 1 }),
      domain: 'cli-mutation',
      bindingKey: 'cli-request-1'
    })
    const toolDecision = broker.wait(tool.requestId)
    const cliDecision = broker.wait(cli.requestId)

    broker.clearDomain('test')
    await expect(toolDecision).resolves.toEqual({ allowed: false, reason: 'cancelled' })
    expect(
      broker.resolve({
        requestId: cli.requestId,
        scopeKey: cli.scopeKey,
        decision: 'approved'
      })
    ).toBe(true)
    await expect(cliDecision).resolves.toEqual({ allowed: true })
    broker.clear()
  })

  it('publishes only explicitly redacted display data', async () => {
    const broker = new ApprovalBroker()
    const events: ApprovalEvent[] = []
    broker.subscribe((event) => events.push(event))
    const pending = broker.create({
      ...binding({ credential: 'argument-secret' }),
      redactedDisplayData: { title: 'Update provider credential', providerId: 'provider-1' }
    })
    await Promise.resolve()

    const serializedEvent = JSON.stringify(events[0])
    expect(serializedEvent).toContain('Update provider credential')
    expect(serializedEvent).not.toContain('argument-secret')
    expect(serializedEvent).not.toContain('metadata-secret')
    expect(events[0]).toMatchObject({
      type: 'created',
      approval: {
        requestId: pending.requestId,
        argumentsHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    })
    expect(events[0]?.approval).not.toHaveProperty('argumentsPreview')
    broker.clear()
  })

  it('rejects cyclic arguments before allocating a request', () => {
    const broker = new ApprovalBroker()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(() => broker.create(binding(cyclic))).toThrow('must not contain cycles')
  })
})
