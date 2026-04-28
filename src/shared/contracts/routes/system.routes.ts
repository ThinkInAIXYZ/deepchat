import { z } from 'zod'
import { defineRouteContract } from '../common'

export const SettingsRouteNameSchema = z.enum([
  'settings-common',
  'settings-display',
  'settings-environments',
  'settings-provider',
  'settings-dashboard',
  'settings-mcp',
  'settings-deepchat-agents',
  'settings-acp',
  'settings-remote',
  'settings-notifications-hooks',
  'settings-plugins',
  'settings-skills',
  'settings-prompt',
  'settings-knowledge-base',
  'settings-database',
  'settings-shortcut',
  'settings-about'
])

export const systemOpenSettingsRoute = defineRouteContract({
  name: 'system.openSettings',
  input: z
    .object({
      routeName: SettingsRouteNameSchema.optional(),
      params: z.record(z.string()).optional(),
      section: z.string().optional()
    })
    .default({}),
  output: z.object({
    windowId: z.number().int().nullable()
  })
})
