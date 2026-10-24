import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { z } from 'zod'
import { AdmissionObservationSchema } from '@shared/harness/admission'
import type { AgentInvocationAdmissionObservation } from '@shared/harness/admission'

const MAX_FRAME_BYTES = 64 * 1024
const MAX_BUFFER_BYTES = 1024 * 1024
const MAX_REQUESTS = 1024
const frameSchema = z.union([
  z
    .object({
      type: z.literal('ready'),
      protocol: z.literal(1),
      hostPid: z.number().int().positive(),
      runtime: z
        .object({
          pid: z.number().int().positive(),
          node: z.string().max(64),
          electron: z.string().max(64).nullable(),
          modules: z.string().max(32)
        })
        .strict()
    })
    .strict(),
  z
    .object({ type: z.literal('reply'), id: z.number().int().positive(), value: z.unknown() })
    .strict(),
  z
    .object({
      type: z.literal('reply'),
      id: z.number().int().positive(),
      error: z
        .object({
          name: z.string().max(256),
          message: z.string().max(8192)
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal('observation'),
      sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      value: z.unknown()
    })
    .strict()
])

type Method = 'acquire' | 'release' | 'snapshot' | 'close' | 'flushObservations'
type RuntimeInfo = Extract<z.infer<typeof frameSchema>, { type: 'ready' }>
interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  cleanup: () => void
}

export class HarnessRuntime {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly ready = Promise.withResolvers<RuntimeInfo>()
  private readonly exited = Promise.withResolvers<void>()
  private readonly pending = new Map<number, Pending>()
  private buffer = Buffer.alloc(0)
  private nextId = 0
  private nextObservation = 1
  private observationDrops = 0
  private readonly observations = new Map<number, AgentInvocationAdmissionObservation | null>()
  private failure: Error | undefined
  private stopping = false
  private stopPromise: Promise<void> | undefined
  private info: RuntimeInfo | undefined

  private constructor(
    directory: string,
    electronExecutable: string,
    capacity: number,
    maxPending: number,
    private readonly observe: (value: AgentInvocationAdmissionObservation) => void | Promise<void>
  ) {
    const host = path.join(
      directory,
      `deepchat-harness-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
    )
    this.child = spawn(
      host,
      [
        electronExecutable,
        path.join(directory, 'node_modules', '@arcships', 'rutis-runtime'),
        path.join(directory, 'admission.mjs'),
        String(capacity),
        String(maxPending)
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    )
    this.child.stderr.resume()
    this.child.on('error', () =>
      this.fail(new Error('Cannot start Rutis host. Run pnpm harness:build.'))
    )
    this.child.on('close', (code, signal) => {
      this.fail(
        new Error(
          `Rutis host exited (${signal ?? code ?? 'unknown'}). Restart DeepChat to restore admission.`
        )
      )
      this.exited.resolve()
    })
    this.child.stdout.on('data', (bytes: Buffer) => {
      try {
        this.read(bytes)
      } catch {
        this.fail(new Error('Invalid Rutis host response'))
      }
    })
    this.child.stdout.on('error', () => this.fail(new Error('Rutis host output failed')))
    this.child.stdin.on('error', () => this.fail(new Error('Rutis host input failed')))
  }

  static async start(options: {
    directory: string
    electronExecutable: string
    capacity: number
    maxPending: number
    observe: (value: AgentInvocationAdmissionObservation) => void | Promise<void>
  }): Promise<HarnessRuntime> {
    const runtime = new HarnessRuntime(
      options.directory,
      options.electronExecutable,
      options.capacity,
      options.maxPending,
      options.observe
    )
    const timer = setTimeout(
      () => runtime.fail(new Error('Rutis admission startup timed out')),
      15_000
    )
    timer.unref()
    try {
      await runtime.ready.promise
      return runtime
    } catch (error) {
      await runtime.stop().catch(() => undefined)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  get identity(): RuntimeInfo | undefined {
    return this.info
  }

  request(method: Method, args: unknown[]): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.stopping) return Promise.reject(new Error('Rutis admission is stopping'))
    if (this.pending.size >= MAX_REQUESTS) {
      this.fail(new Error('Rutis admission request limit exceeded'))
      return Promise.reject(this.failure)
    }
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer =
        method === 'acquire'
          ? undefined
          : setTimeout(() => this.fail(new Error(`Rutis admission ${method} timed out`)), 10_000)
      timer?.unref()
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer)
        }
      })
      this.send({ type: 'call', id, method, args })
    })
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopping = true
    this.child.stdin.end()
    this.stopPromise = (async () => {
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 12_000)
      timer.unref()
      try {
        await this.exited.promise
      } finally {
        clearTimeout(timer)
      }
    })()
    return this.stopPromise
  }

  private send(value: unknown): void {
    if (this.failure) return
    try {
      const json = Buffer.from(JSON.stringify(value))
      if (
        json.length > MAX_FRAME_BYTES ||
        this.child.stdin.writableLength + 4 + json.length > MAX_BUFFER_BYTES
      ) {
        throw new Error('Rutis admission transport limit exceeded')
      }
      const packet = Buffer.allocUnsafe(4 + json.length)
      packet.writeUInt32BE(json.length)
      json.copy(packet, 4)
      this.child.stdin.write(packet)
    } catch {
      this.fail(new Error('Rutis admission transport write failed'))
    }
  }

  private read(bytes: Buffer): void {
    if (this.buffer.length + bytes.length > MAX_BUFFER_BYTES)
      throw new Error('Host buffer exceeded')
    this.buffer = Buffer.concat([this.buffer, bytes])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length === 0 || length > MAX_FRAME_BYTES) throw new Error('Invalid frame length')
      if (this.buffer.length < length + 4) return
      const frame = frameSchema.parse(
        JSON.parse(this.buffer.subarray(4, 4 + length).toString('utf8'))
      )
      this.buffer = this.buffer.subarray(4 + length)
      if (frame.type === 'ready') {
        if (this.info) throw new Error('Admission generation changed')
        this.info = frame
        this.ready.resolve(frame)
      } else if (frame.type === 'observation') {
        if (frame.sequence < this.nextObservation) continue
        const parsed = AdmissionObservationSchema.safeParse(frame.value)
        this.observations.set(frame.sequence, parsed.success ? parsed.data : null)
        if (this.observations.size > 1024) {
          this.observationDrops += this.observations.size
          this.observations.clear()
          this.nextObservation = frame.sequence + 1
        }
        while (this.observations.has(this.nextObservation)) {
          const value = this.observations.get(this.nextObservation++)
          this.observations.delete(this.nextObservation - 1)
          if (!value) {
            this.observationDrops += 1
            continue
          }
          try {
            const observed = this.observe(
              value.type === 'closed'
                ? {
                    ...value,
                    observationsDropped: value.observationsDropped + this.observationDrops
                  }
                : value
            )
            if (observed) void observed.catch(() => undefined)
          } catch {
            /* Observers cannot alter admission. */
          }
        }
      } else {
        const pending = this.pending.get(frame.id)
        if (!pending) throw new Error('Unknown harness reply')
        this.pending.delete(frame.id)
        pending.cleanup()
        if ('error' in frame) {
          const error = new Error(frame.error.message)
          error.name = frame.error.name
          pending.reject(error)
        } else pending.resolve(frame.value)
      }
    }
  }

  private fail(error: Error): void {
    if (this.failure) return
    this.failure = error
    this.ready.reject(error)
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pending.clear()
    this.child.stdin.destroy()
    if (!this.stopping && this.child.exitCode === null && this.child.pid) {
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 12_000)
      timer.unref()
      this.child.once('exit', () => clearTimeout(timer))
    }
  }
}
