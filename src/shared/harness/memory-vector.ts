import { z } from 'zod'
import { AGENT_MEMORY_AGENT_ID_PATTERN } from '../types/agent-memory'

export const MEMORY_VECTOR_FRAME_BYTES = 256 * 1024
export const MEMORY_VECTOR_FRAME_FLAG = 0x80000000
export const MEMORY_VECTOR_BINARY_FLAG = 0x40000000
export const MEMORY_VECTOR_UPLOAD_BYTES = 16 * 1024 * 1024
export const MEMORY_VECTOR_CHUNK_BYTES = 64 * 1024
export const MEMORY_VECTOR_PENDING = 32
export const MEMORY_VECTOR_NATIVE_PART_BYTES = 8 * 1024 * 1024

const identity = z.string().uuid()
const memoryId = z.string().min(1).max(1024)
const agentId = z.string().regex(AGENT_MEMORY_AGENT_ID_PATTERN)
const dimensions = z
  .number()
  .int()
  .positive()
  .max(MEMORY_VECTOR_UPLOAD_BYTES / 4)
const topK = z.number().int().min(1).max(800)
const base64 = z
  .string()
  .refine(
    (value) =>
      value.length <= 240 * 1024 &&
      value.length % 4 === 0 &&
      Buffer.from(value, 'base64').toString('base64') === value,
    'Expected canonical base64'
  )
const resource = { generation: identity, operation: identity, resource: identity }
const chunk = z
  .custom<Uint8Array>((value) => value instanceof Uint8Array)
  .refine((value) => value.byteLength > 0 && value.byteLength <= MEMORY_VECTOR_CHUNK_BYTES)

export const MemoryVectorConfigSchema = z
  .object({
    generation: identity,
    memoryDbDir: z.string().min(1).max(32768),
    host: z
      .object({
        appPath: z.string().min(1).max(32768),
        userDataPath: z.string().min(1).max(32768),
        isPackaged: z.boolean()
      })
      .strict()
  })
  .strict()

const commands = [
  z
    .object({
      ...resource,
      method: z.literal('open'),
      agentId,
      dimensions,
      embedding: z
        .object({ providerId: z.string().min(1).max(1024), modelId: z.string().min(1).max(1024) })
        .strict()
    })
    .strict(),
  z
    .object({ ...resource, method: z.literal('close'), preserveLease: z.boolean().optional() })
    .strict(),
  z
    .object({ ...resource, method: z.literal('query'), vector: base64.max(240 * 1024), topK })
    .strict(),
  z.object({ ...resource, method: z.literal('queryByMemoryId'), memoryId, topK }).strict(),
  z
    .object({ ...resource, method: z.literal('delete'), memoryIds: z.array(memoryId).max(512) })
    .strict(),
  z
    .object({
      ...resource,
      method: z.literal('list'),
      afterId: memoryId.nullable(),
      limit: z.number().int().min(1).max(512)
    })
    .strict(),
  z
    .object({ generation: identity, operation: identity, method: z.literal('reset'), agentId })
    .strict(),
  z
    .object({ generation: identity, operation: identity, method: z.literal('quarantine'), agentId })
    .strict()
] as const

export const MemoryVectorCommandSchema = z.discriminatedUnion('method', [
  ...commands,
  z
    .object({
      ...resource,
      method: z.literal('begin'),
      upload: identity,
      memoryIds: z.array(memoryId).min(1).max(50),
      bytes: z.number().int().positive().max(MEMORY_VECTOR_UPLOAD_BYTES),
      data: chunk.optional()
    })
    .strict(),
  z
    .object({
      ...resource,
      method: z.literal('chunk'),
      upload: identity,
      offset: z.number().int().nonnegative(),
      data: chunk
    })
    .strict(),
  z
    .object({
      ...resource,
      method: z.literal('commit'),
      upload: identity,
      offset: z.number().int().nonnegative().optional(),
      data: chunk.optional()
    })
    .strict(),
  z.object({ ...resource, method: z.literal('abort'), upload: identity }).strict()
])

export const MemoryVectorNativeCommandSchema = z.discriminatedUnion('method', [
  ...commands,
  z.object({ ...resource, method: z.literal('abort'), upload: identity }).strict(),
  z
    .object({
      ...resource,
      method: z.literal('upsert'),
      upload: identity,
      bytes: z.number().int().positive().max(MEMORY_VECTOR_UPLOAD_BYTES),
      offset: z.number().int().nonnegative().max(MEMORY_VECTOR_UPLOAD_BYTES),
      memoryIds: z.array(memoryId).min(1).max(50),
      data: z
        .custom<Uint8Array>((value) => value instanceof Uint8Array)
        .refine(
          (value) => value.byteLength > 0 && value.byteLength <= MEMORY_VECTOR_NATIVE_PART_BYTES
        )
    })
    .strict()
])
export type MemoryVectorNativeCommand = z.infer<typeof MemoryVectorNativeCommandSchema>

export type MemoryVectorConfig = z.infer<typeof MemoryVectorConfigSchema>
export type MemoryVectorCommand = z.infer<typeof MemoryVectorCommandSchema>
export const isMemoryVectorControl = (
  method: MemoryVectorCommand['method'] | MemoryVectorNativeCommand['method']
) => ['close', 'abort', 'reset', 'quarantine'].includes(method)

export function encodeMemoryVector(values: readonly number[], dimensions: number): Buffer {
  if (values.length !== dimensions) throw new Error('Memory vector dimensions do not match')
  const bytes = Buffer.allocUnsafe(dimensions * 4)
  for (let index = 0; index < dimensions; index++) {
    const value = values[index]
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
      throw new Error('Memory vector contains a non-finite Float32 value')
    }
    bytes.writeFloatLE(value, index * 4)
  }
  return bytes
}

export function decodeMemoryVector(bytes: Buffer, dimensions: number): number[] {
  if (bytes.length !== dimensions * 4) throw new Error('Memory vector byte length does not match')
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const vector: number[] = []
  for (let index = 0; index < dimensions; index++) {
    const value = data.getFloat32(index * 4, true)
    if (!Number.isFinite(value))
      throw new Error('Memory vector contains a non-finite Float32 value')
    const integer = value | 0
    // Keep integer-only vectors compact through the native binding's element conversion.
    if (value === integer && !Object.is(value, -0)) vector.push(integer)
    else vector.push(value)
  }
  return vector
}
