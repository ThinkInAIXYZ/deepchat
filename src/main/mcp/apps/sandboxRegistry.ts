import { randomBytes, randomUUID } from 'node:crypto'
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

export const MCP_APP_SCHEME = 'mcp-app'

export type McpAppRouteContext = {
  webContentsId: number
  windowId: number | null
}

export type McpAppDesktopPort = {
  observeOwner(context: McpAppRouteContext): Promise<void>
  openExternal(url: string, context: McpAppRouteContext): Promise<void>
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
  private readonly creations = new Map<
    string,
    { context: McpAppRouteContext; serverId: string; controller: AbortController }
  >()
  private publishConsent?: ConsentPublisher

  setConsentPublisher(publisher: ConsentPublisher): void {
    this.publishConsent = publisher
  }

  reserveCreation(context: McpAppRouteContext, serverId: string): string {
    this.pruneExpired()
    const owned =
      Array.from(this.instances.values()).filter(
        (instance) => instance.webContentsId === context.webContentsId
      ).length +
      Array.from(this.creations.values()).filter(
        (creation) => creation.context.webContentsId === context.webContentsId
      ).length
    if (
      this.instances.size + this.creations.size >= MAX_SANDBOX_INSTANCES ||
      owned >= MAX_SANDBOX_INSTANCES_PER_WEB_CONTENTS
    )
      throw new Error('MCP App sandbox instance limit reached')
    const id = randomUUID()
    this.creations.set(id, { context: { ...context }, serverId, controller: new AbortController() })
    return id
  }

  assertCreationCurrent(creationId: string): void {
    if (!this.creations.has(creationId)) {
      throw new Error('MCP App view creation is no longer active')
    }
  }

  cancelCreation(creationId: string): void {
    const creation = this.creations.get(creationId)
    this.creations.delete(creationId)
    creation?.controller.abort(new Error('MCP App view creation is no longer active'))
  }

  getCreationSignal(creationId: string): AbortSignal {
    this.assertCreationCurrent(creationId)
    return this.creations.get(creationId)!.controller.signal
  }

  async getProtocolPolicy(instanceId: string): Promise<{
    context: McpAppRouteContext
    csp?: McpAppCsp
    permissions?: McpAppPermissions
  } | null> {
    const instance = this.getForProtocol(instanceId)
    if (!instance) return null
    return structuredClone({
      context: { webContentsId: instance.webContentsId, windowId: instance.windowId },
      csp: instance.csp,
      permissions: instance.permissions
    })
  }

  async requestBrowserPermission(
    instanceId: string,
    context: McpAppRouteContext,
    kinds: readonly McpAppConsentKind[]
  ): Promise<boolean> {
    const instance = this.getForProtocol(instanceId)
    if (
      !instance ||
      instance.webContentsId !== context.webContentsId ||
      instance.windowId !== context.windowId ||
      kinds.length === 0 ||
      kinds.length > 4 ||
      kinds.some((kind) => !hasDeclaredPermission(instance.permissions, kind))
    )
      return false
    const decisions = await Promise.all(
      kinds.map((kind) =>
        this.requestConsent(instance, { kind, title: kind, detail: instance.descriptor.toolName })
      )
    )
    return decisions.every(Boolean) && this.getForProtocol(instanceId) === instance
  }

  create(input: {
    creationId: string
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
    this.assertCreationCurrent(input.creationId)
    const creation = this.creations.get(input.creationId)!
    if (
      creation.context.webContentsId !== input.context.webContentsId ||
      creation.context.windowId !== input.context.windowId ||
      creation.serverId !== input.descriptor.serverId
    )
      throw new Error('MCP App creation binding changed')
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
    this.creations.delete(input.creationId)
    this.instances.set(instanceId, instance)
    this.liveValidators.set(instanceId, input.validateLive)

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
    for (const [id, creation] of this.creations) {
      if (creation.context.webContentsId === webContentsId) this.cancelCreation(id)
    }
    for (const instance of this.instances.values()) {
      if (instance.webContentsId === webContentsId) {
        this.revoke(instance.instanceId)
      }
    }
  }

  revokeByServer(serverId: string): void {
    for (const [id, creation] of this.creations) {
      if (creation.serverId === serverId) this.cancelCreation(id)
    }
    for (const instance of this.instances.values()) {
      if (instance.descriptor.serverId === serverId) {
        this.revoke(instance.instanceId)
      }
    }
  }

  clear(): void {
    for (const id of this.creations.keys()) this.cancelCreation(id)
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
