import { z } from 'zod'
import { AgentBootstrapItemSchema, TimestampMsSchema, defineRouteContract } from '../common'
import {
  AcpAgentConfigSchema,
  BuiltinKnowledgeConfigSchema,
  ConfigValueSchema,
  DeepChatAgentConfigSchema,
  LanguageDirectionSchema,
  McpServerConfigSchema,
  ModelSelectionSchema,
  PromptSchema,
  ShortcutKeySettingSchema,
  SystemPromptSchema,
  ThemeModeSchema
} from '../domainSchemas'

const AgentInstallStateSchema = z.looseObject({
  status: z.enum(['not_installed', 'installing', 'installed', 'error']),
  distributionType: z.enum(['binary', 'npx', 'uvx', 'manual']).nullable().optional(),
  version: z.string().nullable().optional(),
  installedAt: TimestampMsSchema.nullable().optional(),
  lastCheckedAt: TimestampMsSchema.nullable().optional(),
  installDir: z.string().nullable().optional(),
  error: z.string().nullable().optional()
})

const AgentSchema = AgentBootstrapItemSchema.extend({
  config: DeepChatAgentConfigSchema.nullable().optional(),
  installState: AgentInstallStateSchema.nullable().optional()
})

const AgentAvatarSchema = z
  .discriminatedUnion('kind', [
    z.looseObject({
      kind: z.literal('lucide'),
      icon: z.string().min(1),
      lightColor: z.string().nullable().optional(),
      darkColor: z.string().nullable().optional()
    }),
    z.looseObject({
      kind: z.literal('monogram'),
      text: z.string(),
      backgroundColor: z.string().nullable().optional()
    })
  ])
  .nullable()

const DeepChatAgentCreateInputSchema = z.looseObject({
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  avatar: AgentAvatarSchema.optional(),
  config: DeepChatAgentConfigSchema.nullable().optional()
})

const DeepChatAgentUpdateInputSchema = z.looseObject({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  avatar: AgentAvatarSchema.optional(),
  config: DeepChatAgentConfigSchema.nullable().optional()
})

const AcpRegistryAgentSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  repository: z.string().optional(),
  website: z.string().optional(),
  authors: z.array(z.string()).optional(),
  license: z.string().optional(),
  icon: z.string().optional(),
  distribution: z.looseObject({}),
  source: z.literal('registry'),
  enabled: z.boolean(),
  envOverride: z.record(z.string(), z.string()).optional(),
  installState: AgentInstallStateSchema.nullable().optional()
})

const AcpManualAgentSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean(),
  description: z.string().optional(),
  icon: z.string().optional(),
  source: z.literal('manual')
})

const AcpManualAgentInputSchema = z.looseObject({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean(),
  description: z.string().optional(),
  icon: z.string().optional()
})

const AcpManualAgentUpdateSchema = AcpManualAgentInputSchema.partial()

export const CONFIG_ENTRY_KEYS = [
  'init_complete',
  'assistantModel',
  'preferredModel',
  'defaultModel',
  'default_system_prompt',
  'maxFileSize',
  'input_deepThinking',
  'input_chatMode',
  'think_collapse',
  'artifact_think_collapse',
  'providerOrder',
  'providerTimestamps',
  'sidebar_group_mode',
  'input_enabledMcpTools'
] as const

export const ConfigEntryKeySchema = z.enum(CONFIG_ENTRY_KEYS)

export const ConfigEntryValuesSchema = z.object({
  init_complete: z.boolean(),
  assistantModel: ModelSelectionSchema.nullable(),
  preferredModel: ModelSelectionSchema,
  defaultModel: ModelSelectionSchema,
  default_system_prompt: z.string(),
  maxFileSize: z.number().int().positive(),
  input_deepThinking: z.boolean(),
  input_chatMode: z.string(),
  think_collapse: z.boolean(),
  artifact_think_collapse: z.boolean(),
  providerOrder: z.array(z.string()),
  providerTimestamps: z.record(z.string(), z.number().int()),
  sidebar_group_mode: z.string(),
  input_enabledMcpTools: z.array(z.string())
})

export const ConfigEntryChangeSchema = z.discriminatedUnion('key', [
  z.object({
    key: z.literal('init_complete'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('assistantModel'),
    value: ModelSelectionSchema.nullable()
  }),
  z.object({
    key: z.literal('preferredModel'),
    value: ModelSelectionSchema
  }),
  z.object({
    key: z.literal('defaultModel'),
    value: ModelSelectionSchema
  }),
  z.object({
    key: z.literal('default_system_prompt'),
    value: z.string()
  }),
  z.object({
    key: z.literal('maxFileSize'),
    value: z.number().int().positive()
  }),
  z.object({
    key: z.literal('input_deepThinking'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('input_chatMode'),
    value: z.string()
  }),
  z.object({
    key: z.literal('think_collapse'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('artifact_think_collapse'),
    value: z.boolean()
  }),
  z.object({
    key: z.literal('providerOrder'),
    value: z.array(z.string())
  }),
  z.object({
    key: z.literal('providerTimestamps'),
    value: z.record(z.string(), z.number().int())
  }),
  z.object({
    key: z.literal('sidebar_group_mode'),
    value: z.string()
  }),
  z.object({
    key: z.literal('input_enabledMcpTools'),
    value: z.array(z.string())
  })
])

export const ProxyModeSchema = z.enum(['system', 'none', 'custom'])
export const UpdateChannelSchema = z.enum(['stable', 'beta'])

export const configGetEntriesRoute = defineRouteContract({
  name: 'config.getEntries',
  input: z
    .object({
      keys: z.array(ConfigEntryKeySchema).optional()
    })
    .default({}),
  output: z.object({
    version: TimestampMsSchema,
    values: ConfigEntryValuesSchema.partial()
  })
})

export const configUpdateEntriesRoute = defineRouteContract({
  name: 'config.updateEntries',
  input: z.object({
    changes: z.array(ConfigEntryChangeSchema).min(1)
  }),
  output: z.object({
    version: TimestampMsSchema,
    changedKeys: z.array(ConfigEntryKeySchema).min(1),
    values: ConfigEntryValuesSchema.partial()
  })
})

export const configGetLanguageRoute = defineRouteContract({
  name: 'config.getLanguage',
  input: z.object({}).default({}),
  output: z.object({
    requestedLanguage: z.string(),
    locale: z.string(),
    direction: LanguageDirectionSchema
  })
})

export const configSetLanguageRoute = defineRouteContract({
  name: 'config.setLanguage',
  input: z.object({
    language: z.string().min(1)
  }),
  output: z.object({
    requestedLanguage: z.string(),
    locale: z.string(),
    direction: LanguageDirectionSchema
  })
})

export const configGetThemeRoute = defineRouteContract({
  name: 'config.getTheme',
  input: z.object({}).default({}),
  output: z.object({
    theme: ThemeModeSchema,
    isDark: z.boolean()
  })
})

export const configSetThemeRoute = defineRouteContract({
  name: 'config.setTheme',
  input: z.object({
    theme: ThemeModeSchema
  }),
  output: z.object({
    theme: ThemeModeSchema,
    isDark: z.boolean()
  })
})

export const configGetFloatingButtonRoute = defineRouteContract({
  name: 'config.getFloatingButton',
  input: z.object({}).default({}),
  output: z.object({
    enabled: z.boolean()
  })
})

export const configSetFloatingButtonRoute = defineRouteContract({
  name: 'config.setFloatingButton',
  input: z.object({
    enabled: z.boolean()
  }),
  output: z.object({
    enabled: z.boolean()
  })
})

export const configGetSyncSettingsRoute = defineRouteContract({
  name: 'config.getSyncSettings',
  input: z.object({}).default({}),
  output: z.object({
    enabled: z.boolean(),
    folderPath: z.string()
  })
})

export const configUpdateSyncSettingsRoute = defineRouteContract({
  name: 'config.updateSyncSettings',
  input: z
    .object({
      enabled: z.boolean().optional(),
      folderPath: z.string().optional()
    })
    .refine((input) => input.enabled !== undefined || input.folderPath !== undefined, {
      message: 'At least one sync setting must be provided'
    }),
  output: z.object({
    enabled: z.boolean(),
    folderPath: z.string()
  })
})

export const configGetProxySettingsRoute = defineRouteContract({
  name: 'config.getProxySettings',
  input: z.object({}).default({}),
  output: z.object({
    mode: ProxyModeSchema,
    customProxyUrl: z.string()
  })
})

export const configSetProxyModeRoute = defineRouteContract({
  name: 'config.setProxyMode',
  input: z.object({
    mode: ProxyModeSchema
  }),
  output: z.object({
    mode: ProxyModeSchema,
    customProxyUrl: z.string()
  })
})

export const configSetCustomProxyUrlRoute = defineRouteContract({
  name: 'config.setCustomProxyUrl',
  input: z.object({
    url: z.string()
  }),
  output: z.object({
    mode: ProxyModeSchema,
    customProxyUrl: z.string()
  })
})

export const configOpenLoggingFolderRoute = defineRouteContract({
  name: 'config.openLoggingFolder',
  input: z.object({}).default({}),
  output: z.object({
    opened: z.boolean()
  })
})

export const configGetUpdateChannelRoute = defineRouteContract({
  name: 'config.getUpdateChannel',
  input: z.object({}).default({}),
  output: z.object({
    channel: UpdateChannelSchema
  })
})

export const configSetUpdateChannelRoute = defineRouteContract({
  name: 'config.setUpdateChannel',
  input: z.object({
    channel: UpdateChannelSchema
  }),
  output: z.object({
    channel: UpdateChannelSchema
  })
})

export const configGetSkillDraftSuggestionsRoute = defineRouteContract({
  name: 'config.getSkillDraftSuggestions',
  input: z.object({}).default({}),
  output: z.object({
    enabled: z.boolean()
  })
})

export const configSetSkillDraftSuggestionsRoute = defineRouteContract({
  name: 'config.setSkillDraftSuggestions',
  input: z.object({
    enabled: z.boolean()
  }),
  output: z.object({
    enabled: z.boolean()
  })
})

const ProviderDbRefreshResultSchema = z.object({
  status: z.enum(['updated', 'not-modified', 'skipped', 'error']),
  lastUpdated: z.number().nullable(),
  providersCount: z.number().int().nonnegative(),
  message: z.string().optional()
})

const HookEventNameSchema = z.enum([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
  'SessionEnd'
])

const HookCommandItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  enabled: z.boolean(),
  command: z.string(),
  events: z.array(HookEventNameSchema)
})

const HooksNotificationsSettingsSchema = z.object({
  hooks: z.array(HookCommandItemSchema)
})

const HookTestResultSchema = z.object({
  success: z.boolean(),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().int().nullable().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  error: z.string().optional(),
  statusCode: z.number().int().optional(),
  retryAfterMs: z.number().optional()
})

export const configRefreshProviderDbRoute = defineRouteContract({
  name: 'config.refreshProviderDb',
  input: z
    .object({
      force: z.boolean().optional()
    })
    .default({}),
  output: z.object({
    result: ProviderDbRefreshResultSchema
  })
})

export const configGetHooksNotificationsRoute = defineRouteContract({
  name: 'config.getHooksNotifications',
  input: z.object({}).default({}),
  output: z.object({
    config: HooksNotificationsSettingsSchema
  })
})

export const configSetHooksNotificationsRoute = defineRouteContract({
  name: 'config.setHooksNotifications',
  input: z.object({
    config: HooksNotificationsSettingsSchema
  }),
  output: z.object({
    config: HooksNotificationsSettingsSchema
  })
})

export const configTestHookCommandRoute = defineRouteContract({
  name: 'config.testHookCommand',
  input: z.object({
    hookId: z.string().min(1)
  }),
  output: z.object({
    result: HookTestResultSchema
  })
})

export const configGetDefaultProjectPathRoute = defineRouteContract({
  name: 'config.getDefaultProjectPath',
  input: z.object({}).default({}),
  output: z.object({
    path: z.string().nullable()
  })
})

export const configSetDefaultProjectPathRoute = defineRouteContract({
  name: 'config.setDefaultProjectPath',
  input: z.object({
    path: z.string().nullable()
  }),
  output: z.object({
    path: z.string().nullable()
  })
})

export const configGetShortcutKeysRoute = defineRouteContract({
  name: 'config.getShortcutKeys',
  input: z.object({}).default({}),
  output: z.object({
    shortcuts: ShortcutKeySettingSchema
  })
})

export const configSetShortcutKeysRoute = defineRouteContract({
  name: 'config.setShortcutKeys',
  input: z.object({
    shortcuts: ShortcutKeySettingSchema
  }),
  output: z.object({
    shortcuts: ShortcutKeySettingSchema
  })
})

export const configResetShortcutKeysRoute = defineRouteContract({
  name: 'config.resetShortcutKeys',
  input: z.object({}).default({}),
  output: z.object({
    shortcuts: ShortcutKeySettingSchema
  })
})

export const configListCustomPromptsRoute = defineRouteContract({
  name: 'config.listCustomPrompts',
  input: z.object({}).default({}),
  output: z.object({
    prompts: z.array(PromptSchema)
  })
})

export const configSetCustomPromptsRoute = defineRouteContract({
  name: 'config.setCustomPrompts',
  input: z.object({
    prompts: z.array(PromptSchema)
  }),
  output: z.object({
    prompts: z.array(PromptSchema)
  })
})

export const configAddCustomPromptRoute = defineRouteContract({
  name: 'config.addCustomPrompt',
  input: z.object({
    prompt: PromptSchema
  }),
  output: z.object({
    prompts: z.array(PromptSchema)
  })
})

export const configUpdateCustomPromptRoute = defineRouteContract({
  name: 'config.updateCustomPrompt',
  input: z.object({
    promptId: z.string().min(1),
    updates: PromptSchema.partial()
  }),
  output: z.object({
    prompts: z.array(PromptSchema)
  })
})

export const configDeleteCustomPromptRoute = defineRouteContract({
  name: 'config.deleteCustomPrompt',
  input: z.object({
    promptId: z.string().min(1)
  }),
  output: z.object({
    prompts: z.array(PromptSchema)
  })
})

export const configGetSystemPromptsRoute = defineRouteContract({
  name: 'config.getSystemPrompts',
  input: z.object({}).default({}),
  output: z.object({
    prompts: z.array(SystemPromptSchema),
    defaultPromptId: z.string()
  })
})

export const configSetSystemPromptsRoute = defineRouteContract({
  name: 'config.setSystemPrompts',
  input: z.object({
    prompts: z.array(SystemPromptSchema)
  }),
  output: z.object({
    prompts: z.array(SystemPromptSchema),
    defaultPromptId: z.string()
  })
})

export const configAddSystemPromptRoute = defineRouteContract({
  name: 'config.addSystemPrompt',
  input: z.object({
    prompt: SystemPromptSchema
  }),
  output: z.object({
    prompts: z.array(SystemPromptSchema),
    defaultPromptId: z.string()
  })
})

export const configUpdateSystemPromptRoute = defineRouteContract({
  name: 'config.updateSystemPrompt',
  input: z.object({
    promptId: z.string().min(1),
    updates: SystemPromptSchema.partial()
  }),
  output: z.object({
    prompts: z.array(SystemPromptSchema),
    defaultPromptId: z.string()
  })
})

export const configDeleteSystemPromptRoute = defineRouteContract({
  name: 'config.deleteSystemPrompt',
  input: z.object({
    promptId: z.string().min(1)
  }),
  output: z.object({
    prompts: z.array(SystemPromptSchema),
    defaultPromptId: z.string()
  })
})

export const configGetDefaultSystemPromptRoute = defineRouteContract({
  name: 'config.getDefaultSystemPrompt',
  input: z.object({}).default({}),
  output: z.object({
    prompt: z.string(),
    defaultPromptId: z.string()
  })
})

export const configSetDefaultSystemPromptRoute = defineRouteContract({
  name: 'config.setDefaultSystemPrompt',
  input: z.object({
    prompt: z.string()
  }),
  output: z.object({
    prompt: z.string(),
    defaultPromptId: z.string()
  })
})

export const configResetDefaultSystemPromptRoute = defineRouteContract({
  name: 'config.resetDefaultSystemPrompt',
  input: z.object({}).default({}),
  output: z.object({
    prompt: z.string(),
    defaultPromptId: z.string()
  })
})

export const configClearDefaultSystemPromptRoute = defineRouteContract({
  name: 'config.clearDefaultSystemPrompt',
  input: z.object({}).default({}),
  output: z.object({
    prompt: z.string(),
    defaultPromptId: z.string()
  })
})

export const configSetDefaultSystemPromptIdRoute = defineRouteContract({
  name: 'config.setDefaultSystemPromptId',
  input: z.object({
    promptId: z.string().min(1)
  }),
  output: z.object({
    prompts: z.array(SystemPromptSchema),
    defaultPromptId: z.string(),
    prompt: z.string()
  })
})

export const configGetAcpStateRoute = defineRouteContract({
  name: 'config.getAcpState',
  input: z.object({}).default({}),
  output: z.object({
    enabled: z.boolean(),
    agents: z.array(AcpAgentConfigSchema)
  })
})

export const configSetAcpEnabledRoute = defineRouteContract({
  name: 'config.setAcpEnabled',
  input: z.object({
    enabled: z.boolean()
  }),
  output: z.object({
    enabled: z.boolean()
  })
})

export const configListAcpRegistryAgentsRoute = defineRouteContract({
  name: 'config.listAcpRegistryAgents',
  input: z.object({}).default({}),
  output: z.object({
    agents: z.array(AcpRegistryAgentSchema)
  })
})

export const configRefreshAcpRegistryRoute = defineRouteContract({
  name: 'config.refreshAcpRegistry',
  input: z
    .object({
      force: z.boolean().optional()
    })
    .default({}),
  output: z.object({
    agents: z.array(AcpRegistryAgentSchema)
  })
})

export const configSetAcpAgentEnabledRoute = defineRouteContract({
  name: 'config.setAcpAgentEnabled',
  input: z.object({
    agentId: z.string().min(1),
    enabled: z.boolean()
  }),
  output: z.object({
    ok: z.boolean()
  })
})

export const configSetAcpAgentEnvOverrideRoute = defineRouteContract({
  name: 'config.setAcpAgentEnvOverride',
  input: z.object({
    agentId: z.string().min(1),
    env: z.record(z.string(), z.string())
  }),
  output: z.object({
    ok: z.boolean()
  })
})

export const configEnsureAcpAgentInstalledRoute = defineRouteContract({
  name: 'config.ensureAcpAgentInstalled',
  input: z.object({
    agentId: z.string().min(1)
  }),
  output: z.object({
    installState: AgentInstallStateSchema
  })
})

export const configRepairAcpAgentRoute = defineRouteContract({
  name: 'config.repairAcpAgent',
  input: z.object({
    agentId: z.string().min(1)
  }),
  output: z.object({
    installState: AgentInstallStateSchema
  })
})

export const configUninstallAcpRegistryAgentRoute = defineRouteContract({
  name: 'config.uninstallAcpRegistryAgent',
  input: z.object({
    agentId: z.string().min(1)
  }),
  output: z.object({
    ok: z.boolean()
  })
})

export const configListManualAcpAgentsRoute = defineRouteContract({
  name: 'config.listManualAcpAgents',
  input: z.object({}).default({}),
  output: z.object({
    agents: z.array(AcpManualAgentSchema)
  })
})

export const configAddManualAcpAgentRoute = defineRouteContract({
  name: 'config.addManualAcpAgent',
  input: AcpManualAgentInputSchema,
  output: z.object({
    agent: AcpManualAgentSchema
  })
})

export const configUpdateManualAcpAgentRoute = defineRouteContract({
  name: 'config.updateManualAcpAgent',
  input: z.object({
    agentId: z.string().min(1),
    updates: AcpManualAgentUpdateSchema
  }),
  output: z.object({
    agent: AcpManualAgentSchema.nullable()
  })
})

export const configRemoveManualAcpAgentRoute = defineRouteContract({
  name: 'config.removeManualAcpAgent',
  input: z.object({
    agentId: z.string().min(1)
  }),
  output: z.object({
    removed: z.boolean()
  })
})

export const configListAgentsRoute = defineRouteContract({
  name: 'config.listAgents',
  input: z
    .object({
      agentType: z.enum(['deepchat', 'acp']).optional(),
      ids: z.array(z.string().min(1)).optional()
    })
    .default({}),
  output: z.object({
    agents: z.array(AgentSchema)
  })
})

export const configCreateDeepChatAgentRoute = defineRouteContract({
  name: 'config.createDeepChatAgent',
  input: DeepChatAgentCreateInputSchema,
  output: z.object({
    agent: AgentSchema
  })
})

export const configUpdateDeepChatAgentRoute = defineRouteContract({
  name: 'config.updateDeepChatAgent',
  input: z.object({
    agentId: z.string().min(1),
    updates: DeepChatAgentUpdateInputSchema
  }),
  output: z.object({
    agent: AgentSchema.nullable()
  })
})

export const configDeleteDeepChatAgentRoute = defineRouteContract({
  name: 'config.deleteDeepChatAgent',
  input: z.object({
    agentId: z.string().min(1)
  }),
  output: z.object({
    removed: z.boolean()
  })
})

export const configResolveDeepChatAgentConfigRoute = defineRouteContract({
  name: 'config.resolveDeepChatAgentConfig',
  input: z.object({
    agentId: z.string().min(1)
  }),
  output: z.object({
    config: DeepChatAgentConfigSchema
  })
})

export const configGetAgentMcpSelectionsRoute = defineRouteContract({
  name: 'config.getAgentMcpSelections',
  input: z.object({
    agentId: z.string().min(1)
  }),
  output: z.object({
    selections: z.array(z.string())
  })
})

export const configGetAcpSharedMcpSelectionsRoute = defineRouteContract({
  name: 'config.getAcpSharedMcpSelections',
  input: z.object({}).default({}),
  output: z.object({
    selections: z.array(z.string())
  })
})

export const configSetAcpSharedMcpSelectionsRoute = defineRouteContract({
  name: 'config.setAcpSharedMcpSelections',
  input: z.object({
    selections: z.array(z.string())
  }),
  output: z.object({
    selections: z.array(z.string())
  })
})

export const configGetMcpServersRoute = defineRouteContract({
  name: 'config.getMcpServers',
  input: z.object({}).default({}),
  output: z.object({
    servers: z.record(z.string(), McpServerConfigSchema)
  })
})

export const configGetKnowledgeConfigsRoute = defineRouteContract({
  name: 'config.getKnowledgeConfigs',
  input: z.object({}).default({}),
  output: z.object({
    configs: z.array(BuiltinKnowledgeConfigSchema)
  })
})

export const configSetKnowledgeConfigsRoute = defineRouteContract({
  name: 'config.setKnowledgeConfigs',
  input: z.object({
    configs: z.array(BuiltinKnowledgeConfigSchema)
  }),
  output: z.object({
    configs: z.array(BuiltinKnowledgeConfigSchema)
  })
})

export const configGetAcpRegistryIconMarkupRoute = defineRouteContract({
  name: 'config.getAcpRegistryIconMarkup',
  input: z.object({
    agentId: z.string().min(1),
    iconUrl: z.string().min(1)
  }),
  output: z.object({
    markup: z.string()
  })
})

const VoiceAiConfigSchema = z.object({
  audioFormat: z.string(),
  model: z.string(),
  language: z.string(),
  temperature: z.number(),
  topP: z.number(),
  agentId: z.string()
})

export const configGetVoiceAiConfigRoute = defineRouteContract({
  name: 'config.getVoiceAiConfig',
  input: z.object({}).default({}),
  output: z.object({
    config: VoiceAiConfigSchema
  })
})

export const configUpdateVoiceAiConfigRoute = defineRouteContract({
  name: 'config.updateVoiceAiConfig',
  input: z.object({
    updates: VoiceAiConfigSchema.partial()
  }),
  output: z.object({
    config: VoiceAiConfigSchema
  })
})

export const configGetGeminiSafetyRoute = defineRouteContract({
  name: 'config.getGeminiSafety',
  input: z.object({
    key: z.string().min(1)
  }),
  output: z.object({
    value: z.string()
  })
})

export const configSetGeminiSafetyRoute = defineRouteContract({
  name: 'config.setGeminiSafety',
  input: z.object({
    key: z.string().min(1),
    value: z.enum([
      'BLOCK_NONE',
      'BLOCK_ONLY_HIGH',
      'BLOCK_MEDIUM_AND_ABOVE',
      'BLOCK_LOW_AND_ABOVE',
      'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
    ])
  }),
  output: z.object({
    value: z.string()
  })
})

export const configGetAzureApiVersionRoute = defineRouteContract({
  name: 'config.getAzureApiVersion',
  input: z.object({}).default({}),
  output: z.object({
    version: z.string()
  })
})

export const configSetAzureApiVersionRoute = defineRouteContract({
  name: 'config.setAzureApiVersion',
  input: z.object({
    version: z.string().min(1)
  }),
  output: z.object({
    version: z.string()
  })
})

export const configGetAwsBedrockCredentialRoute = defineRouteContract({
  name: 'config.getAwsBedrockCredential',
  input: z.object({}).default({}),
  output: z.object({
    value: ConfigValueSchema.optional()
  })
})

export const configSetAwsBedrockCredentialRoute = defineRouteContract({
  name: 'config.setAwsBedrockCredential',
  input: z.object({
    credential: ConfigValueSchema
  }),
  output: z.object({
    value: ConfigValueSchema.optional()
  })
})

export type ConfigEntryKey = z.infer<typeof ConfigEntryKeySchema>
export type ConfigEntryValues = z.infer<typeof ConfigEntryValuesSchema>
export type ConfigEntryChange = z.infer<typeof ConfigEntryChangeSchema>
