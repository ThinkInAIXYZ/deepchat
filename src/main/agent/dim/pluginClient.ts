import { EventEmitter } from 'node:events'
import { createConnection, type Socket } from 'node:net'
import type { JsonValue } from '@shared/contracts/json'

export class DimConnectionError extends Error {
  constructor(
    message: string,
    public readonly outcome: 'not-sent' | 'unknown'
  ) {
    super(message)
  }
}

export class DimMethodError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: JsonValue,
    public readonly method?: string
  ) {
    super(message)
  }
}

interface PendingCall {
  method: string
  resolve(value: JsonValue): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  written: boolean
}

// Native timeline sequence numbers are u64. Preserve unsafe JSON integers verbatim.
function parseFrame(text: string): Record<string, unknown> {
  const parse = JSON.parse as (
    text: string,
    reviver: (key: string, value: unknown, context: { source?: string }) => unknown
  ) => unknown
  const value = parse(text, (_key, item, context) => {
    if (typeof item === 'number' && Number.isInteger(item) && !Number.isSafeInteger(item)) {
      if (!context.source) throw new Error('Cannot preserve dim integer')
      return context.source
    }
    return item
  })
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid dim frame')
  return value as Record<string, unknown>
}

export class DimPluginClient extends EventEmitter {
  private readonly pending = new Map<number, PendingCall>()
  private nextId = 0
  private buffer = Buffer.alloc(0)
  private closed = false
  private constructor(private readonly socket: Socket) {
    super()
    socket.on('data', (data) => this.receive(data))
    socket.on('error', () => this.close())
    socket.on('close', () => this.close())
  }

  static connect(address: string, timeoutMs = 5_000): Promise<DimPluginClient> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(address)
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new DimConnectionError('dim connection timed out', 'not-sent'))
      }, timeoutMs)
      socket.once('error', () => {
        clearTimeout(timer)
        reject(new DimConnectionError('Cannot connect to dim', 'not-sent'))
      })
      socket.once('connect', () => {
        clearTimeout(timer)
        resolve(new DimPluginClient(socket))
      })
    })
  }

  call<T = JsonValue>(method: string, params: JsonValue = {}, timeoutMs = 30_000): Promise<T> {
    if (this.closed)
      return Promise.reject(new DimConnectionError('dim is disconnected', 'not-sent'))
    if (this.pending.size >= 256)
      return Promise.reject(new DimConnectionError('Too many pending dim calls', 'not-sent'))
    const id = ++this.nextId
    let frame: Buffer
    try {
      frame = Buffer.from(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }, (_key, value) => {
          if (
            typeof value === 'number' &&
            (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
          ) {
            throw new Error('Unsafe JSON number')
          }
          return value
        }) + '\n'
      )
    } catch {
      return Promise.reject(
        new DimConnectionError('dim request is not losslessly serializable', 'not-sent')
      )
    }
    if (frame.length > 16 * 1024 * 1024)
      return Promise.reject(new Error('dim request exceeds frame limit'))
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new DimConnectionError(
            'dim request timed out; query its outcome before retrying',
            'unknown'
          )
        )
      }, timeoutMs)
      const pending: PendingCall = {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        written: false
      }
      this.pending.set(id, pending)
      // Socket errors after this boundary cannot prove that the server rejected the command.
      pending.written = true
      this.socket.write(frame, (error) => {
        if (error) this.close()
      })
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.socket.destroy()
    for (const call of this.pending.values()) {
      clearTimeout(call.timer)
      call.reject(
        new DimConnectionError(
          'dim disconnected; reconcile accepted commands before retrying',
          call.written ? 'unknown' : 'not-sent'
        )
      )
    }
    this.pending.clear()
    this.emit('disconnected')
  }

  private receive(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data])
    try {
      let end: number
      while ((end = this.buffer.indexOf(10)) !== -1) {
        if (end > 16 * 1024 * 1024) throw new Error('Oversized dim frame')
        const line = this.buffer.subarray(0, end).toString('utf8')
        this.buffer = this.buffer.subarray(end + 1)
        const message = parseFrame(line)
        if (message.jsonrpc !== '2.0') throw new Error('Invalid dim protocol')
        if (typeof message.id === 'number') {
          const call = this.pending.get(message.id)
          if (!call) continue
          this.pending.delete(message.id)
          clearTimeout(call.timer)
          if (message.error && typeof message.error === 'object') {
            const error = message.error as { code: number; message: string; data?: JsonValue }
            call.reject(new DimMethodError(error.code, error.message, error.data, call.method))
          } else if ('result' in message) call.resolve(message.result as JsonValue)
          else call.reject(new DimConnectionError('Invalid dim response', 'unknown'))
        } else if (typeof message.method === 'string') {
          this.emit('notification', { method: message.method, params: message.params })
        } else throw new Error('Invalid dim message')
      }
      if (this.buffer.length > 16 * 1024 * 1024) throw new Error('Oversized dim frame')
    } catch {
      this.close()
    }
  }
}
