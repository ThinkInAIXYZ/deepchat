import type { IConfigPresenter, ProviderRuntimePort } from '@shared/presenter'
import type { AcpProviderAdminPort } from '@/presenter/runtimePorts'
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
  modelsTranscribeAudioRoute,
  modelsUpdateCustomRoute,
  providersAddRoute,
  providersGetAcpProcessConfigOptionsRoute,
  providersGetEmbeddingDimensionsRoute,
  providersGetKeyStatusRoute,
  providersGetRateLimitStatusRoute,
  providersImportApplyRoute,
  providersImportScanRoute,
  providersListDefaultsRoute,
  providersListModelsRoute,
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
  providersTestConnectionRoute,
  providersUpdateRoute,
  providersUpdateRateLimitRoute,
  providersWarmupAcpProcessRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { ProviderImportService } from './providerImportService'
import { ProviderService, type ProviderQueryScheduler } from './providerService'

export function createProviderRoutes(deps: {
  configPresenter: IConfigPresenter
  providerRuntime: ProviderRuntimePort
  acpProviderAdminPort: AcpProviderAdminPort
  providerImportService: ProviderImportService
  scheduler: ProviderQueryScheduler
  recordSettingsActivity(input: SettingsActivityInput): Promise<unknown>
}): DeepchatRouteMap {
  const {
    configPresenter,
    providerRuntime,
    acpProviderAdminPort,
    providerImportService,
    scheduler
  } = deps
  const providerService = new ProviderService({
    providerCatalogPort: {
      getProviderModels: (providerId) => configPresenter.getProviderModels(providerId) ?? [],
      getCustomModels: (providerId) => configPresenter.getCustomModels(providerId) ?? []
    },
    providerExecutionPort: {
      testConnection: async (providerId, modelId) =>
        await providerRuntime.check(providerId, modelId)
    },
    scheduler
  })

  const recordActivity = (input: SettingsActivityInput): void => {
    void deps.recordSettingsActivity(input).catch((error) => {
      console.warn('[SettingsActivity] Failed to record provider activity:', error)
    })
  }

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

  return createRouteMap([
    [
      providersListRoute.name,
      async (rawInput) => {
        providersListRoute.input.parse(rawInput)
        return providersListRoute.output.parse({ providers: configPresenter.getProviders() })
      }
    ],
    [
      providersListSummariesRoute.name,
      async (rawInput) => {
        providersListSummariesRoute.input.parse(rawInput)
        return providersListSummariesRoute.output.parse({
          providers: configPresenter.getProviders().map(toProviderSummary)
        })
      }
    ],
    [
      providersListDefaultsRoute.name,
      async (rawInput) => {
        providersListDefaultsRoute.input.parse(rawInput)
        return providersListDefaultsRoute.output.parse({
          providers: configPresenter.getDefaultProviders()
        })
      }
    ],
    [
      providersSetByIdRoute.name,
      async (rawInput) => {
        const input = providersSetByIdRoute.input.parse(rawInput)
        configPresenter.setProviderById(input.providerId, input.provider)
        return providersSetByIdRoute.output.parse({
          provider: configPresenter.getProviderById(input.providerId) ?? input.provider
        })
      }
    ],
    [
      providersUpdateRoute.name,
      async (rawInput) => {
        const input = providersUpdateRoute.input.parse(rawInput)
        const requiresRebuild = configPresenter.updateProviderAtomic(
          input.providerId,
          input.updates
        )
        const provider = configPresenter.getProviderById(input.providerId)
        const action =
          typeof input.updates.enable === 'boolean'
            ? input.updates.enable
              ? 'enabled'
              : 'disabled'
            : 'updated'
        const result = providersUpdateRoute.output.parse({ provider, requiresRebuild })
        recordActivity({
          category: 'provider',
          action,
          targetType: 'provider',
          targetId: input.providerId,
          targetLabel: provider?.name ?? input.providerId,
          routeName: 'settings-provider',
          routeParams: { providerId: input.providerId },
          summaryKey: 'settings.controlCenter.activity.providerUpdated',
          summaryParams: { name: provider?.name ?? input.providerId }
        })
        return result
      }
    ],
    [
      providersAddRoute.name,
      async (rawInput) => {
        const input = providersAddRoute.input.parse(rawInput)
        configPresenter.addProviderAtomic(input.provider)
        const result = providersAddRoute.output.parse({
          provider: configPresenter.getProviderById(input.provider.id) ?? input.provider
        })
        recordActivity({
          category: 'provider',
          action: 'created',
          targetType: 'provider',
          targetId: input.provider.id,
          targetLabel: input.provider.name,
          routeName: 'settings-provider',
          routeParams: { providerId: input.provider.id },
          summaryKey: 'settings.controlCenter.activity.providerCreated',
          summaryParams: { name: input.provider.name }
        })
        return result
      }
    ],
    [
      providersRemoveRoute.name,
      async (rawInput) => {
        const input = providersRemoveRoute.input.parse(rawInput)
        configPresenter.removeProviderAtomic(input.providerId)
        const result = providersRemoveRoute.output.parse({ removed: true })
        recordActivity({
          category: 'provider',
          action: 'removed',
          targetType: 'provider',
          targetId: input.providerId,
          targetLabel: input.providerId,
          routeName: 'settings-provider',
          summaryKey: 'settings.controlCenter.activity.providerRemoved',
          summaryParams: { name: input.providerId }
        })
        return result
      }
    ],
    [
      providersReorderRoute.name,
      async (rawInput) => {
        const input = providersReorderRoute.input.parse(rawInput)
        configPresenter.reorderProvidersAtomic(input.providers)
        return providersReorderRoute.output.parse({ providers: configPresenter.getProviders() })
      }
    ],
    [
      providersGetRateLimitStatusRoute.name,
      async (rawInput) => {
        const input = providersGetRateLimitStatusRoute.input.parse(rawInput)
        return providersGetRateLimitStatusRoute.output.parse({
          status: providerRuntime.getProviderRateLimitStatus(input.providerId)
        })
      }
    ],
    [
      providersGetKeyStatusRoute.name,
      async (rawInput) => {
        const input = providersGetKeyStatusRoute.input.parse(rawInput)
        return providersGetKeyStatusRoute.output.parse({
          status: await providerRuntime.getKeyStatus(input.providerId)
        })
      }
    ],
    [
      providersUpdateRateLimitRoute.name,
      async (rawInput) => {
        const input = providersUpdateRateLimitRoute.input.parse(rawInput)
        providerRuntime.updateProviderRateLimit(input.providerId, input.enabled, input.qpsLimit)
        return providersUpdateRateLimitRoute.output.parse({
          config: providerRuntime.getProviderRateLimitStatus(input.providerId).config
        })
      }
    ],
    [
      providersGetEmbeddingDimensionsRoute.name,
      async (rawInput) => {
        const input = providersGetEmbeddingDimensionsRoute.input.parse(rawInput)
        return providersGetEmbeddingDimensionsRoute.output.parse({
          result: await providerRuntime.getDimensions(input.providerId, input.modelId)
        })
      }
    ],
    [
      providersSyncModelScopeMcpServersRoute.name,
      async (rawInput) => {
        const input = providersSyncModelScopeMcpServersRoute.input.parse(rawInput)
        return providersSyncModelScopeMcpServersRoute.output.parse({
          result: await providerRuntime.syncModelScopeMcpServers(
            input.providerId,
            input.syncOptions
          )
        })
      }
    ],
    [
      providersRunAcpDebugActionRoute.name,
      async (rawInput, context) => {
        const input = providersRunAcpDebugActionRoute.input.parse(rawInput)
        return providersRunAcpDebugActionRoute.output.parse({
          result: await acpProviderAdminPort.runAcpDebugAction({
            ...input,
            webContentsId: context.webContentsId
          })
        })
      }
    ],
    [
      providersRefreshModelsRoute.name,
      async (rawInput) => {
        const input = providersRefreshModelsRoute.input.parse(rawInput)
        await providerRuntime.refreshModels(input.providerId)
        const provider = configPresenter.getProviderById(input.providerId)
        const result = providersRefreshModelsRoute.output.parse({ refreshed: true })
        recordActivity({
          category: 'provider',
          action: 'refreshed',
          targetType: 'provider',
          targetId: input.providerId,
          targetLabel: provider?.name ?? input.providerId,
          routeName: 'settings-provider',
          routeParams: { providerId: input.providerId },
          summaryKey: 'settings.controlCenter.activity.providerModelsRefreshed',
          summaryParams: { name: provider?.name ?? input.providerId }
        })
        return result
      }
    ],
    [
      providersListOllamaModelsRoute.name,
      async (rawInput) => {
        const input = providersListOllamaModelsRoute.input.parse(rawInput)
        return providersListOllamaModelsRoute.output.parse({
          models: await providerRuntime.listOllamaModels(input.providerId)
        })
      }
    ],
    [
      providersListOllamaRunningModelsRoute.name,
      async (rawInput) => {
        const input = providersListOllamaRunningModelsRoute.input.parse(rawInput)
        return providersListOllamaRunningModelsRoute.output.parse({
          models: await providerRuntime.listOllamaRunningModels(input.providerId)
        })
      }
    ],
    [
      providersPullOllamaModelRoute.name,
      async (rawInput) => {
        const input = providersPullOllamaModelRoute.input.parse(rawInput)
        return providersPullOllamaModelRoute.output.parse({
          success: await providerRuntime.pullOllamaModels(input.providerId, input.modelName)
        })
      }
    ],
    [
      providersWarmupAcpProcessRoute.name,
      async (rawInput) => {
        const input = providersWarmupAcpProcessRoute.input.parse(rawInput)
        await acpProviderAdminPort.warmupAcpProcess(input.agentId, input.workdir)
        return providersWarmupAcpProcessRoute.output.parse({ warmedUp: true })
      }
    ],
    [
      providersGetAcpProcessConfigOptionsRoute.name,
      async (rawInput) => {
        const input = providersGetAcpProcessConfigOptionsRoute.input.parse(rawInput)
        return providersGetAcpProcessConfigOptionsRoute.output.parse({
          state: await acpProviderAdminPort.getAcpProcessConfigOptions(input.agentId, input.workdir)
        })
      }
    ],
    [
      providersImportScanRoute.name,
      async (rawInput) => {
        providersImportScanRoute.input.parse(rawInput)
        return providersImportScanRoute.output.parse(await providerImportService.scan())
      }
    ],
    [
      providersImportApplyRoute.name,
      async (rawInput) => {
        const input = providersImportApplyRoute.input.parse(rawInput)
        return providersImportApplyRoute.output.parse(providerImportService.apply(input))
      }
    ],
    [
      providersListModelsRoute.name,
      async (rawInput) => {
        const input = providersListModelsRoute.input.parse(rawInput)
        return providersListModelsRoute.output.parse(
          await providerService.listModels(input.providerId)
        )
      }
    ],
    [
      providersTestConnectionRoute.name,
      async (rawInput) => {
        const input = providersTestConnectionRoute.input.parse(rawInput)
        return providersTestConnectionRoute.output.parse(
          await providerService.testConnection(input)
        )
      }
    ],
    [
      modelsGetProviderCatalogRoute.name,
      async (rawInput) => {
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
        return modelsGetProviderCatalogRoute.output.parse({
          catalog: {
            providerModels,
            customModels,
            dbProviderModels,
            modelStatusMap: configPresenter.getBatchModelStatus(input.providerId, modelIds)
          }
        })
      }
    ],
    [
      modelsListRuntimeRoute.name,
      async (rawInput) => {
        const input = modelsListRuntimeRoute.input.parse(rawInput)
        return modelsListRuntimeRoute.output.parse({
          models: await providerRuntime.getModelList(input.providerId)
        })
      }
    ],
    [
      modelsSetBatchStatusRoute.name,
      async (rawInput) => {
        const input = modelsSetBatchStatusRoute.input.parse(rawInput)
        await providerRuntime.batchUpdateModelStatus(input.providerId, input.updates)
        const result = modelsSetBatchStatusRoute.output.parse({ results: input.updates })
        recordActivity({
          category: 'model',
          action: 'updated',
          targetType: 'model',
          targetId: input.providerId,
          targetLabel: input.providerId,
          routeName: 'settings-provider',
          routeParams: { providerId: input.providerId },
          summaryKey: 'settings.controlCenter.activity.modelBatchUpdated',
          summaryParams: { count: input.updates.length }
        })
        return result
      }
    ],
    [
      modelsSetStatusRoute.name,
      async (rawInput) => {
        const input = modelsSetStatusRoute.input.parse(rawInput)
        await providerRuntime.updateModelStatus(input.providerId, input.modelId, input.enabled)
        const result = modelsSetStatusRoute.output.parse(input)
        recordActivity({
          category: 'model',
          action: input.enabled ? 'enabled' : 'disabled',
          targetType: 'model',
          targetId: input.modelId,
          targetLabel: input.modelId,
          routeName: 'settings-provider',
          routeParams: { providerId: input.providerId },
          summaryKey: 'settings.controlCenter.activity.modelStatusChanged',
          summaryParams: { model: input.modelId }
        })
        return result
      }
    ],
    [
      modelsAddCustomRoute.name,
      async (rawInput) => {
        const input = modelsAddCustomRoute.input.parse(rawInput)
        return modelsAddCustomRoute.output.parse({
          model: await providerRuntime.addCustomModel(input.providerId, input.model)
        })
      }
    ],
    [
      modelsRemoveCustomRoute.name,
      async (rawInput) => {
        const input = modelsRemoveCustomRoute.input.parse(rawInput)
        return modelsRemoveCustomRoute.output.parse({
          removed: await providerRuntime.removeCustomModel(input.providerId, input.modelId)
        })
      }
    ],
    [
      modelsUpdateCustomRoute.name,
      async (rawInput) => {
        const input = modelsUpdateCustomRoute.input.parse(rawInput)
        return modelsUpdateCustomRoute.output.parse({
          updated: await providerRuntime.updateCustomModel(
            input.providerId,
            input.modelId,
            input.updates
          )
        })
      }
    ],
    [
      modelsGetConfigRoute.name,
      async (rawInput) => {
        const input = modelsGetConfigRoute.input.parse(rawInput)
        return modelsGetConfigRoute.output.parse({
          config: configPresenter.getModelConfig(input.modelId, input.providerId)
        })
      }
    ],
    [
      modelsSetConfigRoute.name,
      async (rawInput) => {
        const input = modelsSetConfigRoute.input.parse(rawInput)
        configPresenter.setModelConfig(input.modelId, input.providerId, input.config)
        return modelsSetConfigRoute.output.parse({
          config: configPresenter.getModelConfig(input.modelId, input.providerId)
        })
      }
    ],
    [
      modelsResetConfigRoute.name,
      async (rawInput) => {
        const input = modelsResetConfigRoute.input.parse(rawInput)
        configPresenter.resetModelConfig(input.modelId, input.providerId)
        return modelsResetConfigRoute.output.parse({ reset: true })
      }
    ],
    [
      modelsGetProviderConfigsRoute.name,
      async (rawInput) => {
        const input = modelsGetProviderConfigsRoute.input.parse(rawInput)
        return modelsGetProviderConfigsRoute.output.parse({
          configs: configPresenter.getProviderModelConfigs(input.providerId)
        })
      }
    ],
    [
      modelsHasUserConfigRoute.name,
      async (rawInput) => {
        const input = modelsHasUserConfigRoute.input.parse(rawInput)
        return modelsHasUserConfigRoute.output.parse({
          hasConfig: configPresenter.hasUserModelConfig(input.modelId, input.providerId)
        })
      }
    ],
    [
      modelsExportConfigsRoute.name,
      async (rawInput) => {
        modelsExportConfigsRoute.input.parse(rawInput)
        return modelsExportConfigsRoute.output.parse({
          configs: configPresenter.exportModelConfigs()
        })
      }
    ],
    [
      modelsImportConfigsRoute.name,
      async (rawInput) => {
        const input = modelsImportConfigsRoute.input.parse(rawInput)
        configPresenter.importModelConfigs(input.configs, input.overwrite)
        return modelsImportConfigsRoute.output.parse({
          imported: true,
          overwrite: input.overwrite
        })
      }
    ],
    [
      modelsGetCapabilitiesRoute.name,
      async (rawInput) => {
        const input = modelsGetCapabilitiesRoute.input.parse(rawInput)
        return modelsGetCapabilitiesRoute.output.parse({
          capabilities: {
            supportsAudioInput: configPresenter.supportsAudioInputCapability(
              input.providerId,
              input.modelId
            ),
            supportsReasoning: configPresenter.supportsReasoningCapability(
              input.providerId,
              input.modelId
            ),
            reasoningPortrait: configPresenter.getReasoningPortrait(
              input.providerId,
              input.modelId
            ),
            thinkingBudgetRange: configPresenter.getThinkingBudgetRange(
              input.providerId,
              input.modelId
            ),
            supportsSearch: configPresenter.supportsSearchCapability(
              input.providerId,
              input.modelId
            ),
            searchDefaults: configPresenter.getSearchDefaults(input.providerId, input.modelId),
            supportsTemperatureControl: configPresenter.supportsTemperatureControl(
              input.providerId,
              input.modelId
            ),
            temperatureCapability:
              configPresenter.getTemperatureCapability(input.providerId, input.modelId) ?? null
          }
        })
      }
    ],
    [
      modelsTranscribeAudioRoute.name,
      async (rawInput) => {
        const input = modelsTranscribeAudioRoute.input.parse(rawInput)
        return modelsTranscribeAudioRoute.output.parse({
          text: await providerRuntime.transcribeAudioStandalone(
            input.providerId,
            input.modelId,
            input.audioBase64,
            input.mimeType,
            input.filename
          )
        })
      }
    ]
  ])
}
