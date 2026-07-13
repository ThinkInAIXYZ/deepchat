import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeepChatMessageStore } from '@/presenter/agentRuntimePresenter/messageStore'
import { AgentTapeAccessService } from '@/presenter/agentRuntimePresenter/tapeAccessService'
import type { DeepChatTapeService } from '@/presenter/agentRuntimePresenter/tapeService'

function createTapeService() {
  return {
    ensureSessionTapeReady: vi.fn(),
    info: vi.fn(() => ({ sessionId: 's1' })),
    search: vi.fn(() => [{ entryId: 1 }]),
    getContext: vi.fn(() => ({ sessionId: 's1', entries: [] })),
    anchors: vi.fn(() => [{ entryId: 2 }]),
    handoffResult: vi.fn(() => ({ entryId: 3 })),
    listViewManifestsByMessage: vi.fn(() => [{ entryId: 4 }]),
    exportReplaySlice: vi.fn(() => ({ sliceId: 'slice-1' })),
    recordExternalForkMerge: vi.fn(),
    recordExternalForkDiscard: vi.fn()
  }
}

function expectCalledBefore(first: ReturnType<typeof vi.fn>, second: ReturnType<typeof vi.fn>) {
  expect(first.mock.invocationCallOrder.at(-1)).toBeLessThan(second.mock.invocationCallOrder.at(-1))
}

describe('AgentTapeAccessService', () => {
  let tapeService: ReturnType<typeof createTapeService>
  let messageStore: DeepChatMessageStore
  let service: AgentTapeAccessService

  beforeEach(() => {
    tapeService = createTapeService()
    messageStore = {} as DeepChatMessageStore
    service = new AgentTapeAccessService(
      tapeService as unknown as DeepChatTapeService,
      messageStore
    )
  })

  it('ensures tape readiness before query and replay delegates', async () => {
    const searchOptions = { limit: 5 }
    const contextOptions = { before: 1 }
    const anchorOptions = { limit: 3 }
    const replayOptions = { requestSeq: 2 }

    await expect(service.getTapeInfo('s1')).resolves.toEqual({ sessionId: 's1' })
    expect(tapeService.ensureSessionTapeReady).toHaveBeenLastCalledWith('s1', messageStore)
    expectCalledBefore(tapeService.ensureSessionTapeReady, tapeService.info)

    await expect(service.searchTape('s1', 'needle', searchOptions)).resolves.toEqual([
      { entryId: 1 }
    ])
    expect(tapeService.search).toHaveBeenCalledWith('s1', 'needle', searchOptions)
    expectCalledBefore(tapeService.ensureSessionTapeReady, tapeService.search)

    await service.getTapeContext('s1', [1, 2], contextOptions)
    expect(tapeService.getContext).toHaveBeenCalledWith('s1', [1, 2], contextOptions)
    expectCalledBefore(tapeService.ensureSessionTapeReady, tapeService.getContext)

    await service.listTapeAnchors('s1', anchorOptions)
    expect(tapeService.anchors).toHaveBeenCalledWith('s1', anchorOptions)
    expectCalledBefore(tapeService.ensureSessionTapeReady, tapeService.anchors)

    await service.listMessageViewManifests('s1', 'm1')
    expect(tapeService.listViewManifestsByMessage).toHaveBeenCalledWith('s1', 'm1')
    expectCalledBefore(tapeService.ensureSessionTapeReady, tapeService.listViewManifestsByMessage)

    await service.exportMessageTapeReplaySlice('s1', 'm1', replayOptions)
    expect(tapeService.exportReplaySlice).toHaveBeenCalledWith('s1', 'm1', replayOptions)
    expectCalledBefore(tapeService.ensureSessionTapeReady, tapeService.exportReplaySlice)
  })

  it('ensures readiness before returning a public handoff result', async () => {
    await expect(service.handoffTape('s1', 'phase-done', { summary: 'done' })).resolves.toEqual({
      entryId: 3
    })

    expect(tapeService.handoffResult).toHaveBeenCalledWith('s1', 'phase-done', {
      summary: 'done'
    })
    expectCalledBefore(tapeService.ensureSessionTapeReady, tapeService.handoffResult)
  })

  it('ensures parent then child before recording a subagent merge', async () => {
    await service.mergeSubagentTape('parent', 'child', { outcome: 'done' })

    expect(tapeService.ensureSessionTapeReady.mock.calls).toEqual([
      ['parent', messageStore],
      ['child', messageStore]
    ])
    expect(tapeService.recordExternalForkMerge).toHaveBeenCalledWith('parent', 'child', 'child', {
      outcome: 'done'
    })
    expectCalledBefore(tapeService.ensureSessionTapeReady, tapeService.recordExternalForkMerge)
  })

  it('ensures only the parent before recording a subagent discard', async () => {
    await service.discardSubagentTape('parent', 'child', { reason: 'abandoned' })

    expect(tapeService.ensureSessionTapeReady).toHaveBeenCalledTimes(1)
    expect(tapeService.ensureSessionTapeReady).toHaveBeenCalledWith('parent', messageStore)
    expect(tapeService.recordExternalForkDiscard).toHaveBeenCalledWith('parent', 'child', 'child', {
      reason: 'abandoned'
    })
  })

  it('ensures readiness before surfacing replay option validation errors', async () => {
    tapeService.exportReplaySlice.mockImplementation(() => {
      throw new Error('requestSeq must be a positive integer.')
    })

    await expect(
      service.exportMessageTapeReplaySlice('s1', 'm1', { requestSeq: 0 })
    ).rejects.toThrow('requestSeq must be a positive integer.')
    expect(tapeService.ensureSessionTapeReady).toHaveBeenCalledWith('s1', messageStore)
    expectCalledBefore(tapeService.ensureSessionTapeReady, tapeService.exportReplaySlice)
  })
})
