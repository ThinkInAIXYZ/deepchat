import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdtemp, open, realpath, rm, lstat } from 'node:fs/promises'
import path from 'node:path'
import { serialize, deserialize } from 'node:v8'
import {
  CORE_CARRIER_FILES,
  CORE_INLINE_BYTES,
  CORE_VALUE_BYTES,
  CoreCarrierConfigSchema,
  CorePayloadSchema,
  type CoreCarrierConfig,
  type CorePayload
} from '@shared/harness/core'

export class CorePayloadStore {
  private readonly key: Buffer
  private readonly files = new Map<string, 'writing' | 'ready'>()
  private readonly operations = new Set<Promise<unknown>>()
  private closed = false

  constructor(
    readonly config: CoreCarrierConfig,
    private readonly sender: 'main' | 'core'
  ) {
    CoreCarrierConfigSchema.parse(config)
    if (!path.isAbsolute(config.directory)) throw new Error('Core carrier root must be absolute')
    this.key = Buffer.from(config.key, 'base64')
    if (this.key.length !== 32 || this.key.toString('base64') !== config.key)
      throw new Error('Invalid Core carrier key')
  }

  static async create(temporaryDirectory: string): Promise<CorePayloadStore> {
    const directory = await realpath(await mkdtemp(path.join(temporaryDirectory, 'deepchat-core-')))
    return new CorePayloadStore(
      { directory, generation: randomUUID(), key: randomBytes(32).toString('base64') },
      'main'
    )
  }

  private assertActive(): void {
    if (this.closed) throw new Error('Core payload generation is closed')
  }

  private file(ref: Extract<CorePayload, { operation: string }>): string {
    return path.join(
      this.config.directory,
      `${this.config.generation}.${ref.sender}.${ref.operation}`
    )
  }

  private aad(ref: Extract<CorePayload, { operation: string }>): Buffer {
    return Buffer.from(`${this.config.generation}:${ref.sender}:${ref.operation}:${ref.bytes}`)
  }

  private track<T>(run: () => Promise<T>): Promise<T> {
    const operation = run()
    this.operations.add(operation)
    void operation.then(
      () => this.operations.delete(operation),
      () => this.operations.delete(operation)
    )
    return operation
  }

  encode(value: unknown): Promise<CorePayload> {
    return this.track(() => this.encodeValue(value))
  }

  private async encodeValue(value: unknown): Promise<CorePayload> {
    this.assertActive()
    const bytes = serialize(value)
    if (bytes.length > CORE_VALUE_BYTES) throw new Error('Core value requires a paged transfer')
    if (bytes.length <= CORE_INLINE_BYTES) return { inline: bytes.toString('base64') }
    for (const [file, state] of this.files) {
      if (state === 'writing') continue
      try {
        await lstat(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        this.files.delete(file)
      }
    }
    this.assertActive()
    if (this.files.size >= CORE_CARRIER_FILES) throw new Error('Core carrier quota exceeded')
    const ref = { operation: randomUUID(), sender: this.sender, bytes: bytes.length }
    const file = this.file(ref)
    this.files.set(file, 'writing')
    try {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
      cipher.setAAD(this.aad(ref))
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
      const handle = await open(
        file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600
      )
      try {
        await handle.writeFile(Buffer.concat([nonce, cipher.getAuthTag(), encrypted]))
      } finally {
        await handle.close()
      }
      this.assertActive()
      this.files.set(file, 'ready')
      return ref
    } catch (error) {
      this.files.delete(file)
      await rm(file, { force: true })
      throw error
    }
  }

  decode(input: unknown): Promise<unknown> {
    return this.track(() => this.decodeValue(input))
  }

  private async decodeValue(input: unknown): Promise<unknown> {
    this.assertActive()
    const ref = CorePayloadSchema.parse(input)
    if ('inline' in ref) {
      const bytes = Buffer.from(ref.inline, 'base64')
      if (bytes.length > CORE_INLINE_BYTES || bytes.toString('base64') !== ref.inline)
        throw new Error('Invalid inline Core payload')
      return deserialize(bytes)
    }
    if (ref.sender === this.sender) throw new Error('Invalid Core payload direction')
    const file = this.file(ref)
    if ((await realpath(this.config.directory)) !== this.config.directory)
      throw new Error('Core carrier root changed')
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let consumed = false
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== ref.bytes + 28)
        throw new Error('Invalid Core carrier size')
      const bytes = Buffer.allocUnsafe(ref.bytes + 28)
      let offset = 0
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!read.bytesRead) throw new Error('Core carrier was truncated')
        offset += read.bytesRead
      }
      if ((await handle.read(Buffer.alloc(1), 0, 1, bytes.length)).bytesRead)
        throw new Error('Core carrier grew beyond its declared size')
      this.assertActive()
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
      decipher.setAAD(this.aad(ref))
      decipher.setAuthTag(bytes.subarray(12, 28))
      const plain = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])
      const value: unknown = deserialize(plain)
      consumed = true
      return value
    } finally {
      await handle.close()
      if (consumed) await rm(file, { force: true })
    }
  }

  async release(ref: CorePayload): Promise<void> {
    if ('inline' in ref) return
    const file = this.file(ref)
    if (ref.sender !== this.sender || !this.files.delete(file)) return
    await rm(file, { force: true })
  }

  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled(this.operations)
    this.key.fill(0)
    await Promise.all([...this.files.keys()].map((file) => rm(file, { force: true })))
    this.files.clear()
  }
}
