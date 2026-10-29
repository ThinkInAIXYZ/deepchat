import { z } from 'zod'
import {
  createDeepchatEventEnvelope,
  hasDeepchatEventContract,
  approvalRequestedEvent,
  approvalClosedEvent,
  mcpAppConsentRequestEvent
} from '../contracts/events'
import { semanticNotificationIntentSchema } from '../notifications/semanticNotification'

const text = z.string()
const empty = z.tuple([])
const record = z.record(text, z.unknown())
const target = z
  .object({ windowId: z.number().int().positive(), webContentsId: z.number().int().positive() })
  .strict()
const context = target.extend({ windowId: z.number().int().positive().nullable() })
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
  'workspaceDesktop.revealFile': z.tuple([text]),
  'workspaceDesktop.openFile': z.tuple([text]),
  'workspaceDesktop.listFileOpenApps': z.tuple([text]),
  'workspaceDesktop.openFileWithApp': z.tuple([text, text]),
  'approvalPresentation.getTarget': empty,
  'approvalPresentation.present': z.tuple([target, approvalRequestedEvent.payload]),
  'approvalPresentation.close': z.tuple([target, approvalClosedEvent.payload]),
  'ocrCacheKeyProvider.loadOrCreateKey': empty,
  initializeFloatingButton: empty,
  assertSyncTokenStorageAvailable: empty,
  'semanticNotifications.occur': z.tuple([semanticNotificationIntentSchema]),
  'semanticNotifications.recover': z.tuple([semanticNotificationIntentSchema]),
  'dialog.showDialog': z.tuple([
    z
      .object({
        title: text,
        description: text.optional(),
        i18n: z.boolean().optional(),
        icon: z.object({ icon: text, class: text }).strict().optional(),
        buttons: z
          .array(z.object({ key: text, label: text, default: z.boolean().optional() }).strict())
          .optional(),
        timeout: z.number().finite().optional()
      })
      .strict()
  ]),
  'dialog.handleDialogResponse': z.tuple([z.object({ id: text, button: text }).strict()]),
  'dialog.handleDialogError': z.tuple([text]),
  'secureCrypto.isAvailable': empty,
  'secureCrypto.encrypt': z.tuple([text]),
  'secureCrypto.decrypt': z.tuple([text]),
  'providerCrypto.isAvailable': empty,
  'providerCrypto.encrypt': z.tuple([text]),
  'providerCrypto.decrypt': z.tuple([text]),
  getProxyUrl: empty,
  whenProxyReady: empty,
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
  openRemoteSession: z.tuple([text]),
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
  'approvalPresentation.close',
  'dialog.handleDialogResponse',
  'dialog.handleDialogError',
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
