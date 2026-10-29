import { protocol, session, webContents, BrowserWindow, shell, type Session } from 'electron'
import type { McpAppConsentKind, McpAppCsp, McpAppPermissions } from '@shared/types/mcp'
import {
  MCP_APP_SCHEME,
  type McpAppSandboxRegistry,
  type McpAppRouteContext,
  type McpAppDesktopPort
} from './sandboxRegistry'

let schemeRegistered = false

type McpAppSandboxPort = Pick<
  McpAppSandboxRegistry,
  'getProtocolPolicy' | 'requestBrowserPermission' | 'revokeByWebContents'
>

const normalizeCspSource = (source: string): string | null => {
  const valid = Array.from(source).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return character !== ';' && !/\s/u.test(character) && codePoint >= 0x20 && codePoint !== 0x7f
  })
  return source.length > 0 && valid ? source : null
}

const joinSources = (...groups: Array<string[] | undefined>): string =>
  Array.from(
    new Set(
      groups
        .flatMap((group) => group ?? [])
        .map(normalizeCspSource)
        .filter((source): source is string => source !== null)
    )
  ).join(' ')

export const buildMcpAppContentSecurityPolicy = (csp?: McpAppCsp): string => {
  const resources = csp?.resourceDomains ?? []
  const frames = csp?.frameDomains ?? []
  const connections = csp?.connectDomains ?? []
  const baseUris = csp?.baseUriDomains ?? []
  return [
    "default-src 'none'",
    `script-src ${joinSources(["'self'", "'unsafe-inline'"], resources)}`,
    `style-src ${joinSources(["'self'", "'unsafe-inline'"], resources)}`,
    `img-src ${joinSources(["'self'", 'data:', 'blob:'], resources)}`,
    `media-src ${joinSources(["'self'", 'data:', 'blob:'], resources)}`,
    `font-src ${joinSources(["'self'", 'data:'], resources)}`,
    `connect-src ${connections.length > 0 ? joinSources(connections) : "'none'"}`,
    `frame-src ${frames.length > 0 ? joinSources(frames) : "'none'"}`,
    `base-uri ${baseUris.length > 0 ? joinSources(baseUris) : "'self'"}`,
    "object-src 'none'",
    "form-action 'none'"
  ].join('; ')
}

export const buildMcpAppPermissionsPolicy = (
  permissions: McpAppPermissions | undefined
): string => {
  const policy = [
    ['camera', Boolean(permissions?.camera)],
    ['microphone', Boolean(permissions?.microphone)],
    ['geolocation', Boolean(permissions?.geolocation)],
    ['clipboard-write', Boolean(permissions?.clipboardWrite)]
  ] as const
  return policy.map(([name, allowed]) => `${name}=${allowed ? '(self)' : '()'}`).join(', ')
}

const createSandboxProxyHtml = (): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light dark">
    <meta name="referrer" content="no-referrer">
    <title>MCP App Sandbox</title>
    <style>
      html, body { width: 100%; height: 100%; margin: 0; background: transparent; overflow: hidden; }
      * { box-sizing: border-box; }
      body { display: flex; }
      iframe { width: 100%; height: 100%; flex: 1; border: 0; background: transparent; }
    </style>
  </head>
  <body>
    <script>
      (() => {
        'use strict'
        if (window.self === window.top) throw new Error('MCP App sandbox requires an iframe')
        let isolatedFromHost = false
        try {
          void window.top.location.href
        } catch {
          isolatedFromHost = true
        }
        if (!isolatedFromHost) throw new Error('MCP App sandbox is not isolated from its host')

        const parentWindow = window.parent
        const ownOrigin = window.location.origin
        const maxProxyMessageBytes = 20 * 1024 * 1024
        let parentOrigin = 'null'
        try {
          if (document.referrer) parentOrigin = new URL(document.referrer).origin
        } catch {}
        const parentTargetOrigin = parentOrigin === 'null' ? '*' : parentOrigin
        const resourceReadyMethod = 'ui/notifications/sandbox-resource-ready'
        const proxyReadyMethod = 'ui/notifications/sandbox-proxy-ready'
        const inner = document.createElement('iframe')
        inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
        document.body.appendChild(inner)
        let resourceLoaded = false

        const isBoundedRpcMessage = (message) => {
          if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return false
          try {
            const serialized = JSON.stringify(message)
            return typeof serialized === 'string' &&
              new TextEncoder().encode(serialized).byteLength <= maxProxyMessageBytes
          } catch {
            return false
          }
        }

        const isSandboxNotification = (message) =>
          typeof message.method === 'string' &&
          message.method.startsWith('ui/notifications/sandbox-')

        const buildAllow = (permissions) => {
          if (!permissions || typeof permissions !== 'object') return ''
          const values = []
          if (permissions.camera) values.push('camera')
          if (permissions.microphone) values.push('microphone')
          if (permissions.geolocation) values.push('geolocation')
          if (permissions.clipboardWrite) values.push('clipboard-write')
          return values.join('; ')
        }

        window.addEventListener('message', (event) => {
          if (event.source === parentWindow) {
            if (parentOrigin !== 'null' && event.origin !== parentOrigin) return
            const message = event.data
            if (message && message.method === resourceReadyMethod) {
              if (
                resourceLoaded ||
                !isBoundedRpcMessage(message) ||
                !message.params ||
                typeof message.params.html !== 'string'
              ) {
                return
              }
              resourceLoaded = true
              const allow = buildAllow(message.params.permissions)
              if (allow) inner.setAttribute('allow', allow)
              const doc = inner.contentDocument || (inner.contentWindow && inner.contentWindow.document)
              if (!doc) return
              doc.open()
              doc.write(message.params.html)
              doc.close()
              return
            }
            if (
              resourceLoaded &&
              inner.contentWindow &&
              isBoundedRpcMessage(message) &&
              !isSandboxNotification(message)
            ) {
              inner.contentWindow.postMessage(message, ownOrigin)
            }
            return
          }

          if (
            resourceLoaded &&
            event.source === inner.contentWindow &&
            event.origin === ownOrigin &&
            isBoundedRpcMessage(event.data) &&
            !isSandboxNotification(event.data)
          ) {
            parentWindow.postMessage(event.data, parentTargetOrigin)
          }
        })

        parentWindow.postMessage({
          jsonrpc: '2.0',
          method: proxyReadyMethod,
          params: {}
        }, parentTargetOrigin)
      })()
    </script>
  </body>
</html>`

export function registerMcpAppScheme(): void {
  if (schemeRegistered) {
    return
  }
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MCP_APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: false,
        corsEnabled: false,
        stream: false
      }
    }
  ])
  schemeRegistered = true
}

export function registerMcpAppProtocol(registry: McpAppSandboxPort): McpAppDesktopPort {
  const observedOwners = new Set<number>()
  protocol.handle(MCP_APP_SCHEME, async (request) => {
    let instanceId = ''
    try {
      const url = new URL(request.url)
      instanceId = url.hostname
      if (url.pathname !== '/sandbox.html') {
        throw new Error('Unknown MCP App sandbox path')
      }
    } catch {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }

    let policy: Awaited<ReturnType<McpAppSandboxRegistry['getProtocolPolicy']>> = null
    try {
      policy = await registry.getProtocolPolicy(instanceId)
      if (policy) requireNativeOwner(policy.context)
    } catch {
      policy = null
    }
    if (!policy) {
      return new Response('MCP App instance expired', {
        status: 410,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8'
        }
      })
    }

    return new Response(createSandboxProxyHtml(), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': buildMcpAppContentSecurityPolicy(policy.csp),
        'Content-Type': 'text/html; charset=utf-8',
        'Permissions-Policy': buildMcpAppPermissionsPolicy(policy.permissions),
        'X-Content-Type-Options': 'nosniff'
      }
    })
  })
  configureMcpAppSessionPermissions(registry)
  return {
    observeOwner: async (context) => {
      const owner = requireNativeOwner(context)
      if (!observedOwners.has(owner.id)) {
        observedOwners.add(owner.id)
        owner.once('destroyed', () => {
          registry.revokeByWebContents(context.webContentsId)
          observedOwners.delete(context.webContentsId)
        })
      }
    },
    openExternal: async (url, context) => {
      requireNativeOwner(context)
      await shell.openExternal(url)
    }
  }
}

type PermissionRequestHandler = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>
type PermissionCheckHandler = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>
type ElectronPermission =
  | Parameters<PermissionRequestHandler>[1]
  | Parameters<PermissionCheckHandler>[1]

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

const configuredSessions = new WeakMap<Session, McpAppSandboxPort>()

const requireNativeOwner = (context: McpAppRouteContext) => {
  const owner = webContents.fromId(context.webContentsId)
  if (
    !owner ||
    owner.isDestroyed() ||
    (BrowserWindow.fromWebContents(owner)?.id ?? null) !== context.windowId
  )
    throw new Error('MCP App owner is unavailable')
  return owner
}

export function configureMcpAppSessionPermissions(
  registry: McpAppSandboxPort,
  target: Session = session.defaultSession
): void {
  if (configuredSessions.get(target) === registry) return
  configuredSessions.set(target, registry)
  target.setPermissionRequestHandler((owner, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || owner.getURL()
    const securityOrigin =
      'securityOrigin' in details && typeof details.securityOrigin === 'string'
        ? details.securityOrigin
        : undefined
    const instanceId = parseMcpAppInstanceId(requestingUrl) ?? parseMcpAppInstanceId(securityOrigin)
    if (!instanceId) {
      const ownerUrl = owner.getURL()
      callback(!isFirstPartyRendererUrl(ownerUrl) || isFirstPartyRendererUrl(requestingUrl))
      return
    }

    const mediaTypes =
      'mediaTypes' in details && Array.isArray(details.mediaTypes)
        ? details.mediaTypes.map(String)
        : undefined
    const kinds = resolvePermissionKinds(permission, mediaTypes)
    if (kinds.length === 0) {
      callback(false)
      return
    }
    const context = {
      webContentsId: owner.id,
      windowId: BrowserWindow.fromWebContents(owner)?.id ?? null
    }
    let settled = false
    const complete = (allowed: boolean): void => {
      if (settled) return
      settled = true
      callback(allowed)
    }
    void registry
      .requestBrowserPermission(instanceId, context, kinds)
      .then((approved) => {
        try {
          requireNativeOwner(context)
          complete(approved)
        } catch {
          complete(false)
        }
      })
      .catch(() => complete(false))
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
