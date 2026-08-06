import { describe, expect, it, vi } from 'vitest'
import {
  coordinateApplicationDataReset,
  type ApplicationDataResetDependencies
} from '@/app/applicationDataReset'
import type { CliLauncherStatus } from '@/cli/launcherService'

const INSTALLED_STATUS: CliLauncherStatus = {
  state: 'installed',
  reason: null,
  commandPath: '/home/user/.local/bin/deepchat',
  shellConfigPath: '/home/user/.profile'
}

function createDependencies(
  status: CliLauncherStatus = INSTALLED_STATUS
): ApplicationDataResetDependencies & {
  cliLauncher: {
    getStatus: ReturnType<typeof vi.fn>
    removeOwnedLauncher: ReturnType<typeof vi.fn>
  }
  logger: { warn: ReturnType<typeof vi.fn> }
  stop: ReturnType<typeof vi.fn>
  resetDataByType: ReturnType<typeof vi.fn>
} {
  return {
    cliLauncher: {
      getStatus: vi.fn().mockResolvedValue(status),
      removeOwnedLauncher: vi.fn().mockResolvedValue({
        ...status,
        state: 'not-installed',
        reason: null
      })
    },
    logger: { warn: vi.fn() },
    stop: vi.fn().mockResolvedValue(undefined),
    resetDataByType: vi.fn().mockResolvedValue(undefined)
  }
}

describe('coordinateApplicationDataReset', () => {
  it('stops runtimes before removing an owned launcher and resetting all data', async () => {
    const dependencies = createDependencies()

    await coordinateApplicationDataReset('all', dependencies)

    expect(dependencies.stop).toHaveBeenCalledOnce()
    expect(dependencies.cliLauncher.getStatus).toHaveBeenCalledOnce()
    expect(dependencies.cliLauncher.removeOwnedLauncher).toHaveBeenCalledOnce()
    expect(dependencies.resetDataByType).toHaveBeenCalledWith('all')
    expect(dependencies.stop.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.cliLauncher.getStatus.mock.invocationCallOrder[0]
    )
    expect(dependencies.cliLauncher.removeOwnedLauncher.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.resetDataByType.mock.invocationCallOrder[0]
    )
  })

  it('preserves a conflicting launcher without blocking a full data reset', async () => {
    const dependencies = createDependencies({
      ...INSTALLED_STATUS,
      state: 'conflict',
      reason: 'command-modified'
    })

    await expect(coordinateApplicationDataReset('all', dependencies)).resolves.toBeUndefined()

    expect(dependencies.cliLauncher.removeOwnedLauncher).not.toHaveBeenCalled()
    expect(dependencies.logger.warn).toHaveBeenCalledWith(
      '[CLI] Launcher cleanup did not complete during full data reset',
      { reason: 'command-modified' }
    )
    expect(dependencies.resetDataByType).toHaveBeenCalledWith('all')
  })

  it('continues resetting when launcher inspection or removal fails', async () => {
    const inspectionFailure = createDependencies()
    inspectionFailure.cliLauncher.getStatus.mockRejectedValueOnce(
      Object.assign(new Error('sensitive path'), { code: 'EACCES' })
    )

    await coordinateApplicationDataReset('all', inspectionFailure)

    expect(inspectionFailure.cliLauncher.removeOwnedLauncher).not.toHaveBeenCalled()
    expect(inspectionFailure.logger.warn).toHaveBeenCalledWith(
      '[CLI] Launcher cleanup did not complete during full data reset',
      { reason: 'status-inspection-failed', errorCode: 'EACCES' }
    )
    expect(JSON.stringify(inspectionFailure.logger.warn.mock.calls[0])).not.toContain(
      'sensitive path'
    )
    expect(inspectionFailure.resetDataByType).toHaveBeenCalledWith('all')

    const removalFailure = createDependencies()
    removalFailure.cliLauncher.removeOwnedLauncher.mockRejectedValueOnce(
      Object.assign(new Error('sensitive path'), { code: 'EPERM' })
    )

    await coordinateApplicationDataReset('all', removalFailure)

    expect(removalFailure.logger.warn).toHaveBeenCalledWith(
      '[CLI] Launcher cleanup did not complete during full data reset',
      { reason: 'launcher-removal-failed', errorCode: 'EPERM' }
    )
    expect(removalFailure.resetDataByType).toHaveBeenCalledWith('all')
  })

  it('does not let diagnostic failures block reset and stops before touching reset state', async () => {
    const diagnosticFailure = createDependencies({
      ...INSTALLED_STATUS,
      state: 'conflict',
      reason: 'ownership-marker-invalid'
    })
    diagnosticFailure.logger.warn.mockImplementationOnce(() => {
      throw new Error('logger unavailable')
    })

    await expect(coordinateApplicationDataReset('all', diagnosticFailure)).resolves.toBeUndefined()
    expect(diagnosticFailure.resetDataByType).toHaveBeenCalledWith('all')

    const stopFailure = createDependencies()
    stopFailure.stop.mockRejectedValueOnce(new Error('shutdown failed'))

    await expect(coordinateApplicationDataReset('all', stopFailure)).rejects.toThrow(
      'shutdown failed'
    )
    expect(stopFailure.cliLauncher.getStatus).not.toHaveBeenCalled()
    expect(stopFailure.cliLauncher.removeOwnedLauncher).not.toHaveBeenCalled()
    expect(stopFailure.resetDataByType).not.toHaveBeenCalled()
  })

  it('does not inspect or remove the launcher for partial resets', async () => {
    const dependencies = createDependencies()

    await coordinateApplicationDataReset('chat', dependencies)

    expect(dependencies.cliLauncher.getStatus).not.toHaveBeenCalled()
    expect(dependencies.cliLauncher.removeOwnedLauncher).not.toHaveBeenCalled()
    expect(dependencies.resetDataByType).toHaveBeenCalledWith('chat')
  })
})
