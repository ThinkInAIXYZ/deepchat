import { z } from 'zod'
import { CoreHelperEventsSchema, isCoreHelperDrain } from './helpers'
import { CoreBrowserEventSchema, isCoreBrowserDrain } from './browser'
import { CoreDesktopEventSchema, CoreWindowTargetSchema, isCoreDesktopDrain } from './desktop'
import { McpAppCspSchema, McpAppPermissionsSchema } from '../contracts/routes/mcp.routes'
import { hasDeepchatRouteContract, type DeepchatRouteName } from '../contracts/routes'
import { databaseRepairReasonSchema } from '../notifications/semanticNotification'

export const CORE_INLINE_BYTES = 16 * 1024
export const CORE_VALUE_BYTES = 64 * 1024 * 1024
export const CORE_CARRIER_FILES = 4
export const CORE_CALLS = 4
export const CORE_ORDINARY_CALLS = CORE_CALLS - 1
export const CORE_ROUTE_QUEUED = 64
export const CORE_CONTROL_CALLS = 2
export const CORE_NATIVE_CALLS = 16
export const CORE_NATIVE_QUEUED = 64
export const CORE_PRESENTATION_QUEUED = 256

export const CoreNativeMethodSchema = z.enum([
  'crypto.available',
  'crypto.encrypt',
  'crypto.decrypt',
  'crypto.backend',
  'profile.logging',
  'profile.progress',
  'profile.unlock',
  'profile.recovery',
  'profile.quit',
  'profile.observation',
  'core.failure',
  'configuration',
  'helpers',
  'browser',
  'desktop'
])
export type CoreNativeMethod = z.infer<typeof CoreNativeMethodSchema>

export const CoreFailureComponentSchema = z.enum(['helpers', 'browser', 'desktop', 'http'])

const profileObservation = z.object({
  durationMs: z.number().finite().nonnegative().optional(),
  repairAttempted: z.boolean(),
  schemaDiagnosis: z.enum(['completed', 'unavailable', 'not_completed']),
  repairableIssueCount: z.number().int().nonnegative(),
  manualIssueCount: z.number().int().nonnegative()
})
export const CoreProfileObservationSchema = z.discriminatedUnion('outcome', [
  profileObservation.extend({ outcome: z.literal('completed') }).strict(),
  profileObservation
    .extend({
      outcome: z.literal('failed'),
      error: z.union([
        z.object({ category: z.enum(['integrity', 'persistence']) }).strict(),
        z.object({ category: z.literal('schema'), reason: databaseRepairReasonSchema }).strict()
      ])
    })
    .strict()
])

export const CoreHostEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('host.clearPermissions') }).strict(),
  z.object({ type: z.literal('host.shutdownConfirmation') }).strict(),
  z.object({ type: z.literal('host.systemResume') }).strict(),
  z
    .object({
      type: z.literal('host.settingsWindow'),
      action: z.enum(['opened', 'closed', 'ready'])
    })
    .strict()
])
export const CoreShutdownConfirmationSchema = z
  .object({
    title: z.string(),
    description: z.string().optional(),
    i18n: z.boolean().optional(),
    icon: z.object({ icon: z.string(), class: z.string() }).strict().optional(),
    buttons: z
      .array(
        z.object({ key: z.string(), label: z.string(), default: z.boolean().optional() }).strict()
      )
      .optional(),
    timeout: z.number().finite().optional()
  })
  .strict()
  .nullable()
export const CoreNativeEventSchema = z.union([
  CoreHelperEventsSchema,
  CoreBrowserEventSchema,
  CoreDesktopEventSchema,
  CoreHostEventSchema
])

export function isCoreNativeDrain(method: CoreNativeMethod, args: unknown): boolean {
  return (
    (method === 'core.failure' && z.tuple([CoreFailureComponentSchema]).safeParse(args).success) ||
    (method === 'helpers' && isCoreHelperDrain(args)) ||
    (method === 'browser' && isCoreBrowserDrain(args)) ||
    (method === 'desktop' && isCoreDesktopDrain(args))
  )
}

export const CoreCarrierConfigSchema = z
  .object({
    generation: z.string().uuid(),
    directory: z.string().min(1).max(8192),
    key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
  })
  .strict()
export type CoreCarrierConfig = z.infer<typeof CoreCarrierConfigSchema>

export const CorePayloadSchema = z.union([
  z.object({ inline: z.string().max(4 * Math.ceil(CORE_INLINE_BYTES / 3)) }).strict(),
  z
    .object({
      operation: z.string().uuid(),
      sender: z.enum(['main', 'core']),
      bytes: z
        .number()
        .int()
        .min(CORE_INLINE_BYTES + 1)
        .max(CORE_VALUE_BYTES)
    })
    .strict()
])
export type CorePayload = z.infer<typeof CorePayloadSchema>

export const CoreMethodSchema = z.enum([
  'openProfile',
  'assembleKernel',
  'startKernel',
  'invokeRoute',
  'invokeControlRoute',
  'mcpAppProtocol',
  'hostQuery',
  'configure',
  'observeSystemTheme',
  'nativeEvents',
  'status',
  'beginShutdown',
  'stop'
])
export type CoreMethod = z.infer<typeof CoreMethodSchema>

export const CoreHostQuerySchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('workspacePreview'), url: z.string().max(32768) }).strict(),
  z.object({ operation: z.literal('hasProvider'), providerId: z.string().min(1).max(256) }).strict()
])

const mcpAppContext = CoreWindowTargetSchema.extend({
  windowId: z.number().int().positive().nullable()
})
const mcpAppInstanceId = z.string().min(1).max(128)
export const CoreMcpAppProtocolCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('policy'), instanceId: mcpAppInstanceId }).strict(),
  z
    .object({
      operation: z.literal('permission'),
      instanceId: mcpAppInstanceId,
      context: mcpAppContext,
      kinds: z
        .array(z.enum(['camera', 'microphone', 'geolocation', 'clipboard-write']))
        .min(1)
        .max(4)
    })
    .strict()
])
export const CoreMcpAppProtocolPolicySchema = z
  .object({
    context: mcpAppContext,
    csp: McpAppCspSchema.optional(),
    permissions: McpAppPermissionsSchema.optional()
  })
  .strict()
  .nullable()

export const CoreStatusSchema = z
  .object({
    generation: z.string().uuid(),
    pid: z.number().int().positive(),
    node: z.string().max(64),
    modules: z.string().max(32),
    phase: z.enum([
      'idle',
      'opening',
      'profile-open',
      'assembling',
      'kernel-assembled',
      'starting',
      'running',
      'stopping',
      'stopped'
    ]),
    businessReady: z.boolean()
  })
  .strict()
export type CoreStatus = z.infer<typeof CoreStatusSchema>

const callerId = z.number().int().positive().safe()
export const CoreRouteInvocationSchema = z
  .object({
    routeName: z.string().max(256).refine(hasDeepchatRouteContract),
    input: z.unknown(),
    context: z
      .object({
        caller: z
          .object({
            kind: z.literal('renderer'),
            webContentsId: callerId,
            windowId: callerId.nullable()
          })
          .strict()
      })
      .strict()
  })
  .strict()

const controlRoutes = new Set<string>([
  'approvals.resolve',
  'chat.cancelSubmission',
  'chat.stopStream',
  'chat.respondToolInteraction',
  'chat.dismissToolInteraction',
  'runs.cancel',
  'oauth.openaiCodex.cancelLogin',
  'oauth.xaiGrok.cancelLogin',
  'acpAuth.cancel',
  'acp.elicitation.respond',
  'mcp.submitSamplingDecision',
  'mcp.cancelSamplingRequest',
  'mcp.submitElicitationDecision',
  'mcp.cancelElicitationRequest',
  'mcp.apps.submitConsent',
  'remoteControl.cancelFeishuAuth',
  'remoteControl.cancelFeishuInstall',
  'syncPeer.cancel',
  'toolchains.cancelInstall'
] satisfies DeepchatRouteName[])

export function isCoreControlRoute(routeName: string): boolean {
  return controlRoutes.has(routeName)
}

const directory = z.string().min(1).max(32768)
export const CoreKernelBootstrapSchema = z
  .object({
    temporaryDirectory: directory,
    appDataDirectory: directory,
    documentsDirectory: directory.nullable(),
    projectHomeDirectory: directory.nullable(),
    resourcesPath: directory,
    workingDirectory: directory,
    builtinSkillsDirectories: z.array(directory).max(64),
    providerCatalogPath: directory,
    allowInsecureTls: z.boolean()
  })
  .strict()
export type CoreKernelBootstrap = z.infer<typeof CoreKernelBootstrapSchema>

const error = z.object({ name: z.string().max(256), message: z.string().max(8192) }).strict()
export const CoreFrameSchema = z.union([
  z.object({ type: z.literal('coreReady'), runtime: CoreStatusSchema }).strict(),
  z.object({ type: z.literal('coreStopped'), message: z.string().max(8192) }).strict(),
  z
    .object({
      type: z.literal('coreReply'),
      id: z.number().int().positive(),
      value: CorePayloadSchema
    })
    .strict(),
  z.object({ type: z.literal('coreReply'), id: z.number().int().positive(), error }).strict(),
  z
    .object({
      type: z.literal('coreNativeCall'),
      id: z.number().int().positive(),
      generation: z.string().uuid(),
      method: CoreNativeMethodSchema,
      args: CorePayloadSchema
    })
    .strict()
])
export type CoreFrame = z.infer<typeof CoreFrameSchema>

export type CoreRequest =
  | { type: 'coreStart'; config: CoreCarrierConfig }
  | { type: 'coreCall'; id: number; method: CoreMethod; args: CorePayload }
  | { type: 'coreNativeReply'; id: number; generation: string; value: CorePayload }
  | {
      type: 'coreNativeReply'
      id: number
      generation: string
      error: { name: string; message: string }
    }
