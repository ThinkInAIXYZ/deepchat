import { randomBytes, randomUUID } from 'node:crypto'
import { session, webContents, type Session } from 'electron'
import type {
  McpAppConsentKind,
  McpAppConsentRequestPayload,
  McpAppCsp,
  McpAppDescriptor,
  McpAppPermissions
} from '@shared/types/mcp'

const DEFAULT_INSTANCE_TTL_MS = 30 * 60 * 1000
const CONSENT_TIMEOUT_MS = 2 * 60 * 1000
const MAX_PENDING_CONSENTS = 64
const MAX_SANDBOX_INSTANCES = 64
const MAX_SANDBOX_INSTANCES_PER_WEB_CONTENTS = 32

type PermissionRequestHandler = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>
type PermissionCheckHandler = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>
type ElectronPermission =
  | Parameters<PermissionRequestHandler>[1]
  | Parameters<PermissionCheckHandler>[1]

export const MCP_APP_SCHEME = 'mcp-app'

export type McpAppRouteContext = {
  webContentsId: number
  windowId: number | null
}

export type McpAppSandboxInstance = {
  instanceId: string
  webContentsId: number
  windowId: number | null
  conversationId: string
  messageId: string
  blockId: string
  descriptor: McpAppDescriptor
  toolInput: Record<string, unknown>
  html: string
  csp?: McpAppCsp
  permissions?: McpAppPermissions
  prefersBorder?: boolean
  advisoryDomain?: string
  expiresAt: number
  toolAccessSuspended: boolean
}

type PendingConsent = {
  requestId: string
  instanceId: string
  webContentsId: number
  windowId: number
  kind: McpAppConsentKind
  dedupeKey: string
  promise: Promise<boolean>
  resolve: (approved: boolean) => void
  timeout: NodeJS.Timeout
}

type ConsentPublisher = (
  windowId: number,
  payload: { request: McpAppConsentRequestPayload; version: number }
) => void

const isFirstPartyRendererUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    if (url.protocol === 'file:') {
      return true
    }
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    )
  } catch {
    return false
  }
}

const parseMcpAppInstanceId = (value: string | undefined): string | null => {
  if (!value) {
    return null
  }
  try {
    const url = new URL(value)
    return url.protocol === `${MCP_APP_SCHEME}:` && url.hostname ? url.hostname : null
  } catch {
    return null
  }
}

const resolvePermissionKinds = (
  permission: ElectronPermission,
  mediaTypes: string[] | undefined
): McpAppConsentKind[] => {
  if (permission === 'geolocation') {
    return ['geolocation']
  }
  if (permission === 'clipboard-sanitized-write') {
    return ['clipboard-write']
  }
  if (permission !== 'media') {
    return []
  }
  const kinds: McpAppConsentKind[] = []
  if (mediaTypes?.includes('video')) {
    kinds.push('camera')
  }
  if (mediaTypes?.includes('audio')) {
    kinds.push('microphone')
  }
  return kinds
}

const hasDeclaredPermission = (
  permissions: McpAppPermissions | undefined,
  kind: McpAppConsentKind
): boolean => {
  switch (kind) {
    case 'camera':
      return Boolean(permissions?.camera)
    case 'microphone':
      return Boolean(permissions?.microphone)
    case 'geolocation':
      return Boolean(permissions?.geolocation)
    case 'clipboard-write':
      return Boolean(permissions?.clipboardWrite)
    default:
      return false
  }
}

export class McpAppSandboxRegistry {
  private readonly instances = new Map<string, McpAppSandboxInstance>()
  private readonly liveValidators = new Map<string, () => boolean>()
  private readonly pendingConsents = new Map<string, PendingConsent>()
  private readonly observedWebContents = new Set<number>()
  private publishConsent?: ConsentPublisher
  private configuredSession: Session | null = null

  setConsentPublisher(publisher: ConsentPublisher): void {
    this.publishConsent = publisher
  }

  create(input: {
    context: McpAppRouteContext
    conversationId: string
    messageId: string
    blockId: string
    descriptor: McpAppDescriptor
    toolInput: Record<string, unknown>
    html: string
    csp?: McpAppCsp
    permissions?: McpAppPermissions
    prefersBorder?: boolean
    advisoryDomain?: string
    validateLive(): boolean
  }): McpAppSandboxInstance {
    this.pruneExpired()
    const ownerInstanceCount = Array.from(this.instances.values()).filter(
      (instance) => instance.webContentsId === input.context.webContentsId
    ).length
    if (
      this.instances.size >= MAX_SANDBOX_INSTANCES ||
      ownerInstanceCount >= MAX_SANDBOX_INSTANCES_PER_WEB_CONTENTS
    ) {
      throw new Error('MCP App sandbox instance limit reached')
    }
    const instanceId = randomBytes(24).toString('base64url').toLowerCase()
    const instance: McpAppSandboxInstance = {
      instanceId,
      webContentsId: input.context.webContentsId,
      windowId: input.context.windowId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      blockId: input.blockId,
      descriptor: input.descriptor,
      toolInput: input.toolInput,
      html: input.html,
      csp: input.csp,
      permissions: input.permissions,
      prefersBorder: input.prefersBorder,
      advisoryDomain: input.advisoryDomain,
      expiresAt: Date.now() + DEFAULT_INSTANCE_TTL_MS,
      toolAccessSuspended: false
    }
    this.instances.set(instanceId, instance)
    this.liveValidators.set(instanceId, input.validateLive)

    if (!this.observedWebContents.has(input.context.webContentsId)) {
      const owner = webContents.fromId(input.context.webContentsId)
      if (owner) {
        this.observedWebContents.add(input.context.webContentsId)
        owner.once('destroyed', () => {
          this.revokeByWebContents(input.context.webContentsId)
          this.observedWebContents.delete(input.context.webContentsId)
        })
      }
    }

    return instance
  }

  getForProtocol(instanceId: string): McpAppSandboxInstance | null {
    this.pruneExpired()
    const instance = this.instances.get(instanceId)
    const validateLive = this.liveValidators.get(instanceId)
    if (!instance || !validateLive) {
      return null
    }
    try {
      if (validateLive()) {
        return instance
      }
    } catch {
      // Invalid or unavailable backing state makes the App instance inert.
    }
    this.revoke(instanceId)
    return null
  }

  assertOwned(instanceId: string, context: McpAppRouteContext): McpAppSandboxInstance {
    const instance = this.getForProtocol(instanceId)
    if (
      !instance ||
      instance.webContentsId !== context.webContentsId ||
      instance.windowId !== context.windowId
    ) {
      throw new Error('MCP App instance is unavailable')
    }
    return instance
  }

  revoke(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (!instance) {
      return
    }
    this.instances.delete(instanceId)
    this.liveValidators.delete(instanceId)
    for (const pending of this.pendingConsents.values()) {
      if (pending.instanceId === instanceId) {
        pending.resolve(false)
        this.deletePendingConsent(pending.requestId)
      }
    }
  }

  revokeByWebContents(webContentsId: number): void {
    for (const instance of this.instances.values()) {
      if (instance.webContentsId === webContentsId) {
        this.revoke(instance.instanceId)
      }
    }
  }

  revokeByServer(serverId: string): void {
    for (const instance of this.instances.values()) {
      if (instance.descriptor.serverId === serverId) {
        this.revoke(instance.instanceId)
      }
    }
  }

  clear(): void {
    for (const instanceId of this.instances.keys()) {
      this.revoke(instanceId)
    }
  }

  async requestConsent(
    instance: McpAppSandboxInstance,
    input: {
      kind: McpAppConsentKind
      title: string
      detail: string
      argumentsPreview?: string
      url?: string
      requestId?: string
    }
  ): Promise<boolean> {
    if (
      instance.windowId === null ||
      !this.publishConsent ||
      this.getForProtocol(instance.instanceId) !== instance
    ) {
      return false
    }

    const dedupeKey = JSON.stringify([
      input.kind,
      input.title,
      input.detail,
      input.argumentsPreview ?? '',
      input.url ?? ''
    ])
    const duplicate = Array.from(this.pendingConsents.values()).find(
      (entry) =>
        entry.instanceId === instance.instanceId &&
        (input.requestId ? entry.requestId === input.requestId : entry.dedupeKey === dedupeKey)
    )
    if (duplicate) {
      return await duplicate.promise
    }

    const requestId = input.requestId ?? randomUUID()
    if (this.pendingConsents.size >= MAX_PENDING_CONSENTS || this.pendingConsents.has(requestId)) {
      return false
    }
    let resolvePromise: (approved: boolean) => void = () => undefined
    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve
    })
    const pending: PendingConsent = {
      requestId,
      instanceId: instance.instanceId,
      webContentsId: instance.webContentsId,
      windowId: instance.windowId,
      kind: input.kind,
      dedupeKey,
      promise,
      resolve: resolvePromise,
      timeout: setTimeout(() => {
        resolvePromise(false)
        this.deletePendingConsent(requestId)
      }, CONSENT_TIMEOUT_MS)
    }
    this.pendingConsents.set(requestId, pending)
    try {
      this.publishConsent(instance.windowId, {
        request: {
          requestId,
          kind: input.kind,
          serverName: instance.descriptor.serverName,
          title: input.title,
          detail: input.detail,
          argumentsPreview: input.argumentsPreview,
          url: input.url
        },
        version: Date.now()
      })
    } catch {
      resolvePromise(false)
      this.deletePendingConsent(requestId)
    }
    return await promise
  }

  submitConsent(requestId: string, approved: boolean, context: McpAppRouteContext): boolean {
    const pending = this.pendingConsents.get(requestId)
    if (
      !pending ||
      pending.webContentsId !== context.webContentsId ||
      pending.windowId !== context.windowId
    ) {
      return false
    }
    if (approved) {
      const instance = this.getForProtocol(pending.instanceId)
      if (!instance) {
        pending.resolve(false)
        this.deletePendingConsent(requestId)
        return false
      }
    }
    pending.resolve(approved)
    this.deletePendingConsent(requestId)
    return true
  }

  configureDefaultSessionPermissions(target: Session = session.defaultSession): void {
    if (this.configuredSession === target) {
      return
    }
    this.configuredSession = target

    target.setPermissionRequestHandler((owner, permission, callback, details) => {
      const requestingUrl = details.requestingUrl || owner.getURL()
      const securityOrigin =
        'securityOrigin' in details && typeof details.securityOrigin === 'string'
          ? details.securityOrigin
          : undefined
      const instanceId =
        parseMcpAppInstanceId(requestingUrl) ?? parseMcpAppInstanceId(securityOrigin)
      if (!instanceId) {
        const ownerUrl = owner.getURL()
        callback(!isFirstPartyRendererUrl(ownerUrl) || isFirstPartyRendererUrl(requestingUrl))
        return
      }

      const instance = this.getForProtocol(instanceId)
      const mediaTypes =
        'mediaTypes' in details && Array.isArray(details.mediaTypes)
          ? details.mediaTypes.map(String)
          : undefined
      const kinds = resolvePermissionKinds(permission, mediaTypes)
      if (
        !instance ||
        instance.webContentsId !== owner.id ||
        kinds.length === 0 ||
        kinds.some((kind) => !hasDeclaredPermission(instance.permissions, kind))
      ) {
        callback(false)
        return
      }
      void Promise.all(
        kinds.map((kind) =>
          this.requestConsent(instance, {
            kind,
            title: kind,
            detail: instance.descriptor.toolName
          })
        )
      )
        .then((decisions) => callback(decisions.every(Boolean)))
        .catch(() => callback(false))
    })

    target.setPermissionCheckHandler((owner, _permission, requestingOrigin, details) => {
      const requestingUrl =
        requestingOrigin || details.requestingUrl || details.securityOrigin || owner?.getURL() || ''
      const instanceId =
        parseMcpAppInstanceId(requestingUrl) ??
        parseMcpAppInstanceId(details.securityOrigin) ??
        parseMcpAppInstanceId(details.requestingUrl)
      if (!instanceId) {
        const ownerUrl = owner?.getURL()
        return (
          !ownerUrl || !isFirstPartyRendererUrl(ownerUrl) || isFirstPartyRendererUrl(requestingUrl)
        )
      }
      // MCP App browser permissions are request-scoped; there is no standing grant to check.
      return false
    })
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const instance of this.instances.values()) {
      if (instance.expiresAt <= now) {
        this.revoke(instance.instanceId)
      }
    }
  }

  private deletePendingConsent(requestId: string): void {
    const pending = this.pendingConsents.get(requestId)
    if (!pending) {
      return
    }
    clearTimeout(pending.timeout)
    this.pendingConsents.delete(requestId)
  }
}
