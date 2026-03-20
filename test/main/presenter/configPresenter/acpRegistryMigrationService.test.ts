import { describe, expect, it, vi } from 'vitest'
import { AcpRegistryMigrationService } from '../../../../src/main/presenter/configPresenter/acpRegistryMigrationService'

describe('AcpRegistryMigrationService', () => {
  it('migrates legacy ACP ids in settings and sqlite references once', async () => {
    const settings = new Map<string, unknown>([
      ['acpRegistryMigrationVersion', 0],
      ['defaultModel', { providerId: 'acp', modelId: 'kimi-cli' }],
      ['preferredModel', { providerId: 'acp', modelId: 'claude-code-acp' }]
    ])

    const configPresenter = {
      getSetting: vi.fn((key: string) => settings.get(key)),
      setSetting: vi.fn((key: string, value: unknown) => {
        settings.set(key, value)
      })
    } as any

    const sqlitePresenter = {
      migrateAcpAgentReferences: vi.fn().mockResolvedValue(undefined)
    } as any

    const service = new AcpRegistryMigrationService(configPresenter, sqlitePresenter)
    const changed = await service.runIfNeeded()

    expect(changed).toBe(true)
    expect(settings.get('defaultModel')).toEqual({ providerId: 'acp', modelId: 'kimi' })
    expect(settings.get('preferredModel')).toEqual({
      providerId: 'acp',
      modelId: 'claude-acp'
    })
    expect(sqlitePresenter.migrateAcpAgentReferences).toHaveBeenCalledWith({
      'kimi-cli': 'kimi',
      'claude-code-acp': 'claude-acp',
      'codex-acp': 'codex-acp',
      'dimcode-acp': 'dimcode'
    })
    expect(settings.get('acpRegistryMigrationVersion')).toBe(1)
  })

  it('skips when migration version is already applied', async () => {
    const configPresenter = {
      getSetting: vi.fn().mockReturnValue(1),
      setSetting: vi.fn()
    } as any

    const sqlitePresenter = {
      migrateAcpAgentReferences: vi.fn()
    } as any

    const service = new AcpRegistryMigrationService(configPresenter, sqlitePresenter)

    await expect(service.runIfNeeded()).resolves.toBe(false)
    expect(sqlitePresenter.migrateAcpAgentReferences).not.toHaveBeenCalled()
    expect(configPresenter.setSetting).not.toHaveBeenCalled()
  })

  it('compensates install state for enabled registry agents only', async () => {
    const configPresenter = {
      listAcpRegistryAgents: vi.fn().mockResolvedValue([
        {
          id: 'kimi',
          enabled: true,
          installState: null
        },
        {
          id: 'claude-acp',
          enabled: true,
          installState: {
            status: 'error'
          }
        },
        {
          id: 'codex-acp',
          enabled: true,
          installState: {
            status: 'installed'
          }
        },
        {
          id: 'dimcode',
          enabled: false,
          installState: null
        }
      ]),
      ensureAcpAgentInstalled: vi.fn().mockResolvedValue(undefined)
    } as any

    const sqlitePresenter = {} as any

    const service = new AcpRegistryMigrationService(configPresenter, sqlitePresenter)

    await service.compensateEnabledRegistryAgentInstalls()

    expect(configPresenter.ensureAcpAgentInstalled).toHaveBeenCalledTimes(2)
    expect(configPresenter.ensureAcpAgentInstalled).toHaveBeenNthCalledWith(1, 'kimi')
    expect(configPresenter.ensureAcpAgentInstalled).toHaveBeenNthCalledWith(2, 'claude-acp')
  })
})
