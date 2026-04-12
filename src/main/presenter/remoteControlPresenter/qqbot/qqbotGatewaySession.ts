import { WebSocket } from 'undici'
import type { QQBotRuntimeStatusSnapshot } from '../types'
import { QQBOT_GROUP_AND_C2C_INTENT } from '../types'
import { QQBotApiRequestError, QQBotClient } from './qqbotClient'

type QQBotGatewayPayload = {
  op: number
  s?: number | null
  t?: string | null
  d?: unknown
}

type QQBotReadyPayload = {
  session_id?: string
  resume_gateway_url?: string
  user?: {
    id?: string | number
    username?: string
  }
}

export interface QQBotGatewayBotUser {
  id: string
  username?: string
}

type QQBotGatewaySessionDeps = {
  client: QQBotClient
  onDispatch: (payload: QQBotGatewayPayload) => Promise<void> | void
  onStatusChange?: (snapshot: QQBotRuntimeStatusSnapshot) => void
  onBotUser?: (botUser: QQBotGatewayBotUser) => void
  onFatalError?: (message: string) => void
}

const QQBOT_HEARTBEAT_OP = 1
const QQBOT_IDENTIFY_OP = 2
const QQBOT_RESUME_OP = 6
const QQBOT_RECONNECT_OP = 7
const QQBOT_INVALID_SESSION_OP = 9
const QQBOT_HELLO_OP = 10
const QQBOT_HEARTBEAT_ACK_OP = 11
const QQBOT_RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000] as const

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const parseGatewayMessage = (input: string): QQBotGatewayPayload => {
  const payload = JSON.parse(input) as QQBotGatewayPayload
  return {
    op: Number(payload.op ?? 0),
    s: typeof payload.s === 'number' ? payload.s : null,
    t: typeof payload.t === 'string' ? payload.t : null,
    d: payload.d
  }
}

const parseWebSocketData = async (data: string | ArrayBuffer | Blob | Buffer): Promise<string> => {
  if (typeof data === 'string') {
    return data
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return data.toString('utf8')
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }

  if (typeof (data as Blob).text === 'function') {
    return await (data as Blob).text()
  }

  if (typeof (data as Blob).arrayBuffer === 'function') {
    return Buffer.from(await (data as Blob).arrayBuffer()).toString('utf8')
  }

  return ''
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError'

const isFatalQQBotError = (error: unknown): boolean =>
  error instanceof QQBotApiRequestError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 429

export class QQBotGatewaySession {
  private runPromise: Promise<void> | null = null
  private firstConnectedPromise: Promise<void> | null = null
  private resolveFirstConnected: (() => void) | null = null
  private rejectFirstConnected: ((reason?: unknown) => void) | null = null
  private stopRequested = false
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private sessionId: string | null = null
  private seq: number | null = null
  private resumeGatewayUrl: string | null = null
  private startedOnce = false

  constructor(private readonly deps: QQBotGatewaySessionDeps) {}

  async start(signal?: AbortSignal): Promise<void> {
    if (this.runPromise) {
      if (this.firstConnectedPromise) {
        return await this.firstConnectedPromise
      }
      return
    }

    this.stopRequested = false
    this.firstConnectedPromise = new Promise<void>((resolve, reject) => {
      this.resolveFirstConnected = resolve
      this.rejectFirstConnected = reject
    })

    this.runPromise = this.run(signal)
      .catch((error) => {
        this.rejectFirstConnected?.(error)
      })
      .finally(() => {
        this.cleanupHeartbeat()
        this.ws = null
        this.runPromise = null
        this.firstConnectedPromise = null
        this.resolveFirstConnected = null
        this.rejectFirstConnected = null
      })

    return await this.firstConnectedPromise
  }

  async stop(): Promise<void> {
    this.stopRequested = true
    this.cleanupHeartbeat()
    this.ws?.close()
    this.ws = null
    await this.runPromise
  }

  private async run(signal?: AbortSignal): Promise<void> {
    let attempt = 0

    while (!this.stopRequested && !signal?.aborted) {
      try {
        await this.connectOnce(signal)
        attempt = 0
      } catch (error) {
        if (this.stopRequested || signal?.aborted || isAbortError(error)) {
          return
        }

        const lastError = error instanceof Error ? error.message : String(error)
        if (isFatalQQBotError(error)) {
          this.emitStatus({
            state: 'error',
            lastError
          })
          this.rejectFirstConnected?.(error)
          this.deps.onFatalError?.(lastError)
          return
        }

        if (!this.startedOnce) {
          this.emitStatus({
            state: 'error',
            lastError
          })
          this.rejectFirstConnected?.(error)
          throw error
        }

        const delayMs =
          QQBOT_RECONNECT_BACKOFF_MS[Math.min(attempt, QQBOT_RECONNECT_BACKOFF_MS.length - 1)] ??
          30_000
        attempt += 1
        this.emitStatus({
          state: 'backoff',
          lastError
        })
        await sleep(delayMs)
      }
    }
  }

  private async connectOnce(signal?: AbortSignal): Promise<void> {
    const gatewayUrl = this.resumeGatewayUrl?.trim() || (await this.deps.client.getGatewayUrl())
    const ws = new WebSocket(gatewayUrl)
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      let connected = false
      let finished = false
      let reconnectRequested = false
      let invalidSession = false

      const cleanup = () => {
        if (finished) {
          return
        }

        finished = true
        this.cleanupHeartbeat()
        ws.removeEventListener('open', handleOpen)
        ws.removeEventListener('message', handleMessage)
        ws.removeEventListener('error', handleError)
        ws.removeEventListener('close', handleClose)
      }

      const settleResolve = () => {
        cleanup()
        resolve()
      }

      const settleReject = (error: unknown) => {
        cleanup()
        reject(error)
      }

      const ensureConnected = () => {
        if (connected) {
          return
        }

        connected = true
        this.startedOnce = true
        this.emitStatus({
          state: 'running',
          lastError: null
        })
        this.resolveFirstConnected?.()
      }

      const sendPayload = (payload: unknown) => {
        ws.send(JSON.stringify(payload))
      }

      const sendHeartbeat = () => {
        sendPayload({
          op: QQBOT_HEARTBEAT_OP,
          d: this.seq
        })
      }

      const identify = async () => {
        const accessToken = await this.deps.client.getAccessToken()
        sendPayload({
          op: QQBOT_IDENTIFY_OP,
          d: {
            token: `QQBot ${accessToken}`,
            intents: QQBOT_GROUP_AND_C2C_INTENT,
            shard: [0, 1],
            properties: {
              $os: process.platform,
              $browser: 'deepchat',
              $device: 'deepchat'
            }
          }
        })
      }

      const resume = async () => {
        const accessToken = await this.deps.client.getAccessToken()
        sendPayload({
          op: QQBOT_RESUME_OP,
          d: {
            token: `QQBot ${accessToken}`,
            session_id: this.sessionId,
            seq: this.seq
          }
        })
      }

      const handleOpen = () => {
        this.emitStatus({
          state: this.startedOnce ? 'backoff' : 'starting',
          lastError: null
        })
      }

      const handleMessage = (event: Event) => {
        void (async () => {
          try {
            const raw = await parseWebSocketData((event as MessageEvent).data)
            const payload = parseGatewayMessage(raw)

            if (typeof payload.s === 'number') {
              this.seq = payload.s
            }

            if (payload.op === QQBOT_HELLO_OP) {
              const heartbeatInterval = Number(
                (payload.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval ?? 0
              )
              this.cleanupHeartbeat()
              if (heartbeatInterval > 0) {
                this.heartbeatTimer = setInterval(() => {
                  try {
                    sendHeartbeat()
                  } catch {
                    // The close handler will take over.
                  }
                }, heartbeatInterval)
              }

              if (this.sessionId && this.seq !== null) {
                await resume()
              } else {
                await identify()
              }
              return
            }

            if (payload.op === QQBOT_HEARTBEAT_ACK_OP) {
              return
            }

            if (payload.op === QQBOT_RECONNECT_OP) {
              reconnectRequested = true
              ws.close()
              return
            }

            if (payload.op === QQBOT_INVALID_SESSION_OP) {
              invalidSession = true
              this.sessionId = null
              this.seq = null
              this.resumeGatewayUrl = null
              ws.close()
              return
            }

            if (payload.op !== 0) {
              return
            }

            if (payload.t === 'READY') {
              const ready = (payload.d ?? {}) as QQBotReadyPayload
              this.sessionId = ready.session_id?.trim() || null
              this.resumeGatewayUrl = ready.resume_gateway_url?.trim() || gatewayUrl

              const botUserId = ready.user?.id === undefined ? '' : String(ready.user.id).trim()
              if (botUserId) {
                this.deps.onBotUser?.({
                  id: botUserId,
                  username: ready.user?.username?.trim() || undefined
                })
              }

              ensureConnected()
              return
            }

            if (payload.t === 'RESUMED') {
              ensureConnected()
              return
            }

            ensureConnected()
            await this.deps.onDispatch(payload)
          } catch (error) {
            settleReject(error)
          }
        })()
      }

      const handleError = () => {
        settleReject(new Error('QQBot gateway transport error.'))
      }

      const handleClose = () => {
        if (this.stopRequested || signal?.aborted) {
          settleResolve()
          return
        }

        if (invalidSession) {
          settleReject(new Error('QQBot gateway session became invalid.'))
          return
        }

        if (reconnectRequested || connected) {
          settleReject(new Error('QQBot gateway connection closed.'))
          return
        }

        settleReject(new Error('QQBot gateway connection closed before READY.'))
      }

      ws.addEventListener('open', handleOpen)
      ws.addEventListener('message', handleMessage)
      ws.addEventListener('error', handleError)
      ws.addEventListener('close', handleClose)

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            ws.close()
            settleReject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true }
        )
      }
    })
  }

  private cleanupHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private emitStatus(
    patch: Partial<QQBotRuntimeStatusSnapshot> & { state: QQBotRuntimeStatusSnapshot['state'] }
  ): void {
    this.deps.onStatusChange?.({
      state: patch.state,
      lastError: patch.lastError ?? null,
      botUser: null
    })
  }
}
