import type { IConfigPresenter, ILlmProviderPresenter } from '@shared/presenter'
import {
  modelsAddCustomRoute,
  modelsExportConfigsRoute,
  modelsGetCapabilitiesRoute,
  modelsGetConfigRoute,
  modelsGetProviderCatalogRoute,
  modelsGetProviderConfigsRoute,
  modelsHasUserConfigRoute,
  modelsImportConfigsRoute,
  modelsListRuntimeRoute,
  modelsRemoveCustomRoute,
  modelsResetConfigRoute,
  modelsSetBatchStatusRoute,
  modelsSetConfigRoute,
  modelsSetStatusRoute,
  modelsUpdateCustomRoute
} from '@shared/contracts/routes'
import { readModelCapabilities } from '../config/configRouteSupport'

export async function dispatchModelRoute(
  deps: {
    configPresenter: IConfigPresenter
    llmProviderPresenter: ILlmProviderPresenter
  },
  routeName: string,
  rawInput: unknown
): Promise<unknown> {
  const { configPresenter, llmProviderPresenter } = deps

  switch (routeName) {
    case modelsGetProviderCatalogRoute.name: {
      const input = modelsGetProviderCatalogRoute.input.parse(rawInput)
      const providerModels = configPresenter.getProviderModels(input.providerId) ?? []
      const customModels = configPresenter.getCustomModels(input.providerId) ?? []
      const dbProviderModels = configPresenter.getDbProviderModels(input.providerId) ?? []
      const modelIds = Array.from(
        new Set([
          ...providerModels.map((model) => model.id),
          ...customModels.map((model) => model.id),
          ...dbProviderModels.map((model) => model.id)
        ])
      )
      const modelStatusMap = configPresenter.getBatchModelStatus(input.providerId, modelIds)

      return modelsGetProviderCatalogRoute.output.parse({
        catalog: {
          providerModels,
          customModels,
          dbProviderModels,
          modelStatusMap
        }
      })
    }

    case modelsListRuntimeRoute.name: {
      const input = modelsListRuntimeRoute.input.parse(rawInput)
      return modelsListRuntimeRoute.output.parse({
        models: await llmProviderPresenter.getModelList(input.providerId)
      })
    }

    case modelsSetBatchStatusRoute.name: {
      const input = modelsSetBatchStatusRoute.input.parse(rawInput)
      await llmProviderPresenter.batchUpdateModelStatus(input.providerId, input.updates)
      return modelsSetBatchStatusRoute.output.parse({ results: input.updates })
    }

    case modelsSetStatusRoute.name: {
      const input = modelsSetStatusRoute.input.parse(rawInput)
      await llmProviderPresenter.updateModelStatus(input.providerId, input.modelId, input.enabled)
      return modelsSetStatusRoute.output.parse(input)
    }

    case modelsAddCustomRoute.name: {
      const input = modelsAddCustomRoute.input.parse(rawInput)
      const model = await llmProviderPresenter.addCustomModel(input.providerId, input.model)
      return modelsAddCustomRoute.output.parse({ model })
    }

    case modelsRemoveCustomRoute.name: {
      const input = modelsRemoveCustomRoute.input.parse(rawInput)
      return modelsRemoveCustomRoute.output.parse({
        removed: await llmProviderPresenter.removeCustomModel(input.providerId, input.modelId)
      })
    }

    case modelsUpdateCustomRoute.name: {
      const input = modelsUpdateCustomRoute.input.parse(rawInput)
      return modelsUpdateCustomRoute.output.parse({
        updated: await llmProviderPresenter.updateCustomModel(
          input.providerId,
          input.modelId,
          input.updates
        )
      })
    }

    case modelsGetConfigRoute.name: {
      const input = modelsGetConfigRoute.input.parse(rawInput)
      return modelsGetConfigRoute.output.parse({
        config: configPresenter.getModelConfig(input.modelId, input.providerId)
      })
    }

    case modelsSetConfigRoute.name: {
      const input = modelsSetConfigRoute.input.parse(rawInput)
      configPresenter.setModelConfig(input.modelId, input.providerId, input.config)
      return modelsSetConfigRoute.output.parse({
        config: configPresenter.getModelConfig(input.modelId, input.providerId)
      })
    }

    case modelsResetConfigRoute.name: {
      const input = modelsResetConfigRoute.input.parse(rawInput)
      configPresenter.resetModelConfig(input.modelId, input.providerId)
      return modelsResetConfigRoute.output.parse({
        reset: true
      })
    }

    case modelsGetProviderConfigsRoute.name: {
      const input = modelsGetProviderConfigsRoute.input.parse(rawInput)
      return modelsGetProviderConfigsRoute.output.parse({
        configs: configPresenter.getProviderModelConfigs(input.providerId)
      })
    }

    case modelsHasUserConfigRoute.name: {
      const input = modelsHasUserConfigRoute.input.parse(rawInput)
      return modelsHasUserConfigRoute.output.parse({
        hasConfig: configPresenter.hasUserModelConfig(input.modelId, input.providerId)
      })
    }

    case modelsExportConfigsRoute.name: {
      modelsExportConfigsRoute.input.parse(rawInput)
      return modelsExportConfigsRoute.output.parse({
        configs: configPresenter.exportModelConfigs()
      })
    }

    case modelsImportConfigsRoute.name: {
      const input = modelsImportConfigsRoute.input.parse(rawInput)
      configPresenter.importModelConfigs(input.configs, input.overwrite)
      return modelsImportConfigsRoute.output.parse({
        imported: true,
        overwrite: input.overwrite
      })
    }

    case modelsGetCapabilitiesRoute.name: {
      const input = modelsGetCapabilitiesRoute.input.parse(rawInput)
      return modelsGetCapabilitiesRoute.output.parse({
        capabilities: readModelCapabilities(configPresenter, input.providerId, input.modelId)
      })
    }

    default:
      return undefined
  }
}
