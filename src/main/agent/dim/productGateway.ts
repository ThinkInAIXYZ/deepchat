import { createServer, type Server, type Socket } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { JsonValue } from '@shared/contracts/json'
import type { DimMcpServer } from './mcp'

type JsonObject = { [key: string]: JsonValue }

export interface DimProductToolDefinition {
  name: string
  description: string
  inputSchema: JsonObject
  source: 'extension'
  risk: 'read_filesystem' | 'write_filesystem' | 'execute_process' | 'network' | 'session'
  metadata?: JsonObject
}
export interface DimProductToolCall {
  sessionId: string
  branchId: string
  turnId: string
  callId: string
  name: string
  arguments: JsonObject
}
export interface DimProductToolResult {
  content: string | JsonValue[]
  structuredContent?: JsonObject
  isError?: boolean
  blobRefs?: JsonValue[]
  backgroundTask?: JsonObject
  contextMessages?: JsonValue[]
  effects?: JsonValue[]
}
export interface DimProductCapabilitySet {
  version: string
  tools: DimProductToolDefinition[]
  execute(call: DimProductToolCall, signal: AbortSignal): Promise<DimProductToolResult>
}
export interface DimProductContextRequest {
  sessionId: string
  turnId: string
  requestId: string
  through: string
  providerId: string
  modelId: string
  query: string
  nativeAgentId?: string
}
export interface DimProductContextReply {
  messages: Array<{ role: 'user'; content: string }>
  receipts?: JsonValue[]
}
export interface DimProductGatewayOptions {
  // Resolve through the durable native-to-product binding and current product authorization.
  // Only capabilities that dim does not implement belong in this catalog.
  resolve(nativeSessionId: string): Promise<DimProductCapabilitySet>
  context?(request: DimProductContextRequest, signal: AbortSignal): Promise<DimProductContextReply>
  mcp?(sessionId: string, signal: AbortSignal): Promise<Record<string, DimMcpServer>>
  credential?(
    providerId: string,
    reference: string,
    signal: AbortSignal
  ): Promise<string | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }>
}

const MAX_FRAME = 16 * 1024 * 1024

/** A private capability endpoint for the injected plugin, never an agent or model executor. */
export class DimProductGateway {
  private server: Server | null = null
  private directory: string | null = null
  private address: string | null = null
  private readonly sockets = new Set<Socket>()
  private starting: Promise<string> | null = null
  private stopping: Promise<void> | null = null

  constructor(private readonly options: DimProductGatewayOptions) {}

  start(): Promise<string> {
    if (this.stopping) return this.stopping.then(() => this.start())
    if (this.starting) return this.starting
    if (this.address) return Promise.resolve(this.address)
    const starting = this.listen()
    this.starting = starting
    void starting
      .finally(() => {
        this.starting = null
      })
      .catch(() => {})
    return starting
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    const stopping = this.shutdown()
    this.stopping = stopping
    void stopping
      .finally(() => {
        if (this.stopping === stopping) this.stopping = null
      })
      .catch(() => {})
    return stopping
  }

  private async shutdown(): Promise<void> {
    await this.starting?.catch(() => {})
    for (const socket of this.sockets) socket.destroy()
    const server = this.server
    this.server = null
    this.address = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (this.directory) await rm(this.directory, { recursive: true, force: true })
    this.directory = null
  }

  private async listen(): Promise<string> {
    let address: string
    if (process.platform === 'win32') address = `\\\\.\\pipe\\deepchat-capabilities-${randomUUID()}`
    else {
      this.directory = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-cap-'))
      address = path.join(this.directory, 'desktop.sock')
    }
    const server = createServer((socket) => this.accept(socket))
    this.server = server
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(address, () => {
          server.off('error', reject)
          resolve()
        })
      })
      this.address = address
      return address
    } catch (error) {
      this.server = null
      server.close()
      if (this.directory) await rm(this.directory, { recursive: true, force: true })
      this.directory = null
      throw error
    }
  }

  private accept(socket: Socket): void {
    if (this.sockets.size >= 256) {
      socket.destroy()
      return
    }
    this.sockets.add(socket)
    const controller = new AbortController()
    let buffer = Buffer.alloc(0)
    let admitted = false
    let ended = false
    const reply = (value: JsonValue) => {
      if (ended || socket.destroyed) return
      ended = true
      let frame: string
      try {
        frame = JSON.stringify(value) + '\n'
      } catch {
        socket.destroy()
        return
      }
      if (Buffer.byteLength(frame) > MAX_FRAME) {
        frame = JSON.stringify({ error: 'Product capability result exceeds frame limit' }) + '\n'
      }
      socket.end(frame)
    }
    socket.once('close', () => {
      this.sockets.delete(socket)
      controller.abort(new Error('dim product capability connection ended'))
    })
    socket.on('error', () => socket.destroy())
    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data])
      if (buffer.length > MAX_FRAME) {
        socket.destroy()
        return
      }
      let end: number
      while ((end = buffer.indexOf(10)) !== -1) {
        const line = buffer.subarray(0, end).toString('utf8')
        buffer = buffer.subarray(end + 1)
        let request: Record<string, unknown>
        try {
          request = JSON.parse(line)
          if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error()
        } catch {
          socket.destroy()
          return
        }
        if (admitted) {
          if (request.kind !== 'cancel') {
            socket.destroy()
            return
          }
          controller.abort(new Error('dim cancelled the product tool'))
          continue
        }
        admitted = true
        void this.dispatch(request, controller.signal).then(
          (result) => reply({ result }),
          (error) =>
            reply({ error: error instanceof Error ? error.message : 'Product capability failed' })
        )
      }
    })
  }

  private async dispatch(
    request: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<JsonValue> {
    if (request.kind === 'mcp') {
      if (
        typeof request.sessionId !== 'string' ||
        !request.sessionId ||
        request.sessionId.length > 4096
      )
        throw new Error('MCP configuration requires a native session')
      const servers = (await this.options.mcp?.(request.sessionId, signal)) ?? {}
      signal.throwIfAborted()
      return { servers: servers as unknown as JsonValue }
    }
    if (request.kind === 'credential') {
      if (
        !this.options.credential ||
        typeof request.providerId !== 'string' ||
        !request.providerId ||
        typeof request.reference !== 'string' ||
        !request.reference ||
        request.reference.length > 4096
      )
        throw new Error('Credential reference is unavailable')
      try {
        const value = await this.options.credential(request.providerId, request.reference, signal)
        signal.throwIfAborted()
        return value
      } catch {
        throw new Error('Credential reference is unavailable')
      }
    }
    if (request.kind === 'context') {
      if (
        !this.options.context ||
        ['sessionId', 'turnId', 'requestId', 'providerId', 'modelId'].some(
          (key) => typeof request[key] !== 'string' || !request[key] || request[key].length > 4096
        ) ||
        typeof request.through !== 'string' ||
        !/^(0|[1-9][0-9]{0,19})$/.test(request.through) ||
        BigInt(request.through) > 18446744073709551615n ||
        typeof request.query !== 'string' ||
        request.query.length > 65_536 ||
        (request.nativeAgentId != null &&
          (typeof request.nativeAgentId !== 'string' ||
            !request.nativeAgentId ||
            request.nativeAgentId.length > 4096))
      )
        throw new Error('Invalid native context request')
      const result = await this.options.context(
        {
          sessionId: request.sessionId as string,
          turnId: request.turnId as string,
          requestId: request.requestId as string,
          providerId: request.providerId as string,
          modelId: request.modelId as string,
          through: request.through,
          query: request.query,
          ...(typeof request.nativeAgentId === 'string'
            ? { nativeAgentId: request.nativeAgentId }
            : {})
        },
        signal
      )
      signal.throwIfAborted()
      if (
        !Array.isArray(result.messages) ||
        result.messages.length > 32 ||
        result.messages.some(
          (message) => message.role !== 'user' || typeof message.content !== 'string'
        ) ||
        (result.receipts && (!Array.isArray(result.receipts) || result.receipts.length > 128))
      )
        throw new Error('Invalid product context contribution')
      return result as unknown as JsonValue
    }
    if (typeof request.sessionId !== 'string' || !request.sessionId)
      throw new Error('Product capability requires a native session')
    if (request.kind !== 'catalog' && request.kind !== 'execute')
      throw new Error('Unknown product capability')
    const capabilities = await this.options.resolve(request.sessionId)
    signal.throwIfAborted()
    if (!capabilities.version || capabilities.tools.length > 1024)
      throw new Error('Invalid product capability catalog')
    if (request.kind === 'catalog')
      return { version: capabilities.version, tools: capabilities.tools as unknown as JsonValue[] }
    if (request.version !== capabilities.version)
      throw new Error('Product capability was replaced; refresh its catalog')
    if (
      typeof request.name !== 'string' ||
      !capabilities.tools.some((tool) => tool.name === request.name)
    )
      throw new Error('Product tool is no longer authorized')
    if (
      ['branchId', 'turnId', 'callId'].some(
        (key) => typeof request[key] !== 'string' || !request[key]
      )
    )
      throw new Error('Product tool requires its native execution identity')
    if (
      !request.arguments ||
      typeof request.arguments !== 'object' ||
      Array.isArray(request.arguments)
    )
      throw new Error('Product tool requires object arguments')
    const result = await capabilities.execute(
      {
        sessionId: request.sessionId,
        branchId: request.branchId as string,
        turnId: request.turnId as string,
        callId: request.callId as string,
        name: request.name,
        arguments: request.arguments as JsonObject
      },
      signal
    )
    signal.throwIfAborted()
    return result as unknown as JsonValue
  }
}
