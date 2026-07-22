import { z } from 'zod'
import { RevisionSchema, defineEventContract } from '../common'
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
    version: RevisionSchema
  })
})

export const configThemeChangedEvent = defineEventContract({
  name: 'config.theme.changed',
  payload: z.object({
    theme: ThemeModeSchema,
    isDark: z.boolean(),
    version: RevisionSchema
  })
})

export const configSystemThemeChangedEvent = defineEventContract({
  name: 'config.systemTheme.changed',
  payload: z.object({
    isDark: z.boolean(),
    version: RevisionSchema
  })
})

export const configFloatingButtonChangedEvent = defineEventContract({
  name: 'config.floatingButton.changed',
  payload: z.object({
    enabled: z.boolean(),
    version: RevisionSchema
  })
})

export const configSyncSettingsChangedEvent = defineEventContract({
  name: 'config.syncSettings.changed',
  payload: z.object({
    enabled: z.boolean(),
    folderPath: z.string(),
    version: RevisionSchema
  })
})

export const configDefaultProjectPathChangedEvent = defineEventContract({
  name: 'config.defaultProjectPath.changed',
  payload: z.object({
    path: z.string().nullable(),
    version: RevisionSchema
  })
})

export const configAgentsChangedEvent = defineEventContract({
  name: 'config.agents.changed',
  payload: z.object({
    enabled: z.boolean(),
    agents: z.array(AcpAgentConfigSchema),
    agentIds: z.array(z.string()).optional(),
    version: RevisionSchema
  })
})

export const configShortcutKeysChangedEvent = defineEventContract({
  name: 'config.shortcutKeys.changed',
  payload: z.object({
    shortcuts: ShortcutKeySettingSchema,
    version: RevisionSchema
  })
})

export const configSystemPromptsChangedEvent = defineEventContract({
  name: 'config.systemPrompts.changed',
  payload: z.object({
    prompts: z.array(SystemPromptSchema),
    defaultPromptId: z.string(),
    prompt: z.string(),
    version: RevisionSchema
  })
})

export const configCustomPromptsChangedEvent = defineEventContract({
  name: 'config.customPrompts.changed',
  payload: z.object({
    prompts: z.array(PromptSchema),
    version: RevisionSchema
  })
})
