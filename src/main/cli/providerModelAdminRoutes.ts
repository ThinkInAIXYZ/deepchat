import { randomUUID } from 'node:crypto'
import {
  PublicModelConfigSchema,
  PublicProviderSummarySchema,
  modelsGetPublicConfigRoute,
  modelsSetPublicConfigRoute,
  providersAddPublicRoute,
  providersSetCredentialRoute,
  providersTestPublicConnectionRoute,
  providersUpdatePublicRoute,
  type PublicProviderSummary,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import type { ProviderRuntime } from '@/provider'
import type { ProviderQueryScheduler } from '@/provider/providerService'
import type { ProviderSettingsPort } from '@/provider/settings'
import { createRouteMap, type DeepchatRouteMap, type RouteCaller } from '@/routes/routeRegistry'
import { CliRequestError } from './errors'

type PublicProviderSettings = Pick<
  ProviderSettingsPort,
  'getProviderById' | 'getModelConfig' | 'isKnownModel' | 'setModelConfig'
>
type PublicProviderRuntime = Pick<
  ProviderRuntime,
  'addProviderAtomic' | 'check' | 'updateProviderAtomic'
>

const PUBLIC_PROVIDER_TEST_TIMEOUT_MS = 5_000

type ExtendedProviderCredentialState = LLM_PROVIDER & {
  credential?: { accessKeyId?: string; secretAccessKey?: string; profile?: string }
  accountPrivateKey?: string
}

export type CliProviderModelAdminDependencies = Readonly<{
  providerSettings: PublicProviderSettings
  providerRuntime: PublicProviderRuntime
  scheduler: ProviderQueryScheduler
  recordSettingsActivity?(input: SettingsActivityInput): void
  createProviderId?: () => string
  log?: Pick<Console, 'warn'>
}>

function requireCliCaller(caller: RouteCaller): void {
  if (caller.kind !== 'cli') {
    throw new CliRequestError('permission_denied', 'Public provider routes require a CLI caller', {
      httpStatus: 403
    })
  }
}

function hasStoredCredential(provider: LLM_PROVIDER): boolean {
  const candidate = provider as ExtendedProviderCredentialState
  return Boolean(
    provider.apiKey?.trim() ||
    provider.oauthToken?.trim() ||
    candidate.credential?.accessKeyId?.trim() ||
    candidate.credential?.secretAccessKey?.trim() ||
    candidate.credential?.profile?.trim() ||
    candidate.accountPrivateKey?.trim()
  )
}

export function toPublicProviderSummary(provider: LLM_PROVIDER): PublicProviderSummary {
  return PublicProviderSummarySchema.parse({
    id: provider.id,
    name: provider.name || provider.id,
    apiType: provider.apiType,
    enabled: provider.enable,
    custom: provider.custom === true,
    storedCredentialConfigured: hasStoredCredential(provider)
  })
}

function toPublicModelConfig(config: ModelConfig) {
  const imageGeneration =
    config.imageGeneration === undefined
      ? undefined
      : {
          ...(config.imageGeneration.size !== undefined
            ? { size: config.imageGeneration.size }
            : {}),
          ...(config.imageGeneration.quality !== undefined
            ? { quality: config.imageGeneration.quality }
            : {}),
          ...(config.imageGeneration.outputFormat !== undefined
            ? { outputFormat: config.imageGeneration.outputFormat }
            : {}),
          ...(config.imageGeneration.outputCompression !== undefined
            ? { outputCompression: config.imageGeneration.outputCompression }
            : {}),
          ...(config.imageGeneration.background !== undefined
            ? { background: config.imageGeneration.background }
            : {}),
          ...(config.imageGeneration.moderation !== undefined
            ? { moderation: config.imageGeneration.moderation }
            : {})
        }
  const videoGeneration =
    config.videoGeneration === undefined
      ? undefined
      : {
          ...(config.videoGeneration.seconds !== undefined
            ? { seconds: config.videoGeneration.seconds }
            : {}),
          ...(config.videoGeneration.size !== undefined
            ? { size: config.videoGeneration.size }
            : {}),
          ...(config.videoGeneration.ratio !== undefined
            ? { ratio: config.videoGeneration.ratio }
            : {}),
          ...(config.videoGeneration.duration !== undefined
            ? { duration: config.videoGeneration.duration }
            : {}),
          ...(config.videoGeneration.resolution !== undefined
            ? { resolution: config.videoGeneration.resolution }
            : {}),
          ...(config.videoGeneration.watermark !== undefined
            ? { watermark: config.videoGeneration.watermark }
            : {}),
          ...(config.videoGeneration.generateAudio !== undefined
            ? { generateAudio: config.videoGeneration.generateAudio }
            : {}),
          ...(config.videoGeneration.inputReference !== undefined
            ? {
                inputReference:
                  typeof config.videoGeneration.inputReference === 'string'
                    ? config.videoGeneration.inputReference
                    : {
                        data: config.videoGeneration.inputReference.data,
                        ...(config.videoGeneration.inputReference.mimeType !== undefined
                          ? { mimeType: config.videoGeneration.inputReference.mimeType }
                          : {})
                      }
              }
            : {}),
          ...(config.videoGeneration.references !== undefined
            ? {
                references: config.videoGeneration.references.map((reference) => ({
                  type: reference.type,
                  ...(reference.url !== undefined ? { url: reference.url } : {}),
                  ...(reference.data !== undefined ? { data: reference.data } : {}),
                  ...(reference.mimeType !== undefined ? { mimeType: reference.mimeType } : {})
                }))
              }
            : {})
        }
  const tts =
    config.tts === undefined
      ? undefined
      : {
          ...(config.tts.voice !== undefined ? { voice: config.tts.voice } : {}),
          ...(config.tts.responseFormat !== undefined
            ? { responseFormat: config.tts.responseFormat }
            : {}),
          ...(config.tts.speed !== undefined ? { speed: config.tts.speed } : {}),
          ...(config.tts.instructions !== undefined
            ? { instructions: config.tts.instructions }
            : {})
        }

  return PublicModelConfigSchema.parse({
    maxTokens: config.maxTokens,
    contextLength: config.contextLength,
    vision: config.vision,
    functionCall: config.functionCall,
    reasoning: config.reasoning,
    type: config.type,
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.topP !== undefined ? { topP: config.topP } : {}),
    ...(config.speechRecognition !== undefined
      ? { speechRecognition: config.speechRecognition }
      : {}),
    ...(config.isUserDefined !== undefined ? { isUserDefined: config.isUserDefined } : {}),
    ...(config.thinkingBudget !== undefined ? { thinkingBudget: config.thinkingBudget } : {}),
    ...(config.forceInterleavedThinkingCompat !== undefined
      ? { forceInterleavedThinkingCompat: config.forceInterleavedThinkingCompat }
      : {}),
    ...(config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {}),
    ...(config.reasoningVisibility !== undefined
      ? { reasoningVisibility: config.reasoningVisibility }
      : {}),
    ...(config.verbosity !== undefined ? { verbosity: config.verbosity } : {}),
    ...(config.maxCompletionTokens !== undefined
      ? { maxCompletionTokens: config.maxCompletionTokens }
      : {}),
    ...(config.apiEndpoint !== undefined ? { apiEndpoint: config.apiEndpoint } : {}),
    ...(config.endpointType !== undefined ? { endpointType: config.endpointType } : {}),
    ...(config.enableSearch !== undefined ? { enableSearch: config.enableSearch } : {}),
    ...(config.forcedSearch !== undefined ? { forcedSearch: config.forcedSearch } : {}),
    ...(config.searchStrategy !== undefined ? { searchStrategy: config.searchStrategy } : {}),
    ...(imageGeneration !== undefined ? { imageGeneration } : {}),
    ...(videoGeneration !== undefined ? { videoGeneration } : {}),
    ...(tts !== undefined ? { tts } : {})
  })
}

export function createCliProviderModelAdminRoutes(
  dependencies: CliProviderModelAdminDependencies
): DeepchatRouteMap {
  const createProviderId = dependencies.createProviderId ?? randomUUID
  const log = dependencies.log ?? console
  const executeMutation = async <T>(
    action: string,
    operation: () => T | Promise<T>
  ): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      log.warn(`[CLI] Failed to ${action}`, {
        failure: { name: error instanceof Error ? error.name : typeof error }
      })
      throw new CliRequestError('unavailable', `Could not ${action}`, {
        httpStatus: 503,
        retriable: true
      })
    }
  }
  const requireProvider = (providerId: string): LLM_PROVIDER => {
    const provider = dependencies.providerSettings.getProviderById(providerId)
    if (!provider) {
      throw new CliRequestError('not_found', 'Provider was not found', { httpStatus: 404 })
    }
    return provider
  }
  const requireModel = (providerId: string, modelId: string): void => {
    requireProvider(providerId)
    if (!dependencies.providerSettings.isKnownModel(providerId, modelId)) {
      throw new CliRequestError('not_found', 'Model was not found', { httpStatus: 404 })
    }
  }
  const recordActivity = (input: SettingsActivityInput): void => {
    dependencies.recordSettingsActivity?.(input)
  }

  return createRouteMap([
    [
      providersTestPublicConnectionRoute.name,
      async (rawInput, context) => {
        requireCliCaller(context.caller)
        const input = providersTestPublicConnectionRoute.input.parse(rawInput)
        requireProvider(input.providerId)
        let isOk = false
        try {
          const result = await dependencies.scheduler.timeout({
            task: dependencies.providerRuntime.check(input.providerId, input.modelId),
            ms: PUBLIC_PROVIDER_TEST_TIMEOUT_MS,
            reason: `providers.testPublicConnection:${input.providerId}`
          })
          isOk = result.isOk
        } catch {
          isOk = false
        }
        return providersTestPublicConnectionRoute.output.parse({
          isOk,
          errorMsg: isOk ? null : 'Provider connection failed'
        })
      }
    ],
    [
      providersAddPublicRoute.name,
      async (rawInput, context) => {
        requireCliCaller(context.caller)
        const input = providersAddPublicRoute.input.parse(rawInput)
        const providerId = createProviderId()
        if (dependencies.providerSettings.getProviderById(providerId)) {
          throw new CliRequestError('conflict', 'Generated provider ID is already in use', {
            httpStatus: 409
          })
        }
        const provider: LLM_PROVIDER = {
          id: providerId,
          name: input.name,
          apiType: input.apiType,
          apiKey: '',
          baseUrl: input.baseUrl,
          enable: input.enabled,
          custom: true
        }
        await executeMutation('add provider', () =>
          dependencies.providerRuntime.addProviderAtomic(provider)
        )
        const stored = requireProvider(providerId)
        recordActivity({
          category: 'provider',
          action: 'created',
          targetType: 'provider',
          targetId: providerId,
          targetLabel: stored.name,
          routeName: 'settings-provider',
          routeParams: { providerId },
          summaryKey: 'settings.controlCenter.activity.providerCreated',
          summaryParams: { name: stored.name }
        })
        return providersAddPublicRoute.output.parse({
          provider: toPublicProviderSummary(stored)
        })
      }
    ],
    [
      providersUpdatePublicRoute.name,
      async (rawInput, context) => {
        requireCliCaller(context.caller)
        const input = providersUpdatePublicRoute.input.parse(rawInput)
        const current = requireProvider(input.providerId)
        if (input.updates.apiType !== undefined && current.custom !== true) {
          throw new CliRequestError('conflict', 'Built-in provider API type cannot be changed', {
            httpStatus: 409
          })
        }
        const updates: Partial<LLM_PROVIDER> = {
          ...(input.updates.name !== undefined ? { name: input.updates.name } : {}),
          ...(input.updates.apiType !== undefined ? { apiType: input.updates.apiType } : {}),
          ...(input.updates.baseUrl !== undefined ? { baseUrl: input.updates.baseUrl } : {}),
          ...(input.updates.enabled !== undefined ? { enable: input.updates.enabled } : {})
        }
        const requiresRebuild = await executeMutation('update provider', () =>
          dependencies.providerRuntime.updateProviderAtomic(input.providerId, updates)
        )
        const stored = requireProvider(input.providerId)
        const action =
          input.updates.enabled === undefined
            ? 'updated'
            : input.updates.enabled
              ? 'enabled'
              : 'disabled'
        recordActivity({
          category: 'provider',
          action,
          targetType: 'provider',
          targetId: input.providerId,
          targetLabel: stored.name,
          routeName: 'settings-provider',
          routeParams: { providerId: input.providerId },
          summaryKey: 'settings.controlCenter.activity.providerUpdated',
          summaryParams: { name: stored.name }
        })
        return providersUpdatePublicRoute.output.parse({
          provider: toPublicProviderSummary(stored),
          requiresRebuild
        })
      }
    ],
    [
      providersSetCredentialRoute.name,
      async (rawInput, context) => {
        requireCliCaller(context.caller)
        const input = providersSetCredentialRoute.input.parse(rawInput)
        const current = requireProvider(input.providerId)
        await executeMutation('update provider credential', () =>
          dependencies.providerRuntime.updateProviderAtomic(input.providerId, {
            apiKey: input.action === 'set' ? input.value : ''
          })
        )
        const stored = requireProvider(input.providerId)
        recordActivity({
          category: 'provider',
          action: 'updated',
          targetType: 'provider',
          targetId: input.providerId,
          targetLabel: current.name,
          routeName: 'settings-provider',
          routeParams: { providerId: input.providerId },
          summaryKey: 'settings.controlCenter.activity.providerUpdated',
          summaryParams: { name: current.name }
        })
        return providersSetCredentialRoute.output.parse({
          providerId: input.providerId,
          action: input.action,
          kind: input.kind,
          storedApiKeyConfigured: Boolean(stored.apiKey?.trim())
        })
      }
    ],
    [
      modelsGetPublicConfigRoute.name,
      async (rawInput, context) => {
        requireCliCaller(context.caller)
        const input = modelsGetPublicConfigRoute.input.parse(rawInput)
        requireModel(input.providerId, input.modelId)
        return modelsGetPublicConfigRoute.output.parse({
          config: toPublicModelConfig(
            dependencies.providerSettings.getModelConfig(input.modelId, input.providerId)
          )
        })
      }
    ],
    [
      modelsSetPublicConfigRoute.name,
      async (rawInput, context) => {
        requireCliCaller(context.caller)
        const input = modelsSetPublicConfigRoute.input.parse(rawInput)
        requireModel(input.providerId, input.modelId)
        await executeMutation('update model configuration', () =>
          dependencies.providerSettings.setModelConfig(
            input.modelId,
            input.providerId,
            input.config
          )
        )
        const config = toPublicModelConfig(
          dependencies.providerSettings.getModelConfig(input.modelId, input.providerId)
        )
        return modelsSetPublicConfigRoute.output.parse({ config })
      }
    ]
  ])
}
