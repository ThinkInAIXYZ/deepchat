import type { IConfigPresenter, ILlmProviderPresenter } from '@shared/presenter'
import {
  providersAddRoute,
  providersGetAcpProcessConfigOptionsRoute,
  providersGetRateLimitStatusRoute,
  providersListDefaultsRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListRoute,
  providersListSummariesRoute,
  providersPullOllamaModelRoute,
  providersRefreshModelsRoute,
  providersRemoveRoute,
  providersReorderRoute,
  providersSetByIdRoute,
  providersUpdateRoute,
  providersWarmupAcpProcessRoute
} from '@shared/contracts/routes'

export async function dispatchProviderRoute(
  deps: {
    configPresenter: IConfigPresenter
    llmProviderPresenter: ILlmProviderPresenter
  },
  routeName: string,
  rawInput: unknown
): Promise<unknown> {
  const { configPresenter, llmProviderPresenter } = deps
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

    case providersRefreshModelsRoute.name: {
      const input = providersRefreshModelsRoute.input.parse(rawInput)
      await llmProviderPresenter.refreshModels(input.providerId)
      return providersRefreshModelsRoute.output.parse({
        refreshed: true
      })
    }

    case providersListOllamaModelsRoute.name: {
      const input = providersListOllamaModelsRoute.input.parse(rawInput)
      return providersListOllamaModelsRoute.output.parse({
        models: await llmProviderPresenter.listOllamaModels(input.providerId)
      })
    }

    case providersListOllamaRunningModelsRoute.name: {
      const input = providersListOllamaRunningModelsRoute.input.parse(rawInput)
      return providersListOllamaRunningModelsRoute.output.parse({
        models: await llmProviderPresenter.listOllamaRunningModels(input.providerId)
      })
    }

    case providersPullOllamaModelRoute.name: {
      const input = providersPullOllamaModelRoute.input.parse(rawInput)
      return providersPullOllamaModelRoute.output.parse({
        success: await llmProviderPresenter.pullOllamaModels(input.providerId, input.modelName)
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

    default:
      return undefined
  }
}
