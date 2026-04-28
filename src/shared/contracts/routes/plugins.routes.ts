import { z } from 'zod'
import { defineRouteContract, JsonValueSchema } from '../common'
import type {
  PluginActionResult,
  PluginInstallRequest,
  PluginInvokeActionRequest,
  PluginListItem
} from '@shared/types/plugin'
import { OFFICIAL_PLUGIN_SOURCE } from '@shared/types/plugin'

const PluginListItemSchema = z.custom<PluginListItem>()
const PluginActionResultSchema = z.custom<PluginActionResult>()

export const pluginsListRoute = defineRouteContract({
  name: 'plugins.list',
  input: z.object({}),
  output: z.object({
    plugins: z.array(PluginListItemSchema)
  })
})

export const pluginsGetRoute = defineRouteContract({
  name: 'plugins.get',
  input: z.object({
    pluginId: z.string().min(1)
  }),
  output: z.object({
    plugin: PluginListItemSchema.optional()
  })
})

export const pluginsInstallRoute = defineRouteContract({
  name: 'plugins.install',
  input: z.object({
    pluginId: z.string().min(1),
    source: z.literal(OFFICIAL_PLUGIN_SOURCE)
  }) satisfies z.ZodType<PluginInstallRequest>,
  output: z.object({
    result: PluginActionResultSchema
  })
})

export const pluginsEnableRoute = defineRouteContract({
  name: 'plugins.enable',
  input: z.object({
    pluginId: z.string().min(1)
  }),
  output: z.object({
    result: PluginActionResultSchema
  })
})

export const pluginsDisableRoute = defineRouteContract({
  name: 'plugins.disable',
  input: z.object({
    pluginId: z.string().min(1)
  }),
  output: z.object({
    result: PluginActionResultSchema
  })
})

export const pluginsDeleteRoute = defineRouteContract({
  name: 'plugins.delete',
  input: z.object({
    pluginId: z.string().min(1)
  }),
  output: z.object({
    result: PluginActionResultSchema
  })
})

export const pluginsInvokeActionRoute = defineRouteContract({
  name: 'plugins.invokeAction',
  input: z.object({
    pluginId: z.string().min(1),
    actionId: z.string().min(1),
    payload: JsonValueSchema.optional()
  }) satisfies z.ZodType<PluginInvokeActionRequest>,
  output: z.object({
    result: PluginActionResultSchema
  })
})
