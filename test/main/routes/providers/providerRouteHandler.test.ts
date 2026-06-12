import { describe, expect, it, vi } from 'vitest'
import { dispatchProviderRoute } from '../../../../src/main/routes/providers/providerRouteHandler'
import {
  providersImportApplyRoute,
  providersImportScanRoute
} from '../../../../src/shared/contracts/routes'

describe('dispatchProviderRoute providers.listSummaries', () => {
  it('returns lightweight provider summaries without model arrays', async () => {
    const configPresenter = {
      getProviders: vi.fn(() => [
        {
          id: 'openai',
          name: 'OpenAI',
          apiType: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          enable: true,
          models: [{ id: 'gpt-5.4', name: 'GPT-5.4', group: 'default', providerId: 'openai' }],
          customModels: [{ id: 'custom', name: 'Custom', group: 'custom', providerId: 'openai' }],
          enabledModels: ['gpt-5.4'],
          disabledModels: ['custom']
        }
      ])
    }

    const result = (await dispatchProviderRoute(
      {
        configPresenter: configPresenter as any,
        llmProviderPresenter: {} as any,
        providerImportService: {} as any
      },
      'providers.listSummaries',
      {}
    )) as {
      providers: Array<Record<string, unknown>>
    }

    expect(result.providers).toEqual([
      expect.objectContaining({
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        enable: true
      })
    ])
    expect(result.providers[0]).not.toHaveProperty('models')
    expect(result.providers[0]).not.toHaveProperty('customModels')
    expect(result.providers[0]).not.toHaveProperty('enabledModels')
    expect(result.providers[0]).not.toHaveProperty('disabledModels')
  })
})

describe('dispatchProviderRoute provider import routes', () => {
  it('dispatches scan and apply through ProviderImportService', async () => {
    const providerImportService = {
      scan: vi.fn(() => ({
        sessionId: 'scan-1',
        sourceOrder: ['cc-switch', 'alma', 'cherry-studio', 'hermes', 'openclaw'],
        sources: [],
        providers: []
      })),
      apply: vi.fn(() => ({
        summary: {
          imported: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          overwritten: 0,
          models: 0
        },
        results: []
      }))
    }

    const scanResult = await dispatchProviderRoute(
      {
        configPresenter: {} as any,
        llmProviderPresenter: {} as any,
        providerImportService: providerImportService as any
      },
      providersImportScanRoute.name,
      {}
    )
    const applyInput = {
      sessionId: 'scan-1',
      selections: [
        {
          sourceId: 'hermes',
          providerIds: ['hermes:openai'],
          providerOptions: {
            'hermes:openai': {
              targetApiType: 'anthropic'
            }
          }
        }
      ]
    }
    const applyResult = await dispatchProviderRoute(
      {
        configPresenter: {} as any,
        llmProviderPresenter: {} as any,
        providerImportService: providerImportService as any
      },
      providersImportApplyRoute.name,
      applyInput
    )

    expect(scanResult).toMatchObject({ sessionId: 'scan-1' })
    expect(applyResult).toMatchObject({ summary: { imported: 0 } })
    expect(providerImportService.scan).toHaveBeenCalledTimes(1)
    expect(providerImportService.apply).toHaveBeenCalledWith(applyInput)
  })
})
