import { z } from 'zod'
import { defineRouteContract, JsonValueSchema } from '../common'
import type {
  PluginActionResult,
  PluginInvokeActionRequest,
  PluginListItem
} from '@shared/types/plugin'
import type { PluginCatalog, PluginCatalogEntry } from '@shared/types/pluginCatalog'

const PluginListItemSchema = z.custom<PluginListItem>()
const PluginActionResultSchema = z.custom<PluginActionResult>()

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

/**
 * Artifact URLs must be https. Plain http is only allowed for loopback hosts
 * so the local-fixture e2e flow (spec §4.4) can drive installs without a TLS
 * server; remote hosts can never be fetched over plaintext.
 */
const ArtifactUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(8192)
  .refine(isHttpsOrLoopbackUrl, {
    message: 'Artifact URLs must be https (plain http is only allowed for loopback hosts)'
  })

function isHttpsOrLoopbackUrl(url: string): boolean {
  if (url.startsWith('https://')) return true
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

const PluginCatalogTargetSchema = z
  .object({
    platform: z.enum(['darwin', 'win32', 'linux']),
    arch: z.enum(['arm64', 'x64']),
    url: ArtifactUrlSchema,
    sha256: Sha256Schema,
    size: z.number().int().positive(),
    // Mirror prefixes are concatenated with the canonical URL (ghproxy style).
    mirrors: z.array(ArtifactUrlSchema.max(2048)).max(8)
  })
  .strict()

export const PluginCatalogArtifactSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
    channel: z.enum(['stable', 'pre-release']),
    displayName: z.string().min(1).max(256).optional(),
    description: z.string().max(2048).optional(),
    minAppVersion: z.string().min(1).max(64).optional(),
    targets: z.array(PluginCatalogTargetSchema).min(1).max(8)
  })
  .strict()

export const RuntimeCatalogAssetSchema = z
  .object({
    id: z.string().min(1).max(128),
    version: z.string().min(1).max(128),
    channel: z.enum(['stable', 'pre-release']),
    displayName: z.string().min(1).max(256).optional(),
    description: z.string().max(2048).optional(),
    minAppVersion: z.string().min(1).max(64).optional(),
    targets: z.array(PluginCatalogTargetSchema).min(1).max(8)
  })
  .strict()

export const PluginCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    artifacts: z.array(PluginCatalogArtifactSchema).max(64),
    runtimeAssets: z.array(RuntimeCatalogAssetSchema).max(16).optional()
  })
  .strict()

export const PluginCatalogInstallPhaseSchema = z.enum([
  'idle',
  'probing',
  'downloading',
  'verifying',
  'installing',
  'installed',
  'error',
  'cancelled'
])

export type ParsedPluginCatalog = z.infer<typeof PluginCatalogSchema>

export function parsePluginCatalog(input: unknown, source = '<catalog>'): PluginCatalog {
  try {
    return PluginCatalogSchema.parse(input) as PluginCatalog
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0]
      const pointer = issue ? ` (${issue.path.join('.')}: ${issue.message})` : ''
      throw new Error(`Invalid plugin catalog ${source}${pointer}`)
    }
    throw error
  }
}

export const pluginsCatalogListRoute = defineRouteContract({
  name: 'plugins.catalog.list',
  input: z.object({}).strict(),
  output: z.object({
    entries: z.array(z.custom<PluginCatalogEntry>())
  })
})

export const pluginsCatalogInstallRoute = defineRouteContract({
  name: 'plugins.catalog.install',
  input: z.object({ pluginId: z.string().min(1).max(128) }).strict(),
  output: z.object({
    result: PluginActionResultSchema
  })
})

export const pluginsCatalogCancelRoute = defineRouteContract({
  name: 'plugins.catalog.cancel',
  input: z.object({ pluginId: z.string().min(1).max(128) }).strict(),
  output: z.object({
    cancelled: z.boolean()
  })
})

export const pluginsCatalogInstallFromPathRoute = defineRouteContract({
  name: 'plugins.catalog.installFromPath',
  input: z.object({ path: z.string().min(1).max(4096) }).strict(),
  output: z.object({
    result: z.object({
      ok: z.boolean(),
      pluginId: z.string().min(1).max(128).optional(),
      error: z.string().max(2048).optional()
    })
  })
})

export const pluginsUninstallOfficialRoute = defineRouteContract({
  name: 'plugins.uninstallOfficial',
  input: z.object({ pluginId: z.string().min(1).max(128) }).strict(),
  output: z.object({
    result: PluginActionResultSchema
  })
})

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
      url: z.url({ protocol: /^https$/ }).max(8192),
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
      pluginId: z.string().min(1).max(128).optional(),
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
      pluginId: z.string().min(1).max(128),
      serverName: z.string().min(1).max(256),
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
    .object({
      pluginId: z.string().min(1).max(128),
      invocationId: z.string().regex(/^[a-f0-9]{64}$/)
    })
    .strict(),
  output: z.object({})
})
