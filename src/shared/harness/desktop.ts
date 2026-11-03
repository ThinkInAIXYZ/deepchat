import { z } from 'zod'
import {
  createDeepchatEventEnvelope,
  hasDeepchatEventContract,
  approvalRequestedEvent,
  approvalClosedEvent,
  mcpAppConsentRequestEvent
} from '../contracts/events'
import { semanticNotificationIntentSchema } from '../notifications/semanticNotification'
import { SPLASH_DEBUG_MODES } from '../contracts/splash'
import {
  RendererPerformanceRecordSchema,
  fileSaveImageRoute,
  fileCopyImageRoute,
  computerUseSetPreviewModeRoute
} from '../contracts/routes'

const text = z.string()
const empty = z.tuple([])
const record = z.record(text, z.unknown())
export const CoreProxySnapshotSchema = z
  .object({
    version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    proxyUrl: text.nullable(),
    noProxy: text
  })
  .strict()
export type CoreProxySnapshot = z.infer<typeof CoreProxySnapshotSchema>
export const CoreWindowTargetSchema = z
  .object({ windowId: z.number().int().positive(), webContentsId: z.number().int().positive() })
  .strict()
export const CoreApprovalTargetSchema = z.union([
  CoreWindowTargetSchema,
  z.object({ host: z.literal('terminal') }).strict()
])
const context = CoreWindowTargetSchema.extend({ windowId: z.number().int().positive().nullable() })
const rendererCaller = context.extend({ kind: z.literal('renderer') })
const envelope = z
  .object({ name: text.refine(hasDeepchatEventContract), payload: z.unknown() })
  .strict()
  .transform((value) => {
    if (!hasDeepchatEventContract(value.name)) throw new Error('Unknown Core event')
    return createDeepchatEventEnvelope(value.name, value.payload)
  })
const preview = z
  .object({
    conversationId: text,
    runId: text,
    toolCallId: text,
    toolName: text,
    args: record,
    source: z.object({ serverName: text, ownerPluginId: text.optional() }).strict()
  })
  .strict()

export const CoreDesktopArguments = {
  'configurationHost.pause': empty,
  'configurationHost.resume': empty,
  'configurationHost.stopWrites': empty,
  'configurationHost.drainWrites': empty,
  'configurationHost.startWrites': empty,
  isSettingsWindow: z.tuple([z.number().int().positive().nullable()]),
  isMainWindowContext: z.tuple([rendererCaller]),
  'sessionPresentation.focusBrowser': z.tuple([text, rendererCaller]),
  'sessionPresentation.setComputerUsePreview': z.tuple([
    text,
    computerUseSetPreviewModeRoute.input.shape.mode,
    rendererCaller
  ]),
  'sessionPresentation.dismissComputerUsePreview': z.tuple([text, text, rendererCaller]),
  'rendererPerformance.record': z.tuple([RendererPerformanceRecordSchema]),
  'splash.showDebugScenario': z.tuple([z.enum(SPLASH_DEBUG_MODES)]),
  'splash.closeDebugScenario': empty,
  'images.saveImage': z.tuple([fileSaveImageRoute.input]),
  'images.copyImage': z.tuple([fileCopyImageRoute.input]),
  pickToolchainPath: empty,
  hasTrustedRenderer: empty,
  applyProxy: z.tuple([z.enum(['system', 'none', 'custom']), text, z.boolean()]),
  'copilotAuthorization.browser': z.tuple([text.optional()]),
  'copilotAuthorization.device': z.tuple([text.optional()]),
  'workspaceDesktop.revealFile': z.tuple([text]),
  'workspaceDesktop.openFile': z.tuple([text]),
  'workspaceDesktop.listFileOpenApps': z.tuple([text]),
  'workspaceDesktop.openFileWithApp': z.tuple([text, text]),
  'approvalPresentation.getTarget': empty,
  'approvalPresentation.present': z.tuple([
    CoreApprovalTargetSchema,
    approvalRequestedEvent.payload
  ]),
  'approvalPresentation.close': z.tuple([CoreApprovalTargetSchema, approvalClosedEvent.payload]),
  'ocrCacheKeyProvider.loadOrCreateKey': empty,
  initializeFloatingButton: empty,
  assertSyncTokenStorageAvailable: empty,
  'semanticNotifications.occur': z.tuple([semanticNotificationIntentSchema]),
  'semanticNotifications.recover': z.tuple([semanticNotificationIntentSchema]),
  'secureCrypto.isAvailable': empty,
  'secureCrypto.encrypt': z.tuple([text]),
  'secureCrypto.decrypt': z.tuple([text]),
  'providerCrypto.isAvailable': empty,
  'providerCrypto.encrypt': z.tuple([text]),
  'providerCrypto.decrypt': z.tuple([text]),
  getProxySnapshot: empty,
  openExternal: z.tuple([text]),
  openPath: z.tuple([text]),
  selectDirectory: empty,
  cacheImage: z.tuple([
    text,
    z.object({ allowPrivateNetwork: z.boolean().optional() }).strict().optional()
  ]),
  'agentDesktop.readImageSize': z.tuple([text]),
  'agentDesktop.createSettingsWindow': empty,
  'agentDesktop.sendSettingsNavigation': z.tuple([
    z.number().int().positive(),
    z
      .object({
        routeName: text,
        params: z.record(text, text).optional(),
        section: text.optional()
      })
      .strict()
  ]),
  'pluginSettingsWindow.open': z.tuple([
    z.object({ pluginId: text, title: text, entry: text }).strict()
  ]),
  'pluginSettingsWindow.close': z.tuple([text]),
  'pluginSettingsWindow.closeAll': empty,
  'pluginSettingsWindow.getPluginIdForWebContents': z.tuple([z.number().int().positive()]),
  'remoteAuthWindows.open': z.tuple([
    z.discriminatedUnion('kind', [
      z
        .object({
          id: text,
          kind: z.literal('feishu'),
          url: text,
          brand: z.enum(['feishu', 'lark']),
          redirectUri: text
        })
        .strict(),
      z.object({ id: text, kind: z.literal('weixin-ilink'), url: text }).strict()
    ])
  ]),
  'remoteAuthWindows.close': z.tuple([text]),
  'remoteAuthWindows.closeAll': empty,
  'remoteSessionWindow.select': empty,
  'remoteSessionWindow.present': z.tuple([CoreWindowTargetSchema]),
  showNotification: z.tuple([
    z.object({ id: text, title: text, body: text, silent: z.boolean().optional() }).strict()
  ]),
  'mcpPreview.shouldCaptureAfterClick': z.tuple([preview]),
  'mcpPreview.started': z.tuple([preview]),
  'mcpPreview.completed': z.tuple([preview, record]),
  'mcpPreview.failed': z.tuple([preview, z.unknown()]),
  'sessionUiPort.refreshSessionUi': empty,
  mcpReadinessChanged: z.tuple([z.boolean()]),
  reportStartupFailure: z.tuple([
    text,
    text,
    z.object({ message: text, error: z.unknown(), startupRunId: text }).strict().optional()
  ]),
  onSessionInactive: z.tuple([text]),
  'renderer.broadcast': z.tuple([envelope]),
  'renderer.send': z.tuple([z.number().int().positive(), envelope]),
  sendToRenderer: z
    .tuple([z.number().int().positive(), text.refine(hasDeepchatEventContract), z.unknown()])
    .transform(([id, name, payload]) => {
      if (!hasDeepchatEventContract(name)) throw new Error('Unknown Core event')
      return [id, name, createDeepchatEventEnvelope(name, payload).payload]
    }),
  destroySessionBrowser: z.tuple([text]),
  observeDelegation: z.tuple([record]),
  runJournalObserver: z.tuple([record]),
  notifySessionCompletion: z.tuple([z.object({ id: text, title: text }).strict()]),
  fetchRegistryIcon: z.tuple([text]),
  'mcpAppDesktop.observeOwner': z.tuple([context]),
  'mcpAppDesktop.openExternal': z.tuple([text, context]),
  publishMcpConsent: z.tuple([z.number().int().positive(), mcpAppConsentRequestEvent.payload])
} as const
export type CoreDesktopMethod = keyof typeof CoreDesktopArguments
const method = z.enum(
  Object.keys(CoreDesktopArguments) as [CoreDesktopMethod, ...CoreDesktopMethod[]]
)
const id = z.string().uuid()
export const CoreDesktopCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('call'), id, method, args: z.array(z.unknown()) }).strict(),
  z
    .object({
      operation: z.literal('retire'),
      calls: z.array(id).max(32),
      watches: z.array(id).max(32),
      settledCalls: z.array(id).max(32)
    })
    .strict(),
  z
    .object({ operation: z.literal('watch'), id, webContentsId: z.number().int().positive() })
    .strict(),
  z.object({ operation: z.literal('capabilities') }).strict(),
  z.object({ operation: z.literal('close') }).strict()
])
export type CoreDesktopCommand = z.infer<typeof CoreDesktopCommandSchema>
export const CoreDesktopEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('desktop.rendererDestroyed'), id }).strict(),
  z
    .object({
      type: z.literal('desktop.remoteAuthWindow'),
      event: z.object({ id: text, type: z.enum(['closed', 'error']) }).strict()
    })
    .strict()
])
export type CoreDesktopEvent = z.infer<typeof CoreDesktopEventSchema>
export const CoreDesktopCapabilitiesSchema = z
  .object({ preview: z.boolean(), journal: z.boolean() })
  .strict()

const retirement = new Set<CoreDesktopMethod>([
  'configurationHost.pause',
  'configurationHost.stopWrites',
  'configurationHost.drainWrites',
  'remoteAuthWindows.closeAll',
  'approvalPresentation.close',
  'pluginSettingsWindow.close',
  'pluginSettingsWindow.closeAll',
  'remoteAuthWindows.close',
  'destroySessionBrowser',
  'onSessionInactive',
  'semanticNotifications.recover'
])
export function isCoreDesktopDrain(input: unknown): boolean {
  const parsed = z.tuple([CoreDesktopCommandSchema]).safeParse(input)
  if (!parsed.success) return false
  const [command] = parsed.data
  return (
    command.operation === 'retire' ||
    command.operation === 'close' ||
    (command.operation === 'call' &&
      (retirement.has(command.method) ||
        (command.method === 'mcpReadinessChanged' && command.args[0] === false)))
  )
}
