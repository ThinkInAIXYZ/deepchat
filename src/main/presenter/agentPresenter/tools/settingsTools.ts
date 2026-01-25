import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type {
  ApplyChatSettingResult,
  ChatSettingValue,
  ChatLanguage,
  OpenChatSettingsResult,
  OpenChatSettingsSection,
  MCPToolDefinition,
  IConfigPresenter,
  ISkillPresenter,
  ISessionPresenter,
  IWindowPresenter
} from '@shared/presenter'
import { SETTINGS_EVENTS } from '@/events'

export const CHAT_SETTINGS_SKILL_NAME = 'deepchat-settings'
export const CHAT_SETTINGS_TOOL_NAMES = {
  toggle: 'deepchat_settings_toggle',
  setLanguage: 'deepchat_settings_set_language',
  setTheme: 'deepchat_settings_set_theme',
  setFontSize: 'deepchat_settings_set_font_size',
  open: 'deepchat_settings_open'
} as const

const SUPPORTED_LANGUAGES = [
  'system',
  'zh-CN',
  'en-US',
  'zh-TW',
  'zh-HK',
  'ko-KR',
  'ru-RU',
  'ja-JP',
  'fr-FR',
  'fa-IR',
  'pt-BR',
  'da-DK',
  'he-IL'
] as const satisfies readonly ChatLanguage[]

const SUPPORTED_THEMES = ['dark', 'light', 'system'] as const

const FONT_SIZE_LEVELS = [0, 1, 2, 3, 4] as const

const toggleSchema = z
  .object({
    setting: z.enum(['soundEnabled', 'copyWithCotEnabled']).describe('Toggle setting id.'),
    enabled: z.boolean().describe('Enable or disable the setting.')
  })
  .strict()

const languageSchema = z
  .object({
    language: z.enum(SUPPORTED_LANGUAGES).describe('DeepChat language/locale.')
  })
  .strict()

const themeSchema = z
  .object({
    theme: z.enum(SUPPORTED_THEMES).describe('Theme mode for DeepChat.')
  })
  .strict()

const fontSizeSchema = z
  .object({
    level: z
      .union(
        FONT_SIZE_LEVELS.map((value) => z.literal(value)) as [
          z.ZodLiteral<0>,
          z.ZodLiteral<1>,
          z.ZodLiteral<2>,
          z.ZodLiteral<3>,
          z.ZodLiteral<4>
        ]
      )
      .describe('Font size level (0-4).')
  })
  .strict()

const SECTION_ALIASES: Record<string, OpenChatSettingsSection> = {
  appearance: 'display',
  theme: 'display',
  language: 'display',
  font: 'display',
  'font-size': 'display',
  sound: 'common',
  copy: 'common',
  'copy-cot': 'common',
  proxy: 'common',
  prompts: 'prompt',
  providers: 'provider'
}

const OPEN_SECTIONS = [
  'common',
  'display',
  'provider',
  'mcp',
  'prompt',
  'skills',
  'knowledge-base',
  'database',
  'shortcut',
  'about'
] as const satisfies readonly OpenChatSettingsSection[]

const OPEN_SECTION_ALIASES = [
  'appearance',
  'theme',
  'language',
  'font',
  'font-size',
  'sound',
  'copy',
  'copy-cot',
  'proxy',
  'prompts',
  'providers'
] as const

const OPEN_SECTION_VALUES = [...OPEN_SECTIONS, ...OPEN_SECTION_ALIASES] as const

const openSchema = z
  .object({
    section: z.enum([...OPEN_SECTION_VALUES] as [string, ...string[]]).optional()
  })
  .strict()

const SETTINGS_ROUTE_NAMES: Record<OpenChatSettingsSection, string> = {
  common: 'settings-common',
  display: 'settings-display',
  provider: 'settings-provider',
  mcp: 'settings-mcp',
  prompt: 'settings-prompt',
  skills: 'settings-skills',
  'knowledge-base': 'settings-knowledge-base',
  database: 'settings-database',
  shortcut: 'settings-shortcut',
  about: 'settings-about'
}

const normalizeSection = (section?: string): OpenChatSettingsSection | undefined => {
  if (!section) return undefined
  const normalized = section.trim().toLowerCase()
  if (!normalized) return undefined
  if (OPEN_SECTIONS.includes(normalized as OpenChatSettingsSection)) {
    return normalized as OpenChatSettingsSection
  }
  return SECTION_ALIASES[normalized]
}

type ApplyError = Extract<ApplyChatSettingResult, { ok: false }>

const buildError = (
  errorCode: ApplyError['errorCode'],
  message: string,
  details?: unknown
): ApplyError => ({
  ok: false,
  errorCode,
  message,
  ...(details ? { details } : {})
})

export class ChatSettingsToolHandler {
  constructor(
    private readonly options: {
      configPresenter: IConfigPresenter
      skillPresenter: ISkillPresenter
      sessionPresenter: ISessionPresenter
      windowPresenter: IWindowPresenter
    }
  ) {}

  private async ensureSkillActive(conversationId?: string): Promise<ApplyChatSettingResult | null> {
    if (!conversationId) {
      return buildError('skill_inactive', 'No conversation context to apply settings.')
    }
    if (!this.options.configPresenter.getSkillsEnabled()) {
      return buildError('skill_inactive', 'Skills are disabled.')
    }
    const activeSkills = await this.options.skillPresenter.getActiveSkills(conversationId)
    if (!activeSkills.includes(CHAT_SETTINGS_SKILL_NAME)) {
      return buildError('skill_inactive', 'deepchat-settings skill is not active.')
    }
    return null
  }

  private getCurrentValue(key: string): ChatSettingValue | undefined {
    const configPresenter = this.options.configPresenter
    switch (key) {
      case 'soundEnabled':
        return configPresenter.getSoundEnabled()
      case 'copyWithCotEnabled':
        return configPresenter.getCopyWithCotEnabled()
      case 'language':
        return configPresenter.getSetting('language')
      case 'theme':
        return configPresenter.getSetting('appTheme')
      case 'fontSizeLevel':
        return configPresenter.getSetting('fontSizeLevel')
      default:
        return undefined
    }
  }

  async toggle(raw: unknown, conversationId?: string): Promise<ApplyChatSettingResult> {
    const guard = await this.ensureSkillActive(conversationId)
    if (guard) {
      return guard
    }

    const parsed = toggleSchema.safeParse(raw)
    if (!parsed.success) {
      return buildError('invalid_request', 'Invalid toggle request.', parsed.error.flatten())
    }

    const { setting, enabled } = parsed.data
    const previousValue = this.getCurrentValue(setting)
    const configPresenter = this.options.configPresenter

    try {
      switch (setting) {
        case 'soundEnabled':
          configPresenter.setSoundEnabled(enabled)
          break
        case 'copyWithCotEnabled':
          configPresenter.setCopyWithCotEnabled(enabled)
          break
        default:
          return buildError('unknown_setting', `Unsupported toggle: ${setting}`)
      }
    } catch (error) {
      return buildError(
        'apply_failed',
        'Failed to apply DeepChat toggle.',
        error instanceof Error ? error.message : String(error)
      )
    }

    return {
      ok: true,
      id: setting,
      value: enabled,
      previousValue,
      appliedAt: Date.now()
    }
  }

  async setLanguage(raw: unknown, conversationId?: string): Promise<ApplyChatSettingResult> {
    const guard = await this.ensureSkillActive(conversationId)
    if (guard) {
      return guard
    }

    const parsed = languageSchema.safeParse(raw)
    if (!parsed.success) {
      return buildError('invalid_request', 'Invalid language request.', parsed.error.flatten())
    }

    const { language } = parsed.data
    const previousValue = this.getCurrentValue('language')
    try {
      this.options.configPresenter.setLanguage(language)
    } catch (error) {
      return buildError(
        'apply_failed',
        'Failed to apply DeepChat language.',
        error instanceof Error ? error.message : String(error)
      )
    }

    return {
      ok: true,
      id: 'language',
      value: language,
      previousValue,
      appliedAt: Date.now()
    }
  }

  async setTheme(raw: unknown, conversationId?: string): Promise<ApplyChatSettingResult> {
    const guard = await this.ensureSkillActive(conversationId)
    if (guard) {
      return guard
    }

    const parsed = themeSchema.safeParse(raw)
    if (!parsed.success) {
      return buildError('invalid_request', 'Invalid theme request.', parsed.error.flatten())
    }

    const { theme } = parsed.data
    const previousValue = this.getCurrentValue('theme')
    try {
      await this.options.configPresenter.setTheme(theme)
    } catch (error) {
      return buildError(
        'apply_failed',
        'Failed to apply DeepChat theme.',
        error instanceof Error ? error.message : String(error)
      )
    }

    return {
      ok: true,
      id: 'theme',
      value: theme,
      previousValue,
      appliedAt: Date.now()
    }
  }

  async setFontSize(raw: unknown, conversationId?: string): Promise<ApplyChatSettingResult> {
    const guard = await this.ensureSkillActive(conversationId)
    if (guard) {
      return guard
    }

    const parsed = fontSizeSchema.safeParse(raw)
    if (!parsed.success) {
      return buildError('invalid_request', 'Invalid font size request.', parsed.error.flatten())
    }

    const { level } = parsed.data
    const previousValue = this.getCurrentValue('fontSizeLevel')
    try {
      this.options.configPresenter.setSetting('fontSizeLevel', level)
    } catch (error) {
      return buildError(
        'apply_failed',
        'Failed to apply DeepChat font size.',
        error instanceof Error ? error.message : String(error)
      )
    }

    return {
      ok: true,
      id: 'fontSizeLevel',
      value: level,
      previousValue,
      appliedAt: Date.now()
    }
  }

  async open(raw: unknown, conversationId?: string): Promise<OpenChatSettingsResult> {
    const guard = await this.ensureSkillActive(conversationId)
    if (guard && !guard.ok) {
      return {
        ok: false,
        errorCode: 'skill_inactive',
        message: guard.message,
        details: guard.details
      }
    }

    const parsed = openSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        errorCode: 'invalid_request',
        message: 'Invalid settings navigation request.',
        details: parsed.error.flatten()
      }
    }

    const { section } = parsed.data
    const normalizedSection = normalizeSection(section)
    const routeName = normalizedSection ? SETTINGS_ROUTE_NAMES[normalizedSection] : undefined

    const windowId = await this.options.windowPresenter.createSettingsWindow()
    if (!windowId) {
      return {
        ok: false,
        errorCode: 'open_failed',
        message: 'Failed to open settings window.'
      }
    }

    if (routeName) {
      this.options.windowPresenter.sendToWindow(windowId, SETTINGS_EVENTS.NAVIGATE, {
        routeName,
        section: normalizedSection
      })
    }

    return {
      ok: true,
      section: normalizedSection,
      routeName,
      appliedAt: Date.now()
    }
  }
}

export const buildChatSettingsToolDefinitions = (allowedTools: string[]): MCPToolDefinition[] => {
  const definitions: MCPToolDefinition[] = []
  const allowToggle = allowedTools.includes(CHAT_SETTINGS_TOOL_NAMES.toggle)
  const allowLanguage = allowedTools.includes(CHAT_SETTINGS_TOOL_NAMES.setLanguage)
  const allowTheme = allowedTools.includes(CHAT_SETTINGS_TOOL_NAMES.setTheme)
  const allowFontSize = allowedTools.includes(CHAT_SETTINGS_TOOL_NAMES.setFontSize)
  const allowOpen = allowedTools.includes(CHAT_SETTINGS_TOOL_NAMES.open)

  if (allowToggle) {
    definitions.push({
      type: 'function',
      function: {
        name: CHAT_SETTINGS_TOOL_NAMES.toggle,
        description: 'Toggle a DeepChat setting (sound or copy COT).',
        parameters: zodToJsonSchema(toggleSchema) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'deepchat-settings',
        icons: 'settings',
        description: 'DeepChat settings control'
      }
    })
  }

  if (allowLanguage) {
    definitions.push({
      type: 'function',
      function: {
        name: CHAT_SETTINGS_TOOL_NAMES.setLanguage,
        description: 'Set DeepChat language/locale.',
        parameters: zodToJsonSchema(languageSchema) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'deepchat-settings',
        icons: 'settings',
        description: 'DeepChat settings control'
      }
    })
  }

  if (allowTheme) {
    definitions.push({
      type: 'function',
      function: {
        name: CHAT_SETTINGS_TOOL_NAMES.setTheme,
        description: 'Set DeepChat theme mode.',
        parameters: zodToJsonSchema(themeSchema) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'deepchat-settings',
        icons: 'settings',
        description: 'DeepChat settings control'
      }
    })
  }

  if (allowFontSize) {
    definitions.push({
      type: 'function',
      function: {
        name: CHAT_SETTINGS_TOOL_NAMES.setFontSize,
        description: 'Set DeepChat font size level.',
        parameters: zodToJsonSchema(fontSizeSchema) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'deepchat-settings',
        icons: 'settings',
        description: 'DeepChat settings control'
      }
    })
  }

  if (allowOpen) {
    definitions.push({
      type: 'function',
      function: {
        name: CHAT_SETTINGS_TOOL_NAMES.open,
        description:
          'Open DeepChat settings only when the request cannot be fulfilled via other settings tools; do not call after the change is already applied.',
        parameters: zodToJsonSchema(openSchema) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'deepchat-settings',
        icons: 'settings',
        description: 'DeepChat settings control'
      }
    })
  }

  return definitions
}
