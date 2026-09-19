import { describe, expect, it, vi } from 'vitest'
import { ApprovalBroker } from '@/approval'
import { CliMutationGuard, type CliApprovalPresentationPort } from '@/cli/mutationGuard'
import { CliRequestError } from '@/cli/errors'

const rendererCaller = (webContentsId: number) => ({
  kind: 'renderer' as const,
  webContentsId,
  windowId: 7
})

function createHarness(maxPendingPerScope?: number) {
  const requests: Array<Parameters<CliApprovalPresentationPort['present']>[1]> = []
  const close = vi.fn<CliApprovalPresentationPort['close']>(async () => undefined)
  const presentation: CliApprovalPresentationPort = {
    getTarget: vi.fn(async () => ({ windowId: 7, webContentsId: 70 })),
    present: vi.fn(async (_target, payload) => {
      requests.push(payload)
      return true
    }),
    close
  }
  const approvals = new ApprovalBroker(
    maxPendingPerScope === undefined ? undefined : { maxPendingPerScope }
  )
  const guard = new CliMutationGuard(approvals, presentation)
  const authorize = (signal = new AbortController().signal) =>
    guard.authorize({
      operation: 'skills.installFromUrl',
      effect: 'supply-chain',
      principal: 'human',
      connectionId: 'connection-1',
      clientRequestId: 'client-1',
      arguments: { url: 'https://example.com/skill.git' },
      displayData: { host: 'example.com' },
      signal
    })

  return { approvals, authorize, close, guard, presentation, requests }
}

async function waitForRequests(requests: unknown[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && requests.length < count; attempt += 1) {
    await Promise.resolve()
  }
  expect(requests).toHaveLength(count)
}

describe('CliMutationGuard', () => {
  it('resumes only the exact request resolved by its target renderer', async () => {
    const harness = createHarness()
    const pending = harness.authorize()
    await waitForRequests(harness.requests, 1)
    const requestId = harness.requests[0].requestId
    expect(JSON.stringify(harness.requests[0])).not.toContain('https://example.com/skill.git')

    expect(harness.guard.resolve({ requestId, decision: 'approved' }, rendererCaller(71))).toBe(
      false
    )
    expect(harness.guard.resolve({ requestId, decision: 'approved' }, rendererCaller(70))).toBe(
      true
    )
    await expect(pending).resolves.toEqual({ approvalRequestId: requestId })
    expect(harness.guard.resolve({ requestId, decision: 'approved' }, rendererCaller(70))).toBe(
      false
    )
    expect(harness.close).toHaveBeenCalledWith(
      { windowId: 7, webContentsId: 70 },
      { requestId, reason: 'approved' }
    )
  })

  it('publishes the broker-normalized copy of redacted display data', async () => {
    const harness = createHarness()
    const displayData = { nested: { label: 'safe' } }
    const pending = harness.guard.authorize({
      operation: 'skills.installFromUrl',
      effect: 'supply-chain',
      principal: 'human',
      connectionId: 'connection-1',
      clientRequestId: 'client-1',
      arguments: { url: 'https://example.com/skill.git' },
      displayData,
      signal: new AbortController().signal
    })
    await waitForRequests(harness.requests, 1)
    displayData.nested.label = 'mutated-after-create'
    const requestId = harness.requests[0].requestId

    expect(harness.requests[0].displayData).toEqual({ nested: { label: 'safe' } })
    harness.guard.resolve({ requestId, decision: 'denied' }, rendererCaller(70))
    await expect(pending).rejects.toMatchObject({ code: 'approval_denied' })
  })

  it('does not deduplicate identical concurrent mutations', async () => {
    const harness = createHarness()
    const first = harness.authorize()
    const second = harness.authorize()
    await waitForRequests(harness.requests, 2)
    const firstId = harness.requests[0].requestId
    const secondId = harness.requests[1].requestId

    expect(firstId).not.toBe(secondId)
    expect(
      harness.guard.resolve({ requestId: firstId, decision: 'approved' }, rendererCaller(70))
    ).toBe(true)
    await expect(first).resolves.toEqual({ approvalRequestId: firstId })
    let secondSettled = false
    void second.then(
      () => {
        secondSettled = true
      },
      () => {
        secondSettled = true
      }
    )
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    expect(
      harness.guard.resolve({ requestId: secondId, decision: 'denied' }, rendererCaller(70))
    ).toBe(true)
    await expect(second).rejects.toMatchObject({ code: 'approval_denied' })
  })

  it('limits pending mutations across one CLI connection', async () => {
    const harness = createHarness(1)
    const first = harness.authorize()
    await waitForRequests(harness.requests, 1)

    await expect(harness.authorize()).rejects.toMatchObject({
      code: 'rate_limited',
      httpStatus: 429
    })
    expect(harness.requests).toHaveLength(1)

    const requestId = harness.requests[0].requestId
    harness.guard.resolve({ requestId, decision: 'denied' }, rendererCaller(70))
    await expect(first).rejects.toMatchObject({ code: 'approval_denied' })
  })

  it('fails closed when no trusted renderer is available', async () => {
    const harness = createHarness()
    vi.mocked(harness.presentation.getTarget).mockResolvedValueOnce(null)

    await expect(harness.authorize()).rejects.toMatchObject({
      code: 'unavailable',
      httpStatus: 503
    })
    expect(harness.presentation.present).not.toHaveBeenCalled()
  })

  it('normalizes a pre-aborted signal to the CLI cancellation contract', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    controller.abort()

    await expect(harness.authorize(controller.signal)).rejects.toMatchObject({
      code: 'cancelled'
    })
    expect(harness.presentation.getTarget).not.toHaveBeenCalled()
  })

  it('fails closed when targeted event delivery fails', async () => {
    const harness = createHarness()
    vi.mocked(harness.presentation.present).mockResolvedValueOnce(false)

    await expect(harness.authorize()).rejects.toMatchObject({ code: 'unavailable' })
    expect(harness.close).toHaveBeenCalledWith(
      { windowId: 7, webContentsId: 70 },
      expect.objectContaining({ reason: 'unavailable' })
    )
  })

  it('expires an unanswered request without leaving a replayable approval', async () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      const pending = harness.guard.authorize({
        operation: 'skills.installFromUrl',
        effect: 'supply-chain',
        principal: 'human',
        connectionId: 'connection-1',
        clientRequestId: 'client-1',
        arguments: { url: 'https://example.com/skill.git' },
        displayData: { host: 'example.com' },
        signal: new AbortController().signal,
        timeoutMs: 10
      })
      await waitForRequests(harness.requests, 1)
      const rejection = expect(pending).rejects.toMatchObject({ code: 'approval_timeout' })
      await vi.advanceTimersByTimeAsync(10)

      await rejection
      expect(
        harness.guard.resolve(
          { requestId: harness.requests[0].requestId, decision: 'approved' },
          rendererCaller(70)
        )
      ).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the pending approval when the HTTP request aborts', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    const pending = harness.authorize(controller.signal)
    await waitForRequests(harness.requests, 1)
    controller.abort(new CliRequestError('cancelled', 'Request was cancelled'))

    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(harness.close).toHaveBeenCalledWith(
      { windowId: 7, webContentsId: 70 },
      { requestId: harness.requests[0].requestId, reason: 'cancelled' }
    )
  })

  it('cancels every request owned by a renderer that becomes unavailable', async () => {
    const harness = createHarness()
    const pending = harness.authorize()
    await waitForRequests(harness.requests, 1)

    harness.guard.cancelRenderer(70)

    await expect(pending).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('reports broker shutdown as cancellation rather than a user denial', async () => {
    const harness = createHarness()
    const pending = harness.authorize()
    await waitForRequests(harness.requests, 1)

    harness.guard.clear()

    await expect(pending).rejects.toMatchObject({ code: 'cancelled', retriable: true })
    expect(harness.close).toHaveBeenCalledWith(
      { windowId: 7, webContentsId: 70 },
      { requestId: harness.requests[0].requestId, reason: 'cancelled' }
    )
  })
})
