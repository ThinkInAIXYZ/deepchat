import logger from '@shared/logger'
import { CliComputeService } from '@/cli/computeService'
import { CliAudioTranscriptionService } from '@/cli/audioTranscriptionService'
import type { ArtifactSpool } from '@/cli/artifactSpool'
import { DeepChatDefaults } from '@/agent/deepchat/defaults'
import { CommandShellService } from '@/agent/shared/process/commandShellService'
import path from 'node:path'
import type { initializeCoreProfile } from '@/app/profileStartup'
import type { createCoreData } from './data'
import type { CredentialCryptoPort } from '@/config/secretStore'
import type { ProviderAccountAuthPort } from '@shared/types/oauth'
import type { DeepchatEventName } from '@shared/contracts/events'
import { ProviderRuntime } from '@/provider'
import { AcpProvider } from '@/provider/providers/acpProvider'
import { buildDefaultProviderHeaders } from '@/provider/providerHeaders'
import { providerDbLoader } from '@/provider/providerDbLoader'
import { OpenAICodexCredentialStore } from '@/provider/auth/openaiCodex/credentialStore'
import { XaiGrokCredentialStore } from '@/provider/auth/xaiGrok/credentialStore'
import { initializeGlobalOpenAICodexAuth } from '@/provider/auth/openaiCodex'
import { initializeGlobalXaiGrokAuth } from '@/provider/auth/xaiGrok'
import { AgentSettings } from '@/agent/settings'
import { AcpSessionPersistence } from '@/agent/acp/runtime'
import { AcpRegistryService } from '@/agent/acp/catalog/acpRegistryService'
import {
  createAcpRuntimeOwner,
  type AcpRuntimeOwnerDependencies
} from '@/agent/acp/createRuntimeOwner'
import { AcpAuthService, type AcpAuthServiceDependencies } from '@/agent/acp/auth/acpAuthService'
import { emitAgentCatalogChanged, emitAcpAgentModelsChanged } from '@/app/agentEvents'
import { emitModelsChanged } from '@/provider/eventPublishers'
import type { MemoryServicePort } from '@/memory'
import type { SkillSettings } from '@/skill/settings'

type CoreProfile = Awaited<ReturnType<typeof initializeCoreProfile>>
type CoreData = ReturnType<typeof createCoreData>

export function createCoreProviders(options: {
  profile: Pick<
    CoreProfile,
    'settingsStore' | 'privacySettings' | 'acpCatalogSettings' | 'mcpSettings' | 'currentAppVersion'
  >
  data: Pick<
    CoreData,
    | 'agentDatabase'
    | 'sessionData'
    | 'projectDatabase'
    | 'providerSettings'
    | 'agentRepository'
    | 'appSessionService'
    | 'agentLifecycle'
  >
  artifactSpool: ArtifactSpool
  profileDirectory: string
  homeDirectory: string
  temporaryDirectory: string
  registryDirectory: string
  crypto: CredentialCryptoPort
  openExternal(url: string): Promise<void>
  fetchRegistryIcon(url: string, signal: AbortSignal): Promise<string>
  sendToRenderer: AcpAuthServiceDependencies['sendToRenderer']
  onRendererDestroyed: AcpAuthServiceDependencies['onRendererDestroyed']
  publishEvent(name: DeepchatEventName, payload: unknown): void
  projectEnvironmentChanged(): void
  readLanguage(): string
  allowInsecureTls: boolean
  registry: AcpRuntimeOwnerDependencies['registry']
  memory: Pick<
    MemoryServicePort,
    'cleanupDeletedAgentResources' | 'onAgentMemoryMaintenanceConfigChanged'
  >
  cleanupAgentSkills(agentId: string): Promise<void>
  skillSettings: SkillSettings
  assertAcpInstallAllowed(): void
}) {
  const { profile, publishEvent: publishDeepchatEvent, skillSettings, artifactSpool } = options
  const {
    agentDatabase,
    sessionData,
    projectDatabase,
    providerSettings,
    agentRepository,
    appSessionService,
    agentLifecycle
  } = options.data
  const acpBootstrap = {
    appVersion: profile.currentAppVersion,
    homeDirectory: options.homeDirectory,
    temporaryDirectory: options.temporaryDirectory
  }
  const acpSessionPersistence = new AcpSessionPersistence(
    agentDatabase,
    sessionData.database,
    projectDatabase,
    acpBootstrap.homeDirectory,
    options.projectEnvironmentChanged
  )
  let providerRuntime!: ProviderRuntime
  const codexAuth = initializeGlobalOpenAICodexAuth(
    publishDeepchatEvent,
    new OpenAICodexCredentialStore({
      filePath: path.join(options.profileDirectory, 'openai-codex-auth', 'credentials.json'),
      crypto: options.crypto
    }),
    options.openExternal
  )
  const grokAuth = initializeGlobalXaiGrokAuth(
    publishDeepchatEvent,
    new XaiGrokCredentialStore({
      filePath: path.join(options.profileDirectory, 'xai-grok-auth', 'credentials.json'),
      crypto: options.crypto
    }),
    options.openExternal
  )
  const acpRegistry = new AcpRegistryService({
    userDataDirectory: options.profileDirectory,
    builtInDirectory: options.registryDirectory,
    isPrivacyModeEnabled: () => profile.privacySettings.isEnabled(),
    fetchIcon: options.fetchRegistryIcon
  })
  const agentSettings = new AgentSettings(
    profile.settingsStore,
    agentRepository,
    profile.acpCatalogSettings,
    acpRegistry,
    options.profileDirectory,
    {
      getModelConfig: (modelId, providerId) => providerSettings.getModelConfig(modelId, providerId),
      setAcpProviderEnabled: (enabled) => {
        const provider = providerSettings.getProviderById('acp')
        if (provider && provider.enable !== enabled) {
          providerRuntime.updateProviderAtomic('acp', { enable: enabled })
        }
      },
      clearAcpProviderModels: () => providerSettings.setProviderModels('acp', []),
      clearAcpProviderModelStatus: () => providerSettings.clearProviderModelStatusCache('acp'),
      refreshAcpProviderAgents: async (agentIds) => {
        const provider = providerRuntime.getProviderInstance('acp')
        if (!(provider instanceof AcpProvider)) {
          throw new Error('ACP provider is not initialized.')
        }
        await provider.refreshAgents(agentIds)
      }
    },
    {
      publishCatalogChanged: (agentIds) =>
        emitAgentCatalogChanged(agentSettings, publishDeepchatEvent, agentIds),
      publishAcpModelsChanged: () => {
        emitModelsChanged(publishDeepchatEvent, 'acp')
        emitAcpAgentModelsChanged(publishDeepchatEvent)
      },
      publishSessionsUpdated: () =>
        publishDeepchatEvent('sessions.updated', {
          sessionIds: [],
          reason: 'list-refreshed'
        })
    },
    (agentId) => options.memory.cleanupDeletedAgentResources(agentId),
    options.cleanupAgentSkills,
    (agentId) => options.memory.onAgentMemoryMaintenanceConfigChanged(agentId),
    skillSettings,
    agentLifecycle,
    options.assertAcpInstallAllowed
  )
  const acpRuntimeOwner = createAcpRuntimeOwner({
    bootstrap: acpBootstrap,
    providerConfig: providerSettings,
    agentSettings,
    mcpSettings: profile.mcpSettings,
    sessionPersistence: acpSessionPersistence,
    titles: {
      get: (sessionId) => appSessionService.get(sessionId)?.title,
      apply: (sessionId, expected, title) => {
        const session = appSessionService.get(sessionId)
        if (!session || session.title !== expected) return false
        appSessionService.update(sessionId, { title })
        publishDeepchatEvent('sessions.updated', { sessionIds: [sessionId], reason: 'updated' })
        return true
      }
    },
    publishEvent: publishDeepchatEvent,
    registry: options.registry
  })
  const acpAuthService = new AcpAuthService({
    owner: acpRuntimeOwner,
    agentSettings,
    sendToRenderer: options.sendToRenderer,
    onRendererDestroyed: options.onRendererDestroyed
  })
  providerRuntime = new ProviderRuntime(
    providerSettings,
    {
      getLanguage: options.readLanguage,
      defaultHeaders: buildDefaultProviderHeaders(profile.currentAppVersion),
      allowInsecureTls: options.allowInsecureTls
    },
    agentSettings,
    profile.mcpSettings,
    acpRuntimeOwner,
    acpSessionPersistence,
    publishDeepchatEvent
  )
  const cliComputeService = new CliComputeService({
    providerSettings,
    providerRuntime,
    artifactSpool,
    mediaCacheDirectory: path.join(options.profileDirectory, 'images'),
    log: logger
  })
  const cliAudioTranscriptionService = new CliAudioTranscriptionService({
    providerSettings,
    providerRuntime,
    artifactSpool,
    log: logger
  })
  const agentDefaults = new DeepChatDefaults({
    settings: profile.settingsStore,
    publishSettingChanged: (key, value) =>
      publishDeepchatEvent('settings.changed', {
        changedKeys: [key],
        version: Date.now(),
        values: { [key]: value }
      })
  })
  const commandShellService = new CommandShellService({ settings: profile.settingsStore })
  const accounts: ProviderAccountAuthPort = {
    getOpenAICodexStatus: () => codexAuth.getStatus(),
    startOpenAICodexBrowserLogin: () => codexAuth.startBrowserLogin(),
    completeOpenAICodexBrowserLoginFromUrl: (url) =>
      codexAuth.completeBrowserLoginFromCallbackUrl(url),
    cancelOpenAICodexLogin: () => codexAuth.cancelLogin(),
    logoutOpenAICodex: () => codexAuth.logout(),
    getXaiGrokStatus: () => grokAuth.getStatus(),
    startXaiGrokDeviceLogin: () => grokAuth.startDeviceLogin(),
    cancelXaiGrokLogin: () => grokAuth.cancelLogin(),
    logoutXaiGrok: () => grokAuth.logout(),
    stop: async () => {
      codexAuth.stop()
      grokAuth.stop()
    }
  }
  const unsubscribeProviderDbCatalog = providerDbLoader.subscribeCatalogChanges((change) => {
    if (change.reason === 'updated') providerRuntime.handleProviderDbUpdated()
  })
  return {
    providerRuntime,
    agentSettings,
    acpSessionPersistence,
    acpRuntimeOwner,
    acpAuthService,
    accounts,
    unsubscribeProviderDbCatalog,
    cliComputeService,
    cliAudioTranscriptionService,
    agentDefaults,
    commandShellService
  }
}
