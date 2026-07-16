import type { ProviderSettingsPort } from '@/provider/settings'
import type { OAuthServicePort } from '@shared/types/oauth'
import type { AcpProviderAdminPort } from '@/provider/ports'
import {
  configGetAwsBedrockCredentialRoute,
  configGetAzureApiVersionRoute,
  configGetGeminiSafetyRoute,
  configGetVoiceAiConfigRoute,
  configRefreshProviderDbRoute,
  configSetAwsBedrockCredentialRoute,
  configSetAzureApiVersionRoute,
  configSetGeminiSafetyRoute,
  configUpdateVoiceAiConfigRoute,
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
  oauthGithubCopilotStartDeviceFlowLoginRoute,
  oauthGithubCopilotStartLoginRoute,
  oauthOpenAICodexCancelLoginRoute,
  oauthOpenAICodexCompleteBrowserLoginFromUrlRoute,
  oauthOpenAICodexGetStatusRoute,
  oauthOpenAICodexLogoutRoute,
  oauthOpenAICodexStartBrowserLoginRoute,
  oauthXaiGrokCancelLoginRoute,
  oauthXaiGrokGetStatusRoute,
  oauthXaiGrokLogoutRoute,
  oauthXaiGrokStartDeviceLoginRoute,
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
import type { ProviderRuntime } from '.'

export function createProviderRoutes(deps: {
  providerSettings: ProviderSettingsPort
  providerRuntime: ProviderRuntime
  acpProviderAdminPort: AcpProviderAdminPort
  providerImportService: ProviderImportService
  oauthService: OAuthServicePort
  scheduler: ProviderQueryScheduler
  recordSettingsActivity(input: SettingsActivityInput): Promise<unknown>
}): DeepchatRouteMap {
  const {
    providerSettings,
    providerRuntime,
    acpProviderAdminPort,
    providerImportService,
    oauthService,
    scheduler
  } = deps
  const providerService = new ProviderService({
    providerCatalogPort: {
      getProviderModels: (providerId) => providerSettings.getProviderModels(providerId) ?? [],
      getCustomModels: (providerId) => providerSettings.getCustomModels(providerId) ?? []
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

  const toProviderSummary = (
    provider: ReturnType<typeof providerSettings.getProviders>[number]
  ) => {
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
      configRefreshProviderDbRoute.name,
      async (rawInput) => {
        const input = configRefreshProviderDbRoute.input.parse(rawInput)
        return configRefreshProviderDbRoute.output.parse({
          result: await providerSettings.refreshProviderDb(input.force ?? false)
        })
      }
    ],
    [
      configGetVoiceAiConfigRoute.name,
      async (rawInput) => {
        configGetVoiceAiConfigRoute.input.parse(rawInput)
        return configGetVoiceAiConfigRoute.output.parse({
          config: providerSettings.getVoiceAiConfig()
        })
      }
    ],
    [
      configUpdateVoiceAiConfigRoute.name,
      async (rawInput) => {
        const input = configUpdateVoiceAiConfigRoute.input.parse(rawInput)
        return configUpdateVoiceAiConfigRoute.output.parse({
          config: providerSettings.setVoiceAiConfig(input.updates)
        })
      }
    ],
    [
      configGetGeminiSafetyRoute.name,
      async (rawInput) => {
        const input = configGetGeminiSafetyRoute.input.parse(rawInput)
        return configGetGeminiSafetyRoute.output.parse({
          value: providerSettings.getGeminiSafety(input.key)
        })
      }
    ],
    [
      configSetGeminiSafetyRoute.name,
      async (rawInput) => {
        const input = configSetGeminiSafetyRoute.input.parse(rawInput)
        providerSettings.setGeminiSafety(input.key, input.value)
        return configSetGeminiSafetyRoute.output.parse({
          value: providerSettings.getGeminiSafety(input.key)
        })
      }
    ],
    [
      configGetAzureApiVersionRoute.name,
      async (rawInput) => {
        configGetAzureApiVersionRoute.input.parse(rawInput)
        return configGetAzureApiVersionRoute.output.parse({
          version: providerSettings.getAzureApiVersion() || '2024-02-01'
        })
      }
    ],
    [
      configSetAzureApiVersionRoute.name,
      async (rawInput) => {
        const input = configSetAzureApiVersionRoute.input.parse(rawInput)
        providerSettings.setAzureApiVersion(input.version)
        return configSetAzureApiVersionRoute.output.parse({
          version: providerSettings.getAzureApiVersion() || '2024-02-01'
        })
      }
    ],
    [
      configGetAwsBedrockCredentialRoute.name,
      async (rawInput) => {
        configGetAwsBedrockCredentialRoute.input.parse(rawInput)
        return configGetAwsBedrockCredentialRoute.output.parse({
          value: providerSettings.getAwsBedrockCredential()
        })
      }
    ],
    [
      configSetAwsBedrockCredentialRoute.name,
      async (rawInput) => {
        const input = configSetAwsBedrockCredentialRoute.input.parse(rawInput)
        providerSettings.setAwsBedrockCredential(input.credential)
        return configSetAwsBedrockCredentialRoute.output.parse({
          value: providerSettings.getAwsBedrockCredential()
        })
      }
    ],
    [
      providersListRoute.name,
      async (rawInput) => {
        providersListRoute.input.parse(rawInput)
        return providersListRoute.output.parse({ providers: providerSettings.getProviders() })
      }
    ],
    [
      providersListSummariesRoute.name,
      async (rawInput) => {
        providersListSummariesRoute.input.parse(rawInput)
        return providersListSummariesRoute.output.parse({
          providers: providerSettings.getProviders().map(toProviderSummary)
        })
      }
    ],
    [
      providersListDefaultsRoute.name,
      async (rawInput) => {
        providersListDefaultsRoute.input.parse(rawInput)
        return providersListDefaultsRoute.output.parse({
          providers: providerSettings.getDefaultProviders()
        })
      }
    ],
    [
      providersSetByIdRoute.name,
      async (rawInput) => {
        const input = providersSetByIdRoute.input.parse(rawInput)
        providerRuntime.setProviderById(input.providerId, input.provider)
        return providersSetByIdRoute.output.parse({
          provider: providerSettings.getProviderById(input.providerId) ?? input.provider
        })
      }
    ],
    [
      providersUpdateRoute.name,
      async (rawInput) => {
        const input = providersUpdateRoute.input.parse(rawInput)
        const requiresRebuild = providerRuntime.updateProviderAtomic(
          input.providerId,
          input.updates
        )
        const provider = providerSettings.getProviderById(input.providerId)
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
        providerRuntime.addProviderAtomic(input.provider)
        const result = providersAddRoute.output.parse({
          provider: providerSettings.getProviderById(input.provider.id) ?? input.provider
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
        providerRuntime.removeProviderAtomic(input.providerId)
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
        providerRuntime.reorderProvidersAtomic(input.providers)
        return providersReorderRoute.output.parse({ providers: providerSettings.getProviders() })
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
        const provider = providerSettings.getProviderById(input.providerId)
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
        const providerModels = providerSettings.getProviderModels(input.providerId) ?? []
        const customModels = providerSettings.getCustomModels(input.providerId) ?? []
        const dbProviderModels = providerSettings.getDbProviderModels(input.providerId) ?? []
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
            modelStatusMap: providerSettings.getBatchModelStatus(input.providerId, modelIds)
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
          config: providerSettings.getModelConfig(input.modelId, input.providerId)
        })
      }
    ],
    [
      modelsSetConfigRoute.name,
      async (rawInput) => {
        const input = modelsSetConfigRoute.input.parse(rawInput)
        providerSettings.setModelConfig(input.modelId, input.providerId, input.config)
        return modelsSetConfigRoute.output.parse({
          config: providerSettings.getModelConfig(input.modelId, input.providerId)
        })
      }
    ],
    [
      modelsResetConfigRoute.name,
      async (rawInput) => {
        const input = modelsResetConfigRoute.input.parse(rawInput)
        providerSettings.resetModelConfig(input.modelId, input.providerId)
        return modelsResetConfigRoute.output.parse({ reset: true })
      }
    ],
    [
      modelsGetProviderConfigsRoute.name,
      async (rawInput) => {
        const input = modelsGetProviderConfigsRoute.input.parse(rawInput)
        return modelsGetProviderConfigsRoute.output.parse({
          configs: providerSettings.getProviderModelConfigs(input.providerId)
        })
      }
    ],
    [
      modelsHasUserConfigRoute.name,
      async (rawInput) => {
        const input = modelsHasUserConfigRoute.input.parse(rawInput)
        return modelsHasUserConfigRoute.output.parse({
          hasConfig: providerSettings.hasUserModelConfig(input.modelId, input.providerId)
        })
      }
    ],
    [
      modelsExportConfigsRoute.name,
      async (rawInput) => {
        modelsExportConfigsRoute.input.parse(rawInput)
        return modelsExportConfigsRoute.output.parse({
          configs: providerSettings.exportModelConfigs()
        })
      }
    ],
    [
      modelsImportConfigsRoute.name,
      async (rawInput) => {
        const input = modelsImportConfigsRoute.input.parse(rawInput)
        providerSettings.importModelConfigs(input.configs, input.overwrite)
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
            supportsAudioInput: providerSettings.supportsAudioInputCapability(
              input.providerId,
              input.modelId
            ),
            supportsReasoning: providerSettings.supportsReasoningCapability(
              input.providerId,
              input.modelId
            ),
            reasoningPortrait: providerSettings.getReasoningPortrait(
              input.providerId,
              input.modelId
            ),
            thinkingBudgetRange: providerSettings.getThinkingBudgetRange(
              input.providerId,
              input.modelId
            ),
            supportsSearch: providerSettings.supportsSearchCapability(
              input.providerId,
              input.modelId
            ),
            searchDefaults: providerSettings.getSearchDefaults(input.providerId, input.modelId),
            supportsTemperatureControl: providerSettings.supportsTemperatureControl(
              input.providerId,
              input.modelId
            ),
            temperatureCapability:
              providerSettings.getTemperatureCapability(input.providerId, input.modelId) ?? null
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
    ],
    [
      oauthGithubCopilotStartLoginRoute.name,
      async (rawInput) => {
        const input = oauthGithubCopilotStartLoginRoute.input.parse(rawInput)
        return oauthGithubCopilotStartLoginRoute.output.parse({
          success: await oauthService.startGitHubCopilotLogin(input.providerId)
        })
      }
    ],
    [
      oauthGithubCopilotStartDeviceFlowLoginRoute.name,
      async (rawInput) => {
        const input = oauthGithubCopilotStartDeviceFlowLoginRoute.input.parse(rawInput)
        return oauthGithubCopilotStartDeviceFlowLoginRoute.output.parse({
          success: await oauthService.startGitHubCopilotDeviceFlowLogin(input.providerId)
        })
      }
    ],
    [
      oauthOpenAICodexGetStatusRoute.name,
      async (rawInput) => {
        oauthOpenAICodexGetStatusRoute.input.parse(rawInput)
        return oauthOpenAICodexGetStatusRoute.output.parse({
          status: await oauthService.getOpenAICodexStatus()
        })
      }
    ],
    [
      oauthOpenAICodexStartBrowserLoginRoute.name,
      async (rawInput) => {
        oauthOpenAICodexStartBrowserLoginRoute.input.parse(rawInput)
        return oauthOpenAICodexStartBrowserLoginRoute.output.parse({
          status: await oauthService.startOpenAICodexBrowserLogin()
        })
      }
    ],
    [
      oauthOpenAICodexCompleteBrowserLoginFromUrlRoute.name,
      async (rawInput) => {
        const input = oauthOpenAICodexCompleteBrowserLoginFromUrlRoute.input.parse(rawInput)
        return oauthOpenAICodexCompleteBrowserLoginFromUrlRoute.output.parse({
          status: await oauthService.completeOpenAICodexBrowserLoginFromUrl(input.callbackUrl)
        })
      }
    ],
    [
      oauthOpenAICodexCancelLoginRoute.name,
      async (rawInput) => {
        oauthOpenAICodexCancelLoginRoute.input.parse(rawInput)
        return oauthOpenAICodexCancelLoginRoute.output.parse({
          status: await oauthService.cancelOpenAICodexLogin()
        })
      }
    ],
    [
      oauthOpenAICodexLogoutRoute.name,
      async (rawInput) => {
        oauthOpenAICodexLogoutRoute.input.parse(rawInput)
        return oauthOpenAICodexLogoutRoute.output.parse({
          status: await oauthService.logoutOpenAICodex()
        })
      }
    ],
    [
      oauthXaiGrokGetStatusRoute.name,
      async (rawInput) => {
        oauthXaiGrokGetStatusRoute.input.parse(rawInput)
        return oauthXaiGrokGetStatusRoute.output.parse({
          status: await oauthService.getXaiGrokStatus()
        })
      }
    ],
    [
      oauthXaiGrokStartDeviceLoginRoute.name,
      async (rawInput) => {
        oauthXaiGrokStartDeviceLoginRoute.input.parse(rawInput)
        return oauthXaiGrokStartDeviceLoginRoute.output.parse({
          status: await oauthService.startXaiGrokDeviceLogin()
        })
      }
    ],
    [
      oauthXaiGrokCancelLoginRoute.name,
      async (rawInput) => {
        oauthXaiGrokCancelLoginRoute.input.parse(rawInput)
        return oauthXaiGrokCancelLoginRoute.output.parse({
          status: await oauthService.cancelXaiGrokLogin()
        })
      }
    ],
    [
      oauthXaiGrokLogoutRoute.name,
      async (rawInput) => {
        oauthXaiGrokLogoutRoute.input.parse(rawInput)
        return oauthXaiGrokLogoutRoute.output.parse({
          status: await oauthService.logoutXaiGrok()
        })
      }
    ]
  ])
}
