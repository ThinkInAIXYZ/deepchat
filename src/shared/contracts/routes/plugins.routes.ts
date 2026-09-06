import { z } from 'zod'
import { defineRouteContract, JsonValueSchema } from '../common'
import type {
  PluginActionResult,
  PluginInvokeActionRequest,
  PluginListItem
} from '@shared/types/plugin'

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

export const UserPluginSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('git'),
      url: z.string().url().max(8192),
      ref: z.string().max(256).optional(),
      subdirectory: z.string().max(1024).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('zip'),
      path: z.string().min(1).max(8192),
      subdirectory: z.string().max(1024).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('directory'),
      path: z.string().min(1).max(8192),
      subdirectory: z.string().max(1024).optional()
    })
    .strict()
])

export const pluginsInspectSourceRoute = defineRouteContract({
  name: 'plugins.inspectSource',
  input: z.object({ source: UserPluginSourceSchema, requestId: z.string().uuid() }).strict(),
  output: z.object({ prepared: z.custom<import('@shared/types/userPlugin').PreparedUserPlugin>() })
})

export const pluginsInstallUserRoute = defineRouteContract({
  name: 'plugins.installUser',
  input: z
    .object({
      operationId: z.string().uuid(),
      pluginId: z.string().max(128).optional(),
      selection: z.object({ skills: z.boolean(), hooks: z.boolean(), mcp: z.boolean() }).strict()
    })
    .strict(),
  output: z.object({ result: PluginActionResultSchema })
})

export const pluginsUninstallUserRoute = defineRouteContract({
  name: 'plugins.uninstallUser',
  input: z.object({ pluginId: z.string().min(1).max(128) }).strict(),
  output: z.object({ result: PluginActionResultSchema })
})

export const pluginsDiscardPreparedRoute = defineRouteContract({
  name: 'plugins.discardPrepared',
  input: z.object({ operationId: z.string().uuid() }).strict(),
  output: z.object({})
})

export const pluginsConfigureMcpRoute = defineRouteContract({
  name: 'plugins.configureMcp',
  input: z
    .object({
      pluginId: z.string().max(128),
      serverName: z.string().max(256),
      values: z
        .record(z.string().max(128), z.string().max(32768))
        .refine((values) => Object.keys(values).length <= 64)
    })
    .strict(),
  output: z.object({ result: PluginActionResultSchema })
})

export const pluginsRetryHookRoute = defineRouteContract({
  name: 'plugins.retryHook',
  input: z
    .object({ pluginId: z.string().max(128), invocationId: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict(),
  output: z.object({})
})
