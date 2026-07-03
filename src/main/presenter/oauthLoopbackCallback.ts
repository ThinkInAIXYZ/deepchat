import * as http from 'http'
import { URL } from 'url'

export const OAUTH_CALLBACK_COMPLETE_TEXT =
  'Authentication complete. You can return to DeepChat. If DeepChat does not update, copy the full URL from your browser and paste it into DeepChat.'

export type OAuthLoopbackCallbackResolution =
  | { kind: 'not-found' }
  | { kind: 'success'; code: string; state: string; url: string }
  | { kind: 'failure'; error: Error; url: string }

export type OAuthLoopbackCallbackSessionOptions = {
  expectedState: string
  path: string
  preferredPort?: number
  timeoutMs?: number
  listenHost?: string
  redirectHost?: string
  invalidCallbackMessage?: string
}

type ListenOptions = {
  server: http.Server
  port: number
  host: string
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

function writeCallbackPage(response: http.ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  response.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Authentication complete</title></head>
<body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; line-height: 1.5; margin: 48px;">
  <h1>Authentication complete</h1>
  <p>${OAUTH_CALLBACK_COMPLETE_TEXT}</p>
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
  invalidCallbackMessage = 'Invalid OAuth callback'
): OAuthLoopbackCallbackResolution {
  const redirect = new URL(redirectUri)
  const url = new URL(rawUrl || '/', redirect)
  if (
    url.protocol !== redirect.protocol ||
    url.hostname !== redirect.hostname ||
    url.port !== redirect.port ||
    url.pathname !== redirect.pathname
  ) {
    return { kind: 'not-found' }
  }

  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')
  if (error) {
    return {
      kind: 'failure',
      error: new Error(errorDescription ? `${error}: ${errorDescription}` : error),
      url: url.toString()
    }
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || state !== expectedState) {
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
    url: url.toString()
  }
}

export class OAuthLoopbackCallbackSession {
  readonly redirectUri: string

  private readonly server: http.Server
  private readonly expectedState: string
  private readonly timeout: NodeJS.Timeout
  private readonly invalidCallbackMessage: string
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
    invalidCallbackMessage: string
  ) {
    this.server = server
    this.redirectUri = redirectUri
    this.expectedState = expectedState
    this.invalidCallbackMessage = invalidCallbackMessage
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
      this.invalidCallbackMessage
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
    const url = new URL(request.url || '/', `http://${request.headers.host || redirectHost}`)
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

    writeCallbackPage(response)
    session?.resolveCallbackUrl(url.toString())
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
    options.invalidCallbackMessage || 'Invalid OAuth callback'
  )

  return session
}
