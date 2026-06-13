import type { IConfigPresenter, ILlmProviderPresenter } from '@shared/presenter'
import {
  providersAddRoute,
  providersGetAcpProcessConfigOptionsRoute,
  providersGetEmbeddingDimensionsRoute,
  providersGetKeyStatusRoute,
  providersGetRateLimitStatusRoute,
  providersImportApplyRoute,
  providersImportScanRoute,
  providersListDefaultsRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListRoute,
  providersListSummariesRoute,
  providersPullOllamaModelRoute,
  providersRefreshModelsRoute,
  providersRemoveRoute,
  providersReorderRoute,
  providersRunAcpDebugActionRoute,
  providersSetByIdRoute,
  providersSyncModelScopeMcpServersRoute,
  providersUpdateRoute,
  providersUpdateRateLimitRoute,
  providersWarmupAcpProcessRoute
} from '@shared/contracts/routes'
import type { ProviderImportService } from './providerImportService'

export async function dispatchProviderRoute(
  deps: {
    configPresenter: IConfigPresenter
    llmProviderPresenter: ILlmProviderPresenter
    providerImportService: ProviderImportService
  },
  routeName: string,
  rawInput: unknown,
  context?: {
    webContentsId: number
  }
): Promise<unknown> {
  const { configPresenter, llmProviderPresenter, providerImportService } = deps
  const toProviderSummary = (provider: ReturnType<typeof configPresenter.getProviders>[number]) => {
    const {
      models: _models,
      customModels: _customModels,
      enabledModels: _enabledModels,
      disabledModels: _disabledModels,
      ...summary
    } = provider
    return summary
  }

  switch (routeName) {
    case providersListRoute.name: {
      providersListRoute.input.parse(rawInput)
      return providersListRoute.output.parse({
        providers: configPresenter.getProviders()
      })
    }

    case providersListSummariesRoute.name: {
      providersListSummariesRoute.input.parse(rawInput)
      return providersListSummariesRoute.output.parse({
        providers: configPresenter.getProviders().map(toProviderSummary)
      })
    }

    case providersListDefaultsRoute.name: {
      providersListDefaultsRoute.input.parse(rawInput)
      return providersListDefaultsRoute.output.parse({
        providers: configPresenter.getDefaultProviders()
      })
    }

    case providersSetByIdRoute.name: {
      const input = providersSetByIdRoute.input.parse(rawInput)
      configPresenter.setProviderById(input.providerId, input.provider)
      return providersSetByIdRoute.output.parse({
        provider: configPresenter.getProviderById(input.providerId) ?? input.provider
      })
    }

    case providersUpdateRoute.name: {
      const input = providersUpdateRoute.input.parse(rawInput)
      const requiresRebuild = configPresenter.updateProviderAtomic(input.providerId, input.updates)
      return providersUpdateRoute.output.parse({
        provider: configPresenter.getProviderById(input.providerId),
        requiresRebuild
      })
    }

    case providersAddRoute.name: {
      const input = providersAddRoute.input.parse(rawInput)
      configPresenter.addProviderAtomic(input.provider)
      return providersAddRoute.output.parse({
        provider: configPresenter.getProviderById(input.provider.id) ?? input.provider
      })
    }

    case providersRemoveRoute.name: {
      const input = providersRemoveRoute.input.parse(rawInput)
      configPresenter.removeProviderAtomic(input.providerId)
      return providersRemoveRoute.output.parse({
        removed: true
      })
    }

    case providersReorderRoute.name: {
      const input = providersReorderRoute.input.parse(rawInput)
      configPresenter.reorderProvidersAtomic(input.providers)
      return providersReorderRoute.output.parse({
        providers: configPresenter.getProviders()
      })
    }

    case providersGetRateLimitStatusRoute.name: {
      const input = providersGetRateLimitStatusRoute.input.parse(rawInput)
      return providersGetRateLimitStatusRoute.output.parse({
        status: llmProviderPresenter.getProviderRateLimitStatus(input.providerId)
      })
    }

    case providersGetKeyStatusRoute.name: {
      const input = providersGetKeyStatusRoute.input.parse(rawInput)
      return providersGetKeyStatusRoute.output.parse({
        status: await llmProviderPresenter.getKeyStatus(input.providerId)
      })
    }

    case providersUpdateRateLimitRoute.name: {
      const input = providersUpdateRateLimitRoute.input.parse(rawInput)
      llmProviderPresenter.updateProviderRateLimit(input.providerId, input.enabled, input.qpsLimit)
      return providersUpdateRateLimitRoute.output.parse({
        config: llmProviderPresenter.getProviderRateLimitStatus(input.providerId).config
      })
    }

    case providersGetEmbeddingDimensionsRoute.name: {
      const input = providersGetEmbeddingDimensionsRoute.input.parse(rawInput)
      return providersGetEmbeddingDimensionsRoute.output.parse({
        result: await llmProviderPresenter.getDimensions(input.providerId, input.modelId)
      })
    }

    case providersSyncModelScopeMcpServersRoute.name: {
      const input = providersSyncModelScopeMcpServersRoute.input.parse(rawInput)
      return providersSyncModelScopeMcpServersRoute.output.parse({
        result: await llmProviderPresenter.syncModelScopeMcpServers(
          input.providerId,
          input.syncOptions
        )
      })
    }

    case providersRunAcpDebugActionRoute.name: {
      const input = providersRunAcpDebugActionRoute.input.parse(rawInput)
      return providersRunAcpDebugActionRoute.output.parse({
        result: await llmProviderPresenter.runAcpDebugAction({
          ...input,
          webContentsId: context?.webContentsId
        })
      })
    }

    case providersRefreshModelsRoute.name: {
      const input = providersRefreshModelsRoute.input.parse(rawInput)
      await llmProviderPresenter.refreshModels(input.providerId)
      return providersRefreshModelsRoute.output.parse({
        refreshed: true
      })
    }

    case providersListOllamaModelsRoute.name: {
      const input = providersListOllamaModelsRoute.input.parse(rawInput)
      const models = await llmProviderPresenter.listOllamaModels(input.providerId)
      return providersListOllamaModelsRoute.output.parse({
        models
      })
    }

    case providersListOllamaRunningModelsRoute.name: {
      const input = providersListOllamaRunningModelsRoute.input.parse(rawInput)
      const models = await llmProviderPresenter.listOllamaRunningModels(input.providerId)
      return providersListOllamaRunningModelsRoute.output.parse({
        models
      })
    }

    case providersPullOllamaModelRoute.name: {
      const input = providersPullOllamaModelRoute.input.parse(rawInput)
      const success = await llmProviderPresenter.pullOllamaModels(input.providerId, input.modelName)
      return providersPullOllamaModelRoute.output.parse({
        success
      })
    }

    case providersWarmupAcpProcessRoute.name: {
      const input = providersWarmupAcpProcessRoute.input.parse(rawInput)
      await llmProviderPresenter.warmupAcpProcess(input.agentId, input.workdir)
      return providersWarmupAcpProcessRoute.output.parse({
        warmedUp: true
      })
    }

    case providersGetAcpProcessConfigOptionsRoute.name: {
      const input = providersGetAcpProcessConfigOptionsRoute.input.parse(rawInput)
      return providersGetAcpProcessConfigOptionsRoute.output.parse({
        state: await llmProviderPresenter.getAcpProcessConfigOptions(input.agentId, input.workdir)
      })
    }

    case providersImportScanRoute.name: {
      providersImportScanRoute.input.parse(rawInput)
      return providersImportScanRoute.output.parse(await providerImportService.scan())
    }

    case providersImportApplyRoute.name: {
      const input = providersImportApplyRoute.input.parse(rawInput)
      return providersImportApplyRoute.output.parse(providerImportService.apply(input))
    }

    default:
      return undefined
  }
}
