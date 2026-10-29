import { z } from 'zod'

export const CORE_INLINE_BYTES = 16 * 1024
export const CORE_VALUE_BYTES = 64 * 1024 * 1024
export const CORE_CARRIER_FILES = 4
export const CORE_CALLS = 4
export const CORE_CONTROL_CALLS = 2
export const CORE_NATIVE_CALLS = 16

export const CoreNativeMethodSchema = z.enum([
  'crypto.available',
  'crypto.encrypt',
  'crypto.decrypt',
  'crypto.backend',
  'profile.logging',
  'profile.progress',
  'profile.unlock',
  'profile.recovery',
  'profile.quit',
  'configuration'
])
export type CoreNativeMethod = z.infer<typeof CoreNativeMethodSchema>

export const CoreCarrierConfigSchema = z
  .object({
    generation: z.string().uuid(),
    directory: z.string().min(1).max(8192),
    key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
  })
  .strict()
export type CoreCarrierConfig = z.infer<typeof CoreCarrierConfigSchema>

export const CorePayloadSchema = z.union([
  z.object({ inline: z.string().max(4 * Math.ceil(CORE_INLINE_BYTES / 3)) }).strict(),
  z
    .object({
      operation: z.string().uuid(),
      sender: z.enum(['main', 'core']),
      bytes: z
        .number()
        .int()
        .min(CORE_INLINE_BYTES + 1)
        .max(CORE_VALUE_BYTES)
    })
    .strict()
])
export type CorePayload = z.infer<typeof CorePayloadSchema>

export const CoreMethodSchema = z.enum([
  'openProfile',
  'configure',
  'observeSystemTheme',
  'status',
  'stop'
])
export type CoreMethod = z.infer<typeof CoreMethodSchema>

export const CoreStatusSchema = z
  .object({
    generation: z.string().uuid(),
    pid: z.number().int().positive(),
    node: z.string().max(64),
    modules: z.string().max(32),
    phase: z.enum(['idle', 'opening', 'profile-open', 'stopping', 'stopped']),
    businessReady: z.literal(false)
  })
  .strict()
export type CoreStatus = z.infer<typeof CoreStatusSchema>

const error = z.object({ name: z.string().max(256), message: z.string().max(8192) }).strict()
export const CoreFrameSchema = z.union([
  z.object({ type: z.literal('coreReady'), runtime: CoreStatusSchema }).strict(),
  z.object({ type: z.literal('coreStopped'), message: z.string().max(8192) }).strict(),
  z
    .object({
      type: z.literal('coreReply'),
      id: z.number().int().positive(),
      value: CorePayloadSchema
    })
    .strict(),
  z.object({ type: z.literal('coreReply'), id: z.number().int().positive(), error }).strict(),
  z
    .object({
      type: z.literal('coreNativeCall'),
      id: z.number().int().positive(),
      generation: z.string().uuid(),
      method: CoreNativeMethodSchema,
      args: CorePayloadSchema
    })
    .strict()
])
export type CoreFrame = z.infer<typeof CoreFrameSchema>

export type CoreRequest =
  | { type: 'coreStart'; config: CoreCarrierConfig }
  | { type: 'coreCall'; id: number; method: CoreMethod; args: CorePayload }
  | { type: 'coreNativeReply'; id: number; generation: string; value: CorePayload }
  | {
      type: 'coreNativeReply'
      id: number
      generation: string
      error: { name: string; message: string }
    }
