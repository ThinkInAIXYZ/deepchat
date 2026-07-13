import { describe, expect, it, vi } from 'vitest'

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    send: vi.fn(),
    sendToMain: vi.fn(),
    emit: vi.fn()
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {}
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getLocale: vi.fn(() => 'en-US')
  },
  nativeTheme: {
    shouldUseDarkColors: false
  },
  shell: {
    openPath: vi.fn()
  }
}))

import { ConfigPresenter } from '../../../../src/main/presenter/configPresenter'

describe('ConfigPresenter ACP registry uninstall', () => {
  it('blocks registry uninstall before removing files when sessions remain', async () => {
    const uninstallRegistryAgent = vi.fn().mockResolvedValue(undefined)
    const clearRegistryAcpAgentInstallation = vi.fn()
    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      getRegistryAgentOrThrow: vi.fn(() => ({
        id: 'codex-acp',
        name: 'Codex CLI',
        version: '0.10.0',
        distribution: {}
      })),
      getAgentRepositoryOrThrow: vi.fn(() => ({
        hasAgentSessions: vi.fn(() => true),
        getAgentInstallState: vi.fn(),
        clearRegistryAcpAgentInstallation
      })),
      acpLaunchSpecService: {
        uninstallRegistryAgent,
        selectRegistryDistribution: vi.fn()
      },
      handleAcpAgentsMutated: vi.fn()
    }) as InstanceType<typeof ConfigPresenter> & {
      getRegistryAgentOrThrow: ReturnType<typeof vi.fn>
      getAgentRepositoryOrThrow: ReturnType<typeof vi.fn>
      acpLaunchSpecService: { uninstallRegistryAgent: ReturnType<typeof vi.fn> }
    }

    await expect(presenter.uninstallAcpRegistryAgent('codex-acp')).rejects.toThrow(
      'related conversations'
    )
    expect(uninstallRegistryAgent).not.toHaveBeenCalled()
    expect(clearRegistryAcpAgentInstallation).not.toHaveBeenCalled()
  })
})
