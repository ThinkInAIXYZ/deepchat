import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import {
  AcpAgentConfigSchema,
  LanguageDirectionSchema,
  PromptSchema,
  ShortcutKeySettingSchema,
  SystemPromptSchema,
  ThemeModeSchema
} from '../domainSchemas'

export const configLanguageChangedEvent = defineEventContract({
  name: 'config.language.changed',
  payload: z.object({
    requestedLanguage: z.string(),
    locale: z.string(),
    direction: LanguageDirectionSchema,
    version: TimestampMsSchema
  })
})

export const configThemeChangedEvent = defineEventContract({
  name: 'config.theme.changed',
  payload: z.object({
    theme: ThemeModeSchema,
    isDark: z.boolean(),
    version: TimestampMsSchema
  })
})

export const configSystemThemeChangedEvent = defineEventContract({
  name: 'config.systemTheme.changed',
  payload: z.object({
    isDark: z.boolean(),
    version: TimestampMsSchema
  })
})

export const configFloatingButtonChangedEvent = defineEventContract({
  name: 'config.floatingButton.changed',
  payload: z.object({
    enabled: z.boolean(),
    version: TimestampMsSchema
  })
})

export const configSyncSettingsChangedEvent = defineEventContract({
  name: 'config.syncSettings.changed',
  payload: z.object({
    enabled: z.boolean(),
    folderPath: z.string(),
    version: TimestampMsSchema
  })
})

export const configDefaultProjectPathChangedEvent = defineEventContract({
  name: 'config.defaultProjectPath.changed',
  payload: z.object({
    path: z.string().nullable(),
    version: TimestampMsSchema
  })
})

export const configAgentsChangedEvent = defineEventContract({
  name: 'config.agents.changed',
  payload: z.object({
    enabled: z.boolean(),
    agents: z.array(AcpAgentConfigSchema),
    agentIds: z.array(z.string()).optional(),
    version: TimestampMsSchema
  })
})

export const configShortcutKeysChangedEvent = defineEventContract({
  name: 'config.shortcutKeys.changed',
  payload: z.object({
    shortcuts: ShortcutKeySettingSchema,
    version: TimestampMsSchema
  })
})

export const configSystemPromptsChangedEvent = defineEventContract({
  name: 'config.systemPrompts.changed',
  payload: z.object({
    prompts: z.array(SystemPromptSchema),
    defaultPromptId: z.string(),
    prompt: z.string(),
    version: TimestampMsSchema
  })
})

export const configCustomPromptsChangedEvent = defineEventContract({
  name: 'config.customPrompts.changed',
  payload: z.object({
    prompts: z.array(PromptSchema),
    version: TimestampMsSchema
  })
})
