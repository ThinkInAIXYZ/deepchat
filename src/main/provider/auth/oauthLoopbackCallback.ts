import * as http from 'http'
import { URL } from 'url'

export const OAUTH_CALLBACK_COMPLETE_TEXT =
  'Authentication complete. You can return to DeepChat. If DeepChat does not update, copy the full URL from your browser and paste it into DeepChat.'

export type OAuthLoopbackCallbackResolution =
  | { kind: 'not-found' }
  | { kind: 'success'; code: string; state: string; iss?: string; url: string }
  | { kind: 'failure'; error: Error; url: string }

export type OAuthLoopbackCallbackSessionOptions = {
  expectedState: string
  path: string
  preferredPort?: number
  timeoutMs?: number
  listenHost?: string
  redirectHost?: string
  invalidCallbackMessage?: string
  validateParameters?: (parameters: URLSearchParams) => void
}

type ListenOptions = {
  server: http.Server
  port: number
  host: string
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

function writeCallbackPage(response: http.ServerResponse, success: boolean): void {
  const title = success ? 'Authentication complete' : 'Authentication failed'
  const message = success
    ? OAUTH_CALLBACK_COMPLETE_TEXT
    : 'DeepChat rejected this authentication callback. Return to DeepChat and try again.'
  response.writeHead(success ? 200 : 400, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; line-height: 1.5; margin: 48px;">
  <h1>${title}</h1>
  <p>${message}</p>
</body>
</html>`)
}

function listen({ server, port, host }: ListenOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : port)
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export function resolveOAuthLoopbackCallbackUrl(
  rawUrl: string | undefined,
  expectedState: string,
  redirectUri: string,
  invalidCallbackMessage = 'Invalid OAuth callback',
  validateParameters?: (parameters: URLSearchParams) => void
): OAuthLoopbackCallbackResolution {
  const redirect = new URL(redirectUri)
  const url = new URL(rawUrl || '/', redirect)
  if (
    url.protocol !== redirect.protocol ||
    url.hostname !== redirect.hostname ||
    url.port !== redirect.port ||
    url.pathname !== redirect.pathname ||
    url.username ||
    url.password ||
    url.hash
  ) {
    return { kind: 'not-found' }
  }

  const state = url.searchParams.get('state')
  if (state !== expectedState) {
    return {
      kind: 'failure',
      error: new Error(invalidCallbackMessage),
      url: url.toString()
    }
  }

  try {
    validateParameters?.(url.searchParams)
  } catch (error) {
    return {
      kind: 'failure',
      error: error instanceof Error ? error : new Error(invalidCallbackMessage),
      url: url.toString()
    }
  }

  const oauthError = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')
  if (oauthError) {
    return {
      kind: 'failure',
      error: new Error(errorDescription ? `${oauthError}: ${errorDescription}` : oauthError),
      url: url.toString()
    }
  }

  const code = url.searchParams.get('code')
  if (!code) {
    return {
      kind: 'failure',
      error: new Error(invalidCallbackMessage),
      url: url.toString()
    }
  }

  return {
    kind: 'success',
    code,
    state,
    iss: url.searchParams.get('iss') || undefined,
    url: url.toString()
  }
}

export class OAuthLoopbackCallbackSession {
  readonly redirectUri: string

  private readonly server: http.Server
  private readonly expectedState: string
  private readonly timeout: NodeJS.Timeout
  private readonly invalidCallbackMessage: string
  private readonly validateParameters?: (parameters: URLSearchParams) => void
  private settled = false
  private resolveResult!: (
    result: Extract<OAuthLoopbackCallbackResolution, { kind: 'success' }>
  ) => void
  private rejectResult!: (error: Error) => void
  private readonly callbackPromise: Promise<
    Extract<OAuthLoopbackCallbackResolution, { kind: 'success' }>
  >

  constructor(
    server: http.Server,
    redirectUri: string,
    expectedState: string,
    timeoutMs: number,
    invalidCallbackMessage: string,
    validateParameters?: (parameters: URLSearchParams) => void
  ) {
    this.server = server
    this.redirectUri = redirectUri
    this.expectedState = expectedState
    this.invalidCallbackMessage = invalidCallbackMessage
    this.validateParameters = validateParameters
    this.callbackPromise = new Promise((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })
    this.timeout = setTimeout(() => {
      this.rejectOnce(new Error('OAuth callback timed out'))
    }, timeoutMs)
  }

  waitForCallback(): Promise<Extract<OAuthLoopbackCallbackResolution, { kind: 'success' }>> {
    return this.callbackPromise
  }

  resolveCallbackUrl(rawUrl: string | undefined): OAuthLoopbackCallbackResolution {
    const resolution = resolveOAuthLoopbackCallbackUrl(
      rawUrl,
      this.expectedState,
      this.redirectUri,
      this.invalidCallbackMessage,
      this.validateParameters
    )

    if (resolution.kind === 'success') {
      this.resolveOnce(resolution)
    } else if (resolution.kind === 'failure') {
      this.rejectOnce(resolution.error)
    }

    return resolution
  }

  close(): void {
    clearTimeout(this.timeout)
    try {
      this.server.close()
    } catch {}
  }

  private resolveOnce(result: Extract<OAuthLoopbackCallbackResolution, { kind: 'success' }>): void {
    if (this.settled) {
      return
    }
    this.settled = true
    this.close()
    this.resolveResult(result)
  }

  private rejectOnce(error: Error): void {
    if (this.settled) {
      return
    }
    this.settled = true
    this.close()
    this.rejectResult(error)
  }
}

export async function startOAuthLoopbackCallbackSession(
  options: OAuthLoopbackCallbackSessionOptions
): Promise<OAuthLoopbackCallbackSession> {
  const listenHost = options.listenHost || '127.0.0.1'
  const redirectHost = options.redirectHost || 'localhost'
  const path = options.path.startsWith('/') ? options.path : `/${options.path}`
  let session: OAuthLoopbackCallbackSession | null = null
  const server = http.createServer((request, response) => {
    let url: URL
    try {
      url = new URL(request.url || '/', `http://${request.headers.host || redirectHost}`)
    } catch {
      response.writeHead(400, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      })
      response.end('Invalid request')
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Method not allowed')
      return
    }

    if (url.pathname !== path) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }

    const resolution = session?.resolveCallbackUrl(url.toString())
    if (resolution?.kind === 'success') {
      writeCallbackPage(response, true)
      return
    }
    if (resolution?.kind === 'failure') {
      writeCallbackPage(response, false)
      return
    }
    response.writeHead(404, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    })
    response.end('Not found')
  })

  let port: number
  try {
    port = await listen({
      server,
      port: options.preferredPort || 0,
      host: listenHost
    })
  } catch (error) {
    if (!options.preferredPort || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
      throw error
    }
    port = await listen({ server, port: 0, host: listenHost })
  }

  const redirectUri = `http://${redirectHost}:${port}${path}`
  session = new OAuthLoopbackCallbackSession(
    server,
    redirectUri,
    options.expectedState,
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
    options.invalidCallbackMessage || 'Invalid OAuth callback',
    options.validateParameters
  )

  return session
}
