import { z } from 'zod'
import type {
  MCPServerConfig,
  MCPToolCall,
  MCPToolDefinition,
  MCPToolResponse,
  McpElicitationDecision,
  McpAppCallToolResult,
  McpAppDescriptor,
  McpAppPreparedView,
  McpAppServerPromptListResult,
  McpAppServerResourceListResult,
  McpAppServerResourceTemplateListResult,
  McpAppServerToolListResult,
  McpAddServerResult,
  McpClient,
  McpCredentialBinding,
  McpCredentialInput,
  McpCredentialStatus,
  McpEnterpriseIdentityProfile,
  McpEnterpriseIdentityStatus,
  McpServerAuthStatus,
  McpServerDiagnostics,
  McpSamplingDecision,
  McpToolAnnotations,
  PromptListEntry,
  Resource,
  ResourceListEntry,
  Tool
} from '@shared/types/mcp'
import { defineRouteContract, JsonValueSchema } from '../common'

const McpAuthorizationConfigSchema = z
  .object({
    mode: z.enum([
      'none',
      'interactive',
      'client_credentials',
      'private_key_jwt',
      'cross_app_access'
    ]),
    protectedResourceUrl: z.string().max(8192).optional(),
    authorizationServerIssuer: z.string().max(8192).optional(),
    clientMetadataUrl: z.string().max(8192).optional(),
    clientId: z.string().max(8192).optional(),
    scopes: z.array(z.string().min(1).max(2048)).max(256).optional(),
    identityProfileId: z.string().max(512).optional(),
    keyAlgorithm: z.enum(['RS256', 'ES256']).optional()
  })
  .strict()
const MCPServerConfigObjectSchema = z
  .object({
    command: z.string().max(32 * 1024),
    args: z.array(z.string().max(32 * 1024)).max(1024),
    env: z.record(z.string().max(512), JsonValueSchema),
    descriptions: z.string().max(64 * 1024),
    icons: z.string().max(8192),
    enabled: z.boolean(),
    disable: z.boolean().optional(),
    baseUrl: z.string().max(8192).optional(),
    customHeaders: z.record(z.string().min(1).max(512), z.string().max(256 * 1024)).optional(),
    customNpmRegistry: z.string().max(8192).optional(),
    type: z.enum(['sse', 'stdio', 'inmemory', 'http']),
    source: z.string().max(512).optional(),
    sourceId: z.string().max(512).optional(),
    ownerPluginId: z.string().max(512).optional(),
    inheritEnv: z.enum(['legacy', 'minimal']).optional(),
    serverId: z.string().uuid().optional(),
    configGeneration: z.number().int().positive().optional(),
    bindingHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    authorization: McpAuthorizationConfigSchema.optional(),
    forceLegacyWire: z.boolean().optional()
  })
  .catchall(JsonValueSchema)
const isBoundedServerConfig = (value: unknown): boolean => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 3 * 1024 * 1024
  } catch {
    return false
  }
}
const MCPServerConfigSchema: z.ZodType<MCPServerConfig> = MCPServerConfigObjectSchema.refine(
  isBoundedServerConfig,
  { message: 'MCP server configuration exceeds the 3 MiB route limit' }
)
const MCPServerConfigUpdateSchema: z.ZodType<Partial<MCPServerConfig>> =
  MCPServerConfigObjectSchema.partial().refine(isBoundedServerConfig, {
    message: 'MCP server configuration exceeds the 3 MiB route limit'
  })

// Leave room for the route envelope inside ApprovalBroker's 1 MiB argument binding.
export const PUBLIC_MCP_CONFIG_MAX_BYTES = 768 * 1024
export const PUBLIC_MCP_DESCRIPTION_MAX_CHARACTERS = 16 * 1024
export const PUBLIC_MCP_ICON_MAX_CHARACTERS = 128
export const PUBLIC_MCP_LIST_MAX_ITEMS = 512

function isSafePublicMcpDisplayText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return false
    }
  }
  return true
}

function isBoundedPublicMcpConfig(value: unknown): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value) ?? 'null').byteLength <=
      PUBLIC_MCP_CONFIG_MAX_BYTES
    )
  } catch {
    return false
  }
}

export const PublicMcpServerNameSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), {
    message: 'MCP server name must not have surrounding whitespace'
  })
  .refine(isSafePublicMcpDisplayText, {
    message: 'MCP server name contains unsafe display characters'
  })
  .refine(
    (value) =>
      value !== 'prototype' && !Object.prototype.hasOwnProperty.call(Object.prototype, value),
    { message: 'MCP server name conflicts with an object property' }
  )

const PublicMcpDescriptionSchema = z.string().max(PUBLIC_MCP_DESCRIPTION_MAX_CHARACTERS)
const PublicMcpIconSchema = z
  .string()
  .max(PUBLIC_MCP_ICON_MAX_CHARACTERS)
  .refine(isSafePublicMcpDisplayText, {
    message: 'MCP server icon contains unsafe display characters'
  })
const PublicMcpCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), { message: 'MCP command must not contain NUL' })
const PublicMcpArgumentSchema = z
  .string()
  .max(8192)
  .refine((value) => !value.includes('\0'), { message: 'MCP argument must not contain NUL' })
const PublicMcpEnvironmentSchema = z
  .record(
    z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .max(256),
    z
      .string()
      .max(64 * 1024)
      .refine((value) => !value.includes('\0'), {
        message: 'MCP environment value must not contain NUL'
      })
  )
  .refine((value) => Object.keys(value).length <= 256, {
    message: 'MCP environment has too many entries'
  })
  .refine(
    (value) => {
      const keys = Object.keys(value).map((key) => key.toLowerCase())
      return new Set(keys).size === keys.length
    },
    { message: 'MCP environment contains case-insensitive duplicate names' }
  )
const PublicMcpHeadersSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(128)
      .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/),
    z
      .string()
      .max(64 * 1024)
      .refine((value) => !value.includes('\0') && !value.includes('\r') && !value.includes('\n'), {
        message: 'MCP header value contains an unsafe character'
      })
  )
  .refine((value) => Object.keys(value).length <= 256, {
    message: 'MCP headers have too many entries'
  })
  .refine(
    (value) => {
      const keys = Object.keys(value).map((key) => key.toLowerCase())
      return new Set(keys).size === keys.length
    },
    { message: 'MCP headers contain case-insensitive duplicate names' }
  )

const PublicMcpSecureUrlSchema = z
  .url()
  .max(8192)
  .superRefine((value, context) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      context.addIssue({ code: 'custom', message: 'MCP URL is invalid' })
      return
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      context.addIssue({
        code: 'custom',
        message: 'MCP URL must use HTTPS or loopback HTTP'
      })
    }
    if (url.username || url.password || url.search || url.hash) {
      context.addIssue({
        code: 'custom',
        message: 'MCP URL must not contain credentials, query parameters, or a fragment'
      })
    }
  })

const PublicMcpAuthorizationConfigSchema = z
  .object({
    mode: z.enum([
      'none',
      'interactive',
      'client_credentials',
      'private_key_jwt',
      'cross_app_access'
    ]),
    protectedResourceUrl: PublicMcpSecureUrlSchema.optional(),
    authorizationServerIssuer: PublicMcpSecureUrlSchema.optional(),
    clientMetadataUrl: PublicMcpSecureUrlSchema.optional(),
    clientId: z.string().min(1).max(2048).refine(isSafePublicMcpDisplayText).optional(),
    scopes: z
      .array(
        z
          .string()
          .min(1)
          .max(512)
          .regex(/^[\x21\x23-\x5b\x5d-\x7e]+$/)
      )
      .max(128)
      .optional(),
    identityProfileId: z.string().min(1).max(512).refine(isSafePublicMcpDisplayText).optional(),
    keyAlgorithm: z.enum(['RS256', 'ES256']).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const machineMode =
      value.mode === 'client_credentials' ||
      value.mode === 'private_key_jwt' ||
      value.mode === 'cross_app_access'
    if (!machineMode) return

    for (const field of [
      'protectedResourceUrl',
      'authorizationServerIssuer',
      'clientId'
    ] as const) {
      if (!value[field]) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required for machine authorization`
        })
      }
    }
    if (value.mode === 'private_key_jwt' && !value.keyAlgorithm) {
      context.addIssue({
        code: 'custom',
        path: ['keyAlgorithm'],
        message: 'keyAlgorithm is required for private_key_jwt authorization'
      })
    }
    if (value.mode === 'cross_app_access' && !value.identityProfileId) {
      context.addIssue({
        code: 'custom',
        path: ['identityProfileId'],
        message: 'identityProfileId is required for cross_app_access authorization'
      })
    }
  })

const PublicMcpCommonConfigShape = {
  description: PublicMcpDescriptionSchema.optional().default(''),
  icon: PublicMcpIconSchema.optional().default('')
}

const PublicMcpStdioConfigSchema = z
  .object({
    ...PublicMcpCommonConfigShape,
    type: z.literal('stdio'),
    command: PublicMcpCommandSchema,
    args: z.array(PublicMcpArgumentSchema).max(256).optional().default([]),
    environment: PublicMcpEnvironmentSchema.optional().default({}),
    inheritEnv: z.enum(['legacy', 'minimal']).optional().default('minimal'),
    customNpmRegistry: PublicMcpSecureUrlSchema.optional()
  })
  .strict()

const PublicMcpSseConfigSchema = z
  .object({
    ...PublicMcpCommonConfigShape,
    type: z.literal('sse'),
    baseUrl: PublicMcpSecureUrlSchema,
    headers: PublicMcpHeadersSchema.optional().default({})
  })
  .strict()

const PublicMcpHttpConfigSchema = z
  .object({
    ...PublicMcpCommonConfigShape,
    type: z.literal('http'),
    baseUrl: PublicMcpSecureUrlSchema,
    headers: PublicMcpHeadersSchema.optional().default({}),
    authorization: PublicMcpAuthorizationConfigSchema.optional()
  })
  .strict()

export const PublicMcpServerConfigInputSchema = z
  .discriminatedUnion('type', [
    PublicMcpStdioConfigSchema,
    PublicMcpSseConfigSchema,
    PublicMcpHttpConfigSchema
  ])
  .refine(isBoundedPublicMcpConfig, {
    message: 'Public MCP server configuration exceeds its byte limit'
  })

export const PublicMcpServerUpdateSchema = z
  .object({
    type: z.enum(['stdio', 'sse', 'http']).optional(),
    description: PublicMcpDescriptionSchema.optional(),
    icon: PublicMcpIconSchema.optional(),
    command: PublicMcpCommandSchema.optional(),
    args: z.array(PublicMcpArgumentSchema).max(256).optional(),
    environment: PublicMcpEnvironmentSchema.optional(),
    inheritEnv: z.enum(['legacy', 'minimal']).optional(),
    baseUrl: PublicMcpSecureUrlSchema.optional(),
    headers: PublicMcpHeadersSchema.optional(),
    authorization: PublicMcpAuthorizationConfigSchema.nullable().optional(),
    customNpmRegistry: PublicMcpSecureUrlSchema.nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const stdioFields = ['command', 'args', 'environment', 'inheritEnv', 'customNpmRegistry']
    const remoteFields = ['baseUrl', 'headers', 'authorization']
    const hasStdioField = stdioFields.some((field) => Object.hasOwn(value, field))
    const hasRemoteField = remoteFields.some((field) => Object.hasOwn(value, field))
    if (hasStdioField && hasRemoteField) {
      context.addIssue({
        code: 'custom',
        message: 'MCP update cannot mix stdio and remote transport fields'
      })
    }
    if (value.type === 'stdio' && hasRemoteField) {
      context.addIssue({
        code: 'custom',
        message: 'Remote transport fields are not valid for stdio MCP servers'
      })
    }
    if (value.type !== undefined && value.type !== 'stdio' && hasStdioField) {
      context.addIssue({
        code: 'custom',
        message: 'Stdio transport fields are not valid for remote MCP servers'
      })
    }
    if (value.type === 'sse' && Object.hasOwn(value, 'authorization')) {
      context.addIssue({
        code: 'custom',
        message: 'Authorization settings are only valid for HTTP MCP servers'
      })
    }
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one MCP server update is required'
  })
  .refine(isBoundedPublicMcpConfig, {
    message: 'Public MCP server update exceeds its byte limit'
  })

export const PublicMcpServerSchema = z
  .object({
    name: PublicMcpServerNameSchema,
    type: z.enum(['sse', 'stdio', 'inmemory', 'http']),
    enabled: z.boolean(),
    running: z.boolean().nullable(),
    managedBy: z.enum(['deepchat', 'plugin', 'user']),
    editable: z.boolean(),
    removable: z.boolean(),
    description: z.string().max(1024),
    commandName: z.string().max(256).nullable(),
    endpoint: z
      .object({
        origin: z.string().max(4096),
        pathPresent: z.boolean()
      })
      .strict()
      .nullable(),
    argumentCount: z.number().int().nonnegative().max(1_000_000),
    environmentEntryCount: z.number().int().nonnegative().max(1_000_000),
    headerEntryCount: z.number().int().nonnegative().max(1_000_000),
    authorizationMode: z
      .enum(['none', 'interactive', 'client_credentials', 'private_key_jwt', 'cross_app_access'])
      .nullable(),
    metadataTruncated: z.boolean()
  })
  .strict()

export const mcpListPublicRoute = defineRouteContract({
  name: 'mcp.listPublic',
  input: z.object({}).strict().default({}),
  output: z
    .object({
      servers: z.array(PublicMcpServerSchema).max(PUBLIC_MCP_LIST_MAX_ITEMS),
      truncated: z.boolean()
    })
    .strict()
})

export const mcpAddPublicRoute = defineRouteContract({
  name: 'mcp.addPublic',
  input: z
    .object({
      serverName: PublicMcpServerNameSchema,
      config: PublicMcpServerConfigInputSchema
    })
    .strict(),
  output: z.object({ server: PublicMcpServerSchema }).strict()
})

export const mcpUpdatePublicRoute = defineRouteContract({
  name: 'mcp.updatePublic',
  input: z
    .object({
      serverName: PublicMcpServerNameSchema,
      updates: PublicMcpServerUpdateSchema
    })
    .strict(),
  output: z.object({ server: PublicMcpServerSchema }).strict()
})

export const mcpSetPublicStatusRoute = defineRouteContract({
  name: 'mcp.setPublicStatus',
  input: z
    .object({
      serverName: PublicMcpServerNameSchema,
      enabled: z.boolean()
    })
    .strict(),
  output: z.object({ server: PublicMcpServerSchema }).strict()
})

export const mcpStartPublicRoute = defineRouteContract({
  name: 'mcp.startPublic',
  input: z.object({ serverName: PublicMcpServerNameSchema }).strict(),
  output: z.object({ server: PublicMcpServerSchema }).strict()
})

export const mcpStopPublicRoute = defineRouteContract({
  name: 'mcp.stopPublic',
  input: z.object({ serverName: PublicMcpServerNameSchema }).strict(),
  output: z.object({ server: PublicMcpServerSchema }).strict()
})

export const mcpRemovePublicRoute = defineRouteContract({
  name: 'mcp.removePublic',
  input: z.object({ serverName: PublicMcpServerNameSchema }).strict(),
  output: z
    .object({
      serverName: PublicMcpServerNameSchema,
      removed: z.literal(true)
    })
    .strict()
})

export type PublicMcpServer = z.infer<typeof PublicMcpServerSchema>
export type PublicMcpServerConfigInput = z.infer<typeof PublicMcpServerConfigInputSchema>
export type PublicMcpServerUpdate = z.infer<typeof PublicMcpServerUpdateSchema>

const McpClientSchema = z.custom<McpClient>()
const MCPToolDefinitionSchema = z.custom<MCPToolDefinition>()
const PromptListEntrySchema = z.custom<PromptListEntry>()
const ResourceListEntrySchema = z.custom<ResourceListEntry>()
const ResourceSchema = z.custom<Resource>()
const MCPToolCallSchema = z.custom<MCPToolCall>()
const MCPToolResponseSchema = z.custom<MCPToolResponse>()
export const McpSamplingDecisionSchema: z.ZodType<McpSamplingDecision> = z.discriminatedUnion(
  'approved',
  [
    z.object({
      requestId: z.string().min(1).max(256),
      approved: z.literal(true),
      providerId: z.string().min(1).max(256),
      modelId: z.string().min(1).max(256),
      reason: z.string().max(2048).optional()
    }),
    z.object({
      requestId: z.string().min(1).max(256),
      approved: z.literal(false),
      reason: z.string().max(2048).optional()
    })
  ]
)
const BoundedJsonValueSchema = JsonValueSchema.refine(
  (value) => {
    try {
      return new TextEncoder().encode(JSON.stringify(value) ?? 'null').byteLength <= 2 * 1024 * 1024
    } catch {
      return false
    }
  },
  { message: 'MCP App payload exceeds the 2 MiB route limit' }
)
const isBoundedMcpJsonObject = (value: unknown): boolean => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2 * 1024 * 1024
  } catch {
    return false
  }
}
const BoundedMcpJsonObjectSchema = z
  .record(z.string().max(256), JsonValueSchema)
  .refine(isBoundedMcpJsonObject, {
    message: 'MCP JSON object exceeds the 2 MiB route limit'
  })
const McpToolAnnotationsSchema: z.ZodType<McpToolAnnotations> = z
  .object({
    title: z.string().max(512).optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional()
  })
  .catchall(JsonValueSchema)
  .refine(isBoundedMcpJsonObject, {
    message: 'MCP tool annotations exceed the 2 MiB route limit'
  })
const McpElicitationDecisionSchema: z.ZodType<McpElicitationDecision> = z.object({
  requestId: z.string().min(1).max(256),
  action: z.enum(['accept', 'decline', 'cancel']),
  content: BoundedMcpJsonObjectSchema.optional()
})
const McpContentAnnotationsSchema = z
  .object({
    audience: z
      .array(z.enum(['user', 'assistant']))
      .max(2)
      .optional(),
    priority: z.number().optional(),
    lastModified: z.string().max(256).optional()
  })
  .catchall(JsonValueSchema)
const McpContentBaseShape = {
  annotations: McpContentAnnotationsSchema.optional(),
  _meta: z.record(z.string().max(256), JsonValueSchema).optional()
}
const McpContentItemSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...McpContentBaseShape,
      type: z.literal('text'),
      text: z.string().max(2 * 1024 * 1024)
    })
    .catchall(JsonValueSchema),
  z
    .object({
      ...McpContentBaseShape,
      type: z.literal('image'),
      data: z.string().max(8 * 1024 * 1024),
      mimeType: z.string().min(1).max(256)
    })
    .catchall(JsonValueSchema),
  z
    .object({
      ...McpContentBaseShape,
      type: z.literal('audio'),
      data: z.string().max(8 * 1024 * 1024),
      mimeType: z.string().min(1).max(256)
    })
    .catchall(JsonValueSchema),
  z
    .object({
      ...McpContentBaseShape,
      type: z.literal('resource'),
      resource: z
        .object({
          uri: z.string().min(1).max(4096),
          mimeType: z.string().max(256).optional(),
          text: z
            .string()
            .max(2 * 1024 * 1024)
            .optional(),
          blob: z
            .string()
            .max(8 * 1024 * 1024)
            .optional(),
          _meta: z.record(z.string().max(256), JsonValueSchema).optional()
        })
        .catchall(JsonValueSchema)
    })
    .catchall(JsonValueSchema),
  z
    .object({
      ...McpContentBaseShape,
      type: z.literal('resource_link'),
      uri: z.string().min(1).max(4096),
      name: z.string().min(1).max(512),
      title: z.string().max(512).optional(),
      description: z.string().max(4096).optional(),
      mimeType: z.string().max(256).optional(),
      size: z.number().int().nonnegative().optional(),
      icons: z
        .array(
          z.object({
            src: z.string().max(4096),
            mimeType: z.string().max(256).optional(),
            sizes: z.array(z.string().max(64)).max(32).optional(),
            theme: z.enum(['light', 'dark']).optional()
          })
        )
        .max(32)
        .optional()
    })
    .catchall(JsonValueSchema)
])
const McpAppDescriptorSchema: z.ZodType<McpAppDescriptor> = z.object({
  schemaVersion: z.literal(1),
  serverId: z.string().min(1).max(256),
  configGeneration: z.number().int().positive(),
  bindingHash: z.string().min(1).max(256),
  serverName: z.string().min(1).max(256),
  toolName: z.string().min(1).max(256),
  resourceUri: z.string().startsWith('ui://').max(4096),
  resourceMimeType: z.literal('text/html;profile=mcp-app')
})
const McpAppCspSchema = z.object({
  connectDomains: z.array(z.string().max(2048)).max(64).optional(),
  resourceDomains: z.array(z.string().max(2048)).max(64).optional(),
  frameDomains: z.array(z.string().max(2048)).max(64).optional(),
  baseUriDomains: z.array(z.string().max(2048)).max(64).optional()
})
const McpAppPermissionsSchema = z.object({
  camera: z.object({}).optional(),
  microphone: z.object({}).optional(),
  geolocation: z.object({}).optional(),
  clipboardWrite: z.object({}).optional()
})
const McpAppToolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(McpContentItemSchema).max(512),
  structuredContent: BoundedJsonValueSchema.optional(),
  _meta: z.record(z.string().max(256), JsonValueSchema).optional()
})
const McpAppServerIconSchema = z.object({
  src: z.string().max(4096),
  mimeType: z.string().max(256).optional(),
  sizes: z.array(z.string().max(64)).max(32).optional(),
  theme: z.enum(['light', 'dark']).optional()
})
const McpAppServerToolSchema: z.ZodType<Tool> = z.object({
  name: z.string().min(1).max(256),
  title: z.string().max(512).optional(),
  description: z
    .string()
    .max(16 * 1024)
    .optional(),
  icons: z.array(McpAppServerIconSchema).max(32).optional(),
  inputSchema: BoundedMcpJsonObjectSchema,
  outputSchema: BoundedMcpJsonObjectSchema.optional(),
  annotations: McpToolAnnotationsSchema.optional(),
  _meta: BoundedMcpJsonObjectSchema.optional(),
  execution: BoundedMcpJsonObjectSchema.optional()
})
const McpAppPreparedViewSchema: z.ZodType<McpAppPreparedView> = z.object({
  instanceId: z.string().min(16).max(128),
  sandboxUrl: z.string().startsWith('mcp-app://').max(512),
  html: z.string().max(2 * 1024 * 1024),
  sandbox: z.literal('allow-scripts allow-same-origin'),
  tool: McpAppServerToolSchema,
  csp: McpAppCspSchema.optional(),
  permissions: McpAppPermissionsSchema.optional(),
  prefersBorder: z.boolean().optional(),
  advisoryDomain: z.string().max(253).optional(),
  expiresAt: z.number().int().positive()
})
const McpAppServerResourceSchema = z.object({
  uri: z.string().min(1).max(4096),
  name: z.string().min(1).max(512),
  title: z.string().max(512).optional(),
  description: z.string().max(4096).optional(),
  mimeType: z.string().max(256).optional(),
  size: z.number().int().nonnegative().optional(),
  icons: z.array(McpAppServerIconSchema).max(32).optional(),
  annotations: z.record(z.string().max(256), JsonValueSchema).optional(),
  _meta: z.record(z.string().max(256), JsonValueSchema).optional()
})
const McpAppServerResourceTemplateSchema = z.object({
  uriTemplate: z.string().min(1).max(4096),
  name: z.string().min(1).max(512),
  title: z.string().max(512).optional(),
  description: z.string().max(4096).optional(),
  mimeType: z.string().max(256).optional(),
  icons: z.array(McpAppServerIconSchema).max(32).optional(),
  annotations: z.record(z.string().max(256), JsonValueSchema).optional(),
  _meta: z.record(z.string().max(256), JsonValueSchema).optional()
})
const McpAppServerPromptSchema = z.object({
  name: z.string().min(1).max(512),
  title: z.string().max(512).optional(),
  description: z.string().max(4096).optional(),
  arguments: z
    .array(
      z.object({
        name: z.string().min(1).max(512),
        description: z.string().max(4096).optional(),
        required: z.boolean().optional()
      })
    )
    .max(128)
    .optional(),
  icons: z.array(McpAppServerIconSchema).max(32).optional(),
  _meta: z.record(z.string().max(256), JsonValueSchema).optional()
})
const McpAddServerResultSchema: z.ZodType<McpAddServerResult> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('added') }).strict(),
  z.object({ status: z.literal('duplicate') }).strict()
])
export const McpServerAuthStatusSchema: z.ZodType<McpServerAuthStatus> = z.object({
  serverName: z.string().min(1).max(256),
  serverId: z.string().min(1).max(256).optional(),
  state: z.enum(['unsupported', 'none', 'required', 'authenticating', 'authenticated', 'error']),
  authenticated: z.boolean(),
  error: z.string().max(2048).optional(),
  updatedAt: z.number().optional(),
  storage: z.enum(['safeStorage', 'memory', 'none']).optional(),
  persistent: z.boolean().optional(),
  mode: z
    .enum(['none', 'interactive', 'client_credentials', 'private_key_jwt', 'cross_app_access'])
    .optional(),
  credential: z
    .object({
      serverId: z.string().min(1).max(256),
      kind: z.enum(['client_secret', 'private_key', 'enterprise_resource_secret']),
      configured: z.boolean(),
      persistent: z.boolean(),
      updatedAt: z.number().int().nonnegative().optional(),
      fingerprint: z.string().max(256).optional()
    })
    .optional()
})
const McpCredentialBindingSchema: z.ZodType<McpCredentialBinding> = z.object({
  serverId: z.string().uuid(),
  configGeneration: z.number().int().positive(),
  bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
  endpoint: z.url().max(4096),
  protectedResourceUrl: z.url().max(4096).optional(),
  authorizationServerIssuer: z.url().max(4096).optional(),
  clientId: z.string().min(1).max(512).optional()
})
const McpCredentialStatusSchema: z.ZodType<McpCredentialStatus> = z.object({
  serverId: z.string().min(1).max(256),
  kind: z.enum(['client_secret', 'private_key', 'enterprise_resource_secret']),
  configured: z.boolean(),
  persistent: z.boolean(),
  updatedAt: z.number().int().nonnegative().optional(),
  fingerprint: z.string().max(256).optional()
})
const McpCredentialInputSchema: z.ZodType<McpCredentialInput> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('client_secret'),
    secret: z.string().min(1).max(8192)
  }),
  z.object({
    kind: z.literal('private_key'),
    privateKey: z
      .string()
      .min(1)
      .max(64 * 1024),
    algorithm: z.enum(['RS256', 'ES256'])
  }),
  z.object({
    kind: z.literal('enterprise_resource_secret'),
    secret: z.string().min(1).max(8192)
  })
])
const McpEnterpriseIdentityProfileSchema: z.ZodType<McpEnterpriseIdentityProfile> = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/),
  label: z.string().min(1).max(256),
  issuer: z.url().max(4096),
  clientId: z.string().min(1).max(512),
  scopes: z.array(z.string().min(1).max(256)).max(64),
  clientAuthentication: z.enum(['none', 'client_secret'])
})
const McpEnterpriseIdentityStatusSchema: z.ZodType<McpEnterpriseIdentityStatus> = z.object({
  profileId: z.string().min(1).max(128),
  state: z.enum(['signed_out', 'authenticating', 'authenticated', 'error']),
  authenticated: z.boolean(),
  persistent: z.boolean(),
  clientSecretConfigured: z.boolean(),
  subjectLabel: z.string().max(512).optional(),
  error: z.string().max(2048).optional(),
  updatedAt: z.number().int().nonnegative().optional()
})
const McpServerDiagnosticsSchema: z.ZodType<McpServerDiagnostics> = z.object({
  serverId: z.string().min(1).max(256),
  serverName: z.string().min(1).max(256),
  owner: z.enum(['deepchat', 'plugin']),
  transport: z.enum(['sse', 'stdio', 'inmemory', 'http']),
  connectionState: z.enum(['stopped', 'starting', 'running', 'error']),
  lifecycleStatus: z.enum(['connecting', 'connected', 'timeout', 'retrying', 'failed', 'stopped']),
  lastError: z.string().max(2048).optional(),
  era: z.enum(['modern', 'legacy', 'unknown']),
  protocolVersion: z.string().max(64).optional(),
  serverImplementation: z
    .object({
      name: z.string().max(256),
      version: z.string().max(128)
    })
    .optional(),
  probe: z.object({
    outcome: z.enum(['modern', 'legacy-fallback', 'failed', 'not-run']),
    reasonCode: z
      .enum([
        'modern-accepted',
        'valid-legacy-signal',
        'authentication-required',
        'http-server-error',
        'transport-error',
        'timeout'
      ])
      .optional()
  }),
  extensions: z.array(z.string().min(1).max(256)).max(64),
  clientExtensions: z
    .array(
      z.object({
        id: z.string().min(1).max(256),
        revision: z.string().min(1).max(128).optional()
      })
    )
    .max(64),
  cacheState: z.enum(['active', 'unknown']),
  subscriptions: z
    .array(
      z.enum([
        'tools-list-changed',
        'prompts-list-changed',
        'resources-list-changed',
        'resource-updated',
        'modern-listen'
      ])
    )
    .max(16),
  auth: z.object({
    state: z.enum(['unsupported', 'none', 'required', 'authenticating', 'authenticated', 'error']),
    persistent: z.boolean().optional(),
    mode: z
      .enum(['none', 'interactive', 'client_credentials', 'private_key_jwt', 'cross_app_access'])
      .optional()
  }),
  updatedAt: z.number().int().nonnegative()
})
const NpmRegistryStatusSchema = z.custom<{
  currentRegistry: string | null
  isFromCache: boolean
  lastChecked?: number
  autoDetectEnabled: boolean
  customRegistry?: string
}>()
export const McpRouterMarketItemSchema = z.object({
  uuid: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string(),
  name: z.string(),
  author_name: z.string(),
  title: z.string(),
  description: z.string(),
  content: z.string().optional(),
  server_key: z.string().min(1),
  config_name: z.string().optional(),
  server_url: z.string().optional()
})

export const mcpGetServersRoute = defineRouteContract({
  name: 'mcp.getServers',
  input: z.object({}),
  output: z.object({
    servers: z.record(z.string(), MCPServerConfigSchema)
  })
})

export const mcpGetEnabledRoute = defineRouteContract({
  name: 'mcp.getEnabled',
  input: z.object({}),
  output: z.object({
    enabled: z.boolean()
  })
})

export const mcpGetClientsRoute = defineRouteContract({
  name: 'mcp.getClients',
  input: z.object({}),
  output: z.object({
    clients: z.array(McpClientSchema)
  })
})

export const mcpListToolDefinitionsRoute = defineRouteContract({
  name: 'mcp.listToolDefinitions',
  input: z.object({
    enabledMcpTools: z.array(z.string()).optional()
  }),
  output: z.object({
    tools: z.array(MCPToolDefinitionSchema)
  })
})

export const mcpListPromptsRoute = defineRouteContract({
  name: 'mcp.listPrompts',
  input: z.object({}),
  output: z.object({
    prompts: z.array(PromptListEntrySchema)
  })
})

export const mcpListResourcesRoute = defineRouteContract({
  name: 'mcp.listResources',
  input: z.object({}),
  output: z.object({
    resources: z.array(ResourceListEntrySchema)
  })
})

export const mcpCallToolRoute = defineRouteContract({
  name: 'mcp.callTool',
  input: z.object({
    request: MCPToolCallSchema
  }),
  output: z.object({
    content: z.string(),
    rawData: MCPToolResponseSchema
  })
})

export const mcpAddServerRoute = defineRouteContract({
  name: 'mcp.addServer',
  input: z.object({
    serverName: z.string().min(1).max(256),
    config: MCPServerConfigSchema
  }),
  output: z.object({
    result: McpAddServerResultSchema
  })
})

export const mcpUpdateServerRoute = defineRouteContract({
  name: 'mcp.updateServer',
  input: z.object({
    serverName: z.string().min(1).max(256),
    config: MCPServerConfigUpdateSchema
  }),
  output: z.object({
    updated: z.literal(true)
  })
})

export const mcpRemoveServerRoute = defineRouteContract({
  name: 'mcp.removeServer',
  input: z.object({
    serverName: z.string().min(1).max(256)
  }),
  output: z.object({
    removed: z.literal(true)
  })
})

export const mcpSetServerEnabledRoute = defineRouteContract({
  name: 'mcp.setServerEnabled',
  input: z.object({
    serverName: z.string(),
    enabled: z.boolean()
  }),
  output: z.object({
    enabled: z.boolean()
  })
})

export const mcpSetEnabledRoute = defineRouteContract({
  name: 'mcp.setEnabled',
  input: z.object({
    enabled: z.boolean()
  }),
  output: z.object({
    enabled: z.boolean()
  })
})

export const mcpIsServerRunningRoute = defineRouteContract({
  name: 'mcp.isServerRunning',
  input: z.object({
    serverName: z.string()
  }),
  output: z.object({
    running: z.boolean()
  })
})

export const mcpStartServerRoute = defineRouteContract({
  name: 'mcp.startServer',
  input: z.object({
    serverName: z.string()
  }),
  output: z.object({
    started: z.literal(true)
  })
})

export const mcpStopServerRoute = defineRouteContract({
  name: 'mcp.stopServer',
  input: z.object({
    serverName: z.string()
  }),
  output: z.object({
    stopped: z.literal(true)
  })
})

export const mcpGetServerAuthStatusRoute = defineRouteContract({
  name: 'mcp.getServerAuthStatus',
  input: z.object({
    serverId: z.string().uuid()
  }),
  output: z.object({
    status: McpServerAuthStatusSchema
  })
})

export const mcpStartServerAuthRoute = defineRouteContract({
  name: 'mcp.startServerAuth',
  input: z.object({
    serverId: z.string().uuid()
  }),
  output: z.object({
    status: McpServerAuthStatusSchema
  })
})

export const mcpCompleteServerAuthFromCallbackUrlRoute = defineRouteContract({
  name: 'mcp.completeServerAuthFromCallbackUrl',
  input: z.object({
    serverId: z.string().uuid(),
    callbackUrl: z.url().max(8192)
  }),
  output: z.object({
    status: McpServerAuthStatusSchema
  })
})

export const mcpLogoutServerAuthRoute = defineRouteContract({
  name: 'mcp.logoutServerAuth',
  input: z.object({
    serverId: z.string().uuid()
  }),
  output: z.object({
    status: McpServerAuthStatusSchema
  })
})

export const mcpCredentialsGetStatusRoute = defineRouteContract({
  name: 'mcp.credentials.getStatus',
  input: z.object({
    serverId: z.string().uuid()
  }),
  output: z.object({
    credentials: z.array(McpCredentialStatusSchema).max(3)
  })
})

export const mcpCredentialsSetRoute = defineRouteContract({
  name: 'mcp.credentials.set',
  input: z.object({
    binding: McpCredentialBindingSchema,
    credential: McpCredentialInputSchema
  }),
  output: z.object({
    status: McpCredentialStatusSchema
  })
})

export const mcpCredentialsRemoveRoute = defineRouteContract({
  name: 'mcp.credentials.remove',
  input: z.object({
    binding: McpCredentialBindingSchema,
    kind: z.enum(['client_secret', 'private_key', 'enterprise_resource_secret'])
  }),
  output: z.object({
    status: McpCredentialStatusSchema
  })
})

export const mcpEnterpriseProfilesListRoute = defineRouteContract({
  name: 'mcp.enterpriseProfiles.list',
  input: z.object({}),
  output: z.object({
    profiles: z.array(McpEnterpriseIdentityProfileSchema).max(128)
  })
})

export const mcpEnterpriseProfilesSaveRoute = defineRouteContract({
  name: 'mcp.enterpriseProfiles.save',
  input: z.object({
    profile: McpEnterpriseIdentityProfileSchema
  }),
  output: z.object({
    profile: McpEnterpriseIdentityProfileSchema
  })
})

export const mcpEnterpriseProfilesRemoveRoute = defineRouteContract({
  name: 'mcp.enterpriseProfiles.remove',
  input: z.object({
    profileId: z.string().min(1).max(128)
  }),
  output: z.object({
    removed: z.literal(true)
  })
})

export const mcpEnterpriseProfilesSetClientSecretRoute = defineRouteContract({
  name: 'mcp.enterpriseProfiles.setClientSecret',
  input: z.object({
    profileId: z.string().min(1).max(128),
    secret: z.string().min(1).max(8192)
  }),
  output: z.object({
    status: McpEnterpriseIdentityStatusSchema
  })
})

export const mcpEnterpriseProfilesGetStatusRoute = defineRouteContract({
  name: 'mcp.enterpriseProfiles.getStatus',
  input: z.object({
    profileId: z.string().min(1).max(128)
  }),
  output: z.object({
    status: McpEnterpriseIdentityStatusSchema
  })
})

export const mcpEnterpriseProfilesStartAuthRoute = defineRouteContract({
  name: 'mcp.enterpriseProfiles.startAuth',
  input: z.object({
    profileId: z.string().min(1).max(128)
  }),
  output: z.object({
    status: McpEnterpriseIdentityStatusSchema
  })
})

export const mcpEnterpriseProfilesCompleteAuthRoute = defineRouteContract({
  name: 'mcp.enterpriseProfiles.completeAuth',
  input: z.object({
    profileId: z.string().min(1).max(128),
    callbackUrl: z.url().max(8192)
  }),
  output: z.object({
    status: McpEnterpriseIdentityStatusSchema
  })
})

export const mcpEnterpriseProfilesLogoutRoute = defineRouteContract({
  name: 'mcp.enterpriseProfiles.logout',
  input: z.object({
    profileId: z.string().min(1).max(128)
  }),
  output: z.object({
    status: McpEnterpriseIdentityStatusSchema
  })
})

export const mcpGetServerDiagnosticsRoute = defineRouteContract({
  name: 'mcp.getServerDiagnostics',
  input: z.object({
    serverId: z.uuid()
  }),
  output: z.object({
    diagnostics: McpServerDiagnosticsSchema
  })
})

export const mcpGetPromptRoute = defineRouteContract({
  name: 'mcp.getPrompt',
  input: z.object({
    prompt: PromptListEntrySchema,
    args: z.record(z.string(), z.unknown()).optional()
  }),
  output: z.object({
    result: z.unknown()
  })
})

export const mcpReadResourceRoute = defineRouteContract({
  name: 'mcp.readResource',
  input: z.object({
    resource: ResourceListEntrySchema
  }),
  output: z.object({
    resource: ResourceSchema
  })
})

export const mcpSubmitSamplingDecisionRoute = defineRouteContract({
  name: 'mcp.submitSamplingDecision',
  input: z.object({
    decision: McpSamplingDecisionSchema
  }),
  output: z.object({
    submitted: z.literal(true)
  })
})

export const mcpCancelSamplingRequestRoute = defineRouteContract({
  name: 'mcp.cancelSamplingRequest',
  input: z.object({
    requestId: z.string().min(1).max(256),
    reason: z.string().max(1024).optional()
  }),
  output: z.object({
    cancelled: z.literal(true)
  })
})

export const mcpSubmitElicitationDecisionRoute = defineRouteContract({
  name: 'mcp.submitElicitationDecision',
  input: z.object({
    decision: McpElicitationDecisionSchema
  }),
  output: z.object({
    submitted: z.literal(true)
  })
})

export const mcpCancelElicitationRequestRoute = defineRouteContract({
  name: 'mcp.cancelElicitationRequest',
  input: z.object({
    requestId: z.string().min(1).max(256),
    reason: z.string().max(1024).optional()
  }),
  output: z.object({
    cancelled: z.literal(true)
  })
})

export const mcpAppsPrepareViewRoute = defineRouteContract({
  name: 'mcp.apps.prepareView',
  input: z.object({
    descriptor: McpAppDescriptorSchema,
    conversationId: z.string().min(1).max(256),
    messageId: z.string().min(1).max(256),
    blockId: z.string().min(1).max(256),
    toolInput: BoundedMcpJsonObjectSchema
  }),
  output: z.object({
    view: McpAppPreparedViewSchema
  })
})

export const mcpAppsReleaseViewRoute = defineRouteContract({
  name: 'mcp.apps.releaseView',
  input: z.object({
    instanceId: z.string().min(16).max(128)
  }),
  output: z.object({
    released: z.literal(true)
  })
})

export const mcpAppsCallToolRoute = defineRouteContract({
  name: 'mcp.apps.callTool',
  input: z.object({
    instanceId: z.string().min(16).max(128),
    name: z.string().min(1).max(256),
    arguments: BoundedMcpJsonObjectSchema
  }),
  output: z.object({
    call: z.object({
      result: McpAppToolResultSchema,
      toolAccessSuspended: z.boolean()
    }) satisfies z.ZodType<McpAppCallToolResult>
  })
})

export const mcpAppsListToolsRoute = defineRouteContract({
  name: 'mcp.apps.listTools',
  input: z.object({
    instanceId: z.string().min(16).max(128),
    cursor: z.string().min(1).max(4096).optional()
  }),
  output: z.object({
    tools: z.array(McpAppServerToolSchema).max(512),
    nextCursor: z.string().max(4096).optional(),
    _meta: BoundedMcpJsonObjectSchema.optional()
  }) satisfies z.ZodType<McpAppServerToolListResult>
})

export const mcpAppsListResourcesRoute = defineRouteContract({
  name: 'mcp.apps.listResources',
  input: z.object({
    instanceId: z.string().min(16).max(128),
    cursor: z.string().min(1).max(4096).optional()
  }),
  output: z.object({
    resources: z.array(McpAppServerResourceSchema).max(512),
    nextCursor: z.string().max(4096).optional(),
    _meta: z.record(z.string().max(256), JsonValueSchema).optional()
  }) satisfies z.ZodType<McpAppServerResourceListResult>
})

export const mcpAppsListResourceTemplatesRoute = defineRouteContract({
  name: 'mcp.apps.listResourceTemplates',
  input: z.object({
    instanceId: z.string().min(16).max(128),
    cursor: z.string().min(1).max(4096).optional()
  }),
  output: z.object({
    resourceTemplates: z.array(McpAppServerResourceTemplateSchema).max(512),
    nextCursor: z.string().max(4096).optional(),
    _meta: z.record(z.string().max(256), JsonValueSchema).optional()
  }) satisfies z.ZodType<McpAppServerResourceTemplateListResult>
})

export const mcpAppsListPromptsRoute = defineRouteContract({
  name: 'mcp.apps.listPrompts',
  input: z.object({
    instanceId: z.string().min(16).max(128),
    cursor: z.string().min(1).max(4096).optional()
  }),
  output: z.object({
    prompts: z.array(McpAppServerPromptSchema).max(512),
    nextCursor: z.string().max(4096).optional(),
    _meta: z.record(z.string().max(256), JsonValueSchema).optional()
  }) satisfies z.ZodType<McpAppServerPromptListResult>
})

export const mcpAppsReadResourceRoute = defineRouteContract({
  name: 'mcp.apps.readResource',
  input: z.object({
    instanceId: z.string().min(16).max(128),
    uri: z.string().min(1).max(4096)
  }),
  output: z.object({
    contents: z
      .array(
        z.object({
          uri: z.string().min(1).max(4096),
          mimeType: z.string().max(256).optional(),
          text: z
            .string()
            .max(2 * 1024 * 1024)
            .optional(),
          blob: z
            .string()
            .max(8 * 1024 * 1024)
            .optional(),
          _meta: z.record(z.string().max(256), JsonValueSchema).optional()
        })
      )
      .max(64)
  })
})

export const mcpAppsOpenLinkRoute = defineRouteContract({
  name: 'mcp.apps.openLink',
  input: z.object({
    instanceId: z.string().min(16).max(128),
    url: z.url().max(4096)
  }),
  output: z.object({
    opened: z.boolean()
  })
})

export const mcpAppsAuthorizeMessageRoute = defineRouteContract({
  name: 'mcp.apps.authorizeMessage',
  input: z.object({
    instanceId: z.string().min(16).max(128),
    text: z
      .string()
      .min(1)
      .max(32 * 1024)
  }),
  output: z.object({
    approved: z.boolean()
  })
})

export const mcpAppsUpdateModelContextRoute = defineRouteContract({
  name: 'mcp.apps.updateModelContext',
  input: z.object({
    instanceId: z.string().min(16).max(128),
    content: z.array(McpContentItemSchema).max(128).optional(),
    structuredContent: BoundedMcpJsonObjectSchema.optional()
  }),
  output: z.object({
    approved: z.boolean(),
    approvedHash: z.string().length(64).optional()
  })
})

export const mcpAppsRetryToolAccessRoute = defineRouteContract({
  name: 'mcp.apps.retryToolAccess',
  input: z.object({
    instanceId: z.string().min(16).max(128)
  }),
  output: z.object({
    retried: z.literal(true)
  })
})

export const mcpAppsSubmitConsentRoute = defineRouteContract({
  name: 'mcp.apps.submitConsent',
  input: z.object({
    requestId: z.string().min(1).max(256),
    approved: z.boolean()
  }),
  output: z.object({
    submitted: z.literal(true)
  })
})

export const mcpGetNpmRegistryStatusRoute = defineRouteContract({
  name: 'mcp.getNpmRegistryStatus',
  input: z.object({}),
  output: z.object({
    status: NpmRegistryStatusSchema
  })
})

export const mcpRefreshNpmRegistryRoute = defineRouteContract({
  name: 'mcp.refreshNpmRegistry',
  input: z.object({}),
  output: z.object({
    registry: z.string()
  })
})

export const mcpSetCustomNpmRegistryRoute = defineRouteContract({
  name: 'mcp.setCustomNpmRegistry',
  input: z.object({
    registry: z.string().optional()
  }),
  output: z.object({
    updated: z.literal(true)
  })
})

export const mcpSetAutoDetectNpmRegistryRoute = defineRouteContract({
  name: 'mcp.setAutoDetectNpmRegistry',
  input: z.object({
    enabled: z.boolean()
  }),
  output: z.object({
    enabled: z.boolean()
  })
})

export const mcpClearNpmRegistryCacheRoute = defineRouteContract({
  name: 'mcp.clearNpmRegistryCache',
  input: z.object({}),
  output: z.object({
    cleared: z.literal(true)
  })
})

export const mcpRouterListServersRoute = defineRouteContract({
  name: 'mcp.router.listServers',
  input: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100)
  }),
  output: z.object({
    servers: z.array(McpRouterMarketItemSchema)
  })
})

export const mcpRouterInstallServerRoute = defineRouteContract({
  name: 'mcp.router.installServer',
  input: z.object({
    serverKey: z.string().min(1)
  }),
  output: z.object({
    installed: z.boolean()
  })
})

export const mcpRouterGetApiKeyRoute = defineRouteContract({
  name: 'mcp.router.getApiKey',
  input: z.object({}).default({}),
  output: z.object({
    key: z.string()
  })
})

export const mcpRouterSetApiKeyRoute = defineRouteContract({
  name: 'mcp.router.setApiKey',
  input: z.object({
    key: z.string()
  }),
  output: z.object({
    saved: z.literal(true)
  })
})

export const mcpRouterIsServerInstalledRoute = defineRouteContract({
  name: 'mcp.router.isServerInstalled',
  input: z.object({
    source: z.string().min(1),
    sourceId: z.string().min(1)
  }),
  output: z.object({
    installed: z.boolean()
  })
})

export const mcpRouterListInstalledServerIdsRoute = defineRouteContract({
  name: 'mcp.router.listInstalledServerIds',
  input: z.object({
    source: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).max(100)
  }),
  output: z.object({
    installedSourceIds: z.array(z.string())
  })
})

export type McpRouterMarketItem = z.infer<typeof McpRouterMarketItemSchema>
