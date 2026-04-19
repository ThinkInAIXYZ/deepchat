import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_EVENTS } from '../../../src/main/events'

const mocks = vi.hoisted(() => ({
  sendToWebContents: vi.fn()
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    sendToWebContents: mocks.sendToWebContents
  }
}))

const loadModule = async () => await import('../../../src/main/presenter/presenterCallErrorHandler')

describe('presenterCallErrorHandler', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.sendToWebContents.mockReset()
    const { resetPresenterCallErrorStateForTests } = await loadModule()
    resetPresenterCallErrorStateForTests()
  })

  it('sends a database repair suggestion for repairable async schema errors', async () => {
    const { handlePresenterCallResult } = await loadModule()
    const error = new Error(
      'SqliteError: table deepchat_sessions has no column named reasoning_effort'
    )

    await expect(
      handlePresenterCallResult(Promise.reject(error), {
        webContentsId: 7,
        presenterName: 'agentSessionPresenter',
        methodName: 'createSession'
      })
    ).rejects.toThrow(error)

    expect(mocks.sendToWebContents).toHaveBeenCalledWith(
      7,
      NOTIFICATION_EVENTS.DATABASE_REPAIR_SUGGESTED,
      expect.objectContaining({
        reason: 'missing-column',
        dedupeKey: 'missing-column:reasoning_effort'
      })
    )
  })

  it('deduplicates repair suggestions by webContents and schema key', async () => {
    const { handlePresenterCallResult } = await loadModule()
    const errorMessage = 'SqliteError: table deepchat_sessions has no column named reasoning_effort'

    await expect(
      handlePresenterCallResult(Promise.reject(new Error(errorMessage)), {
        webContentsId: 9,
        presenterName: 'agentSessionPresenter',
        methodName: 'createSession'
      })
    ).rejects.toThrow(errorMessage)

    await expect(
      handlePresenterCallResult(Promise.reject(new Error(errorMessage)), {
        webContentsId: 9,
        presenterName: 'agentRuntimePresenter',
        methodName: 'initSession'
      })
    ).rejects.toThrow(errorMessage)

    expect(mocks.sendToWebContents).toHaveBeenCalledTimes(1)
  })

  it('allows suggestions to be re-sent after releasing a webContents state bucket', async () => {
    const { handlePresenterCallResult, releasePresenterCallErrorStateForWebContents } =
      await loadModule()
    const errorMessage = 'SqliteError: table deepchat_sessions has no column named reasoning_effort'

    await expect(
      handlePresenterCallResult(Promise.reject(new Error(errorMessage)), {
        webContentsId: 11,
        presenterName: 'agentSessionPresenter',
        methodName: 'createSession'
      })
    ).rejects.toThrow(errorMessage)

    releasePresenterCallErrorStateForWebContents(11)

    await expect(
      handlePresenterCallResult(Promise.reject(new Error(errorMessage)), {
        webContentsId: 11,
        presenterName: 'agentRuntimePresenter',
        methodName: 'initSession'
      })
    ).rejects.toThrow(errorMessage)

    expect(mocks.sendToWebContents).toHaveBeenCalledTimes(2)
  })

  it('does not send repair suggestions for non-schema async errors', async () => {
    const { handlePresenterCallResult } = await loadModule()

    await expect(
      handlePresenterCallResult(Promise.reject(new Error('network timeout')), {
        webContentsId: 3,
        presenterName: 'configPresenter',
        methodName: 'getProviderModels'
      })
    ).rejects.toThrow('network timeout')

    expect(mocks.sendToWebContents).not.toHaveBeenCalled()
  })
})
