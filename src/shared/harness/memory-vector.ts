import { z } from 'zod'
import { AGENT_MEMORY_AGENT_ID_PATTERN } from '../types/agent-memory'

export const MEMORY_VECTOR_FRAME_BYTES = 256 * 1024
export const MEMORY_VECTOR_FRAME_FLAG = 0x80000000
export const MEMORY_VECTOR_UPLOAD_BYTES = 16 * 1024 * 1024
export const MEMORY_VECTOR_CHUNK_BYTES = 64 * 1024
export const MEMORY_VECTOR_PENDING = 32

const identity = z.string().uuid()
const memoryId = z.string().min(1).max(1024)
const agentId = z.string().regex(AGENT_MEMORY_AGENT_ID_PATTERN)
const dimensions = z
  .number()
  .int()
  .positive()
  .max(MEMORY_VECTOR_UPLOAD_BYTES / 4)
const topK = z.number().int().min(1).max(800)
const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
const resource = { generation: identity, operation: identity, resource: identity }

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

export const MemoryVectorCommandSchema = z.discriminatedUnion('method', [
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
    .object({
      ...resource,
      method: z.literal('begin'),
      upload: identity,
      memoryIds: z.array(memoryId).min(1).max(50),
      bytes: z.number().int().positive().max(MEMORY_VECTOR_UPLOAD_BYTES),
      data: base64.max(Math.ceil(MEMORY_VECTOR_CHUNK_BYTES / 3) * 4).optional()
    })
    .strict(),
  z
    .object({
      ...resource,
      method: z.literal('chunk'),
      upload: identity,
      offset: z.number().int().nonnegative(),
      data: base64.max(Math.ceil(MEMORY_VECTOR_CHUNK_BYTES / 3) * 4)
    })
    .strict(),
  z
    .object({
      ...resource,
      method: z.literal('commit'),
      upload: identity,
      offset: z.number().int().nonnegative().optional(),
      data: base64.max(Math.ceil(MEMORY_VECTOR_CHUNK_BYTES / 3) * 4).optional()
    })
    .strict(),
  z.object({ ...resource, method: z.literal('abort'), upload: identity }).strict(),
  z
    .object({ generation: identity, operation: identity, method: z.literal('reset'), agentId })
    .strict(),
  z
    .object({ generation: identity, operation: identity, method: z.literal('quarantine'), agentId })
    .strict()
])

export type MemoryVectorConfig = z.infer<typeof MemoryVectorConfigSchema>
export type MemoryVectorCommand = z.infer<typeof MemoryVectorCommandSchema>
export const isMemoryVectorControl = (method: MemoryVectorCommand['method']) =>
  ['close', 'abort', 'reset', 'quarantine'].includes(method)

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
  const vector: number[] = []
  for (let index = 0; index < dimensions; index++) {
    const value = bytes.readFloatLE(index * 4)
    if (!Number.isFinite(value))
      throw new Error('Memory vector contains a non-finite Float32 value')
    const integer = value | 0
    // Keep integer-only vectors compact through the native binding's element conversion.
    if (value === integer && !Object.is(value, -0)) vector.push(integer)
    else vector.push(value)
  }
  return vector
}
