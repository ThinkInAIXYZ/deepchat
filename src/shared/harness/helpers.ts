import { z } from 'zod'
import { RUN_CODE_PROTOCOL_VERSION } from '../codeModeProtocol'

export const CORE_HELPER_QUEUE = 64
export const CORE_HELPER_QUEUE_BYTES = 64 * 1024 * 1024
export const CORE_HELPER_BATCH = 32

export const CoreHelperKindSchema = z.enum(['exec', 'code', 'scheduler', 'content', 'git'])
export type CoreHelperKind = z.infer<typeof CoreHelperKindSchema>
const id = z.string().uuid()

export const CoreHelperCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('open'), id, kind: CoreHelperKindSchema }).strict(),
  z.object({ operation: z.literal('send'), id, message: z.unknown() }).strict(),
  z
    .object({ operation: z.literal('terminate'), ids: z.array(id).min(1).max(CORE_HELPER_BATCH) })
    .strict(),
  z.object({ operation: z.literal('rss'), id }).strict(),
  z.object({ operation: z.literal('close') }).strict()
])
export type CoreHelperCommand = z.infer<typeof CoreHelperCommandSchema>

const helperEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('opened') }).strict(),
  z
    .object({
      type: z.literal('openFailed'),
      name: z.string().max(256),
      message: z.string().max(8192)
    })
    .strict(),
  z.object({ type: z.literal('message'), message: z.unknown() }).strict(),
  z.object({ type: z.literal('exit'), code: z.number().int() }).strict(),
  z
    .object({ type: z.literal('error'), kind: z.string().max(256), location: z.string().max(8192) })
    .strict()
])
export const CoreHelperEventSchema = z
  .object({
    id,
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    pid: z.number().int().positive().nullable(),
    event: helperEvent
  })
  .strict()
export type CoreHelperEvent = z.infer<typeof CoreHelperEventSchema>
export const CoreHelperEventsSchema = z.array(CoreHelperEventSchema).min(1).max(CORE_HELPER_BATCH)

export const CoreHelperAdmissionSchema = z.object({ accepted: z.literal(true) }).strict()

const rpc = z
  .object({
    type: z.literal('background-exec:request'),
    id: z.string().min(1),
    method: z.enum([
      'start',
      'list',
      'poll',
      'log',
      'waitForCompletionOrYield',
      'getCompletionResult',
      'write',
      'kill',
      'clear',
      'remove',
      'cleanupConversation',
      'shutdown'
    ]),
    args: z.array(z.unknown())
  })
  .strict()
const watcherRpc = rpc.extend({
  type: z.literal('file-watcher:request'),
  method: z.enum(['watch', 'unwatch', 'shutdown'])
})
const codeBase = z.object({ version: z.literal(RUN_CODE_PROTOCOL_VERSION), cellId: z.string() })
const code = z.discriminatedUnion('type', [
  codeBase
    .extend({
      type: z.literal('START'),
      frontend: z.enum(['codex', 'function']),
      source: z.string(),
      bindings: z.array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            execution: z.enum(['parallel', 'sequential'])
          })
          .strict()
      ),
      store: z.record(z.string(), z.unknown())
    })
    .strict(),
  codeBase
    .extend({
      type: z.literal('NESTED_RESULT'),
      callId: z.string(),
      ok: z.boolean(),
      result: z.unknown().optional(),
      error: z.string().optional()
    })
    .strict(),
  codeBase.extend({ type: z.literal('RESUME') }).strict(),
  codeBase.extend({ type: z.literal('STOP'), reason: z.string() }).strict()
])
const scheduler = z.discriminatedUnion('type', [
  z.object({ type: z.literal('START'), now: z.number().finite() }).strict(),
  z.object({ type: z.literal('RECONCILE'), now: z.number().finite(), reason: z.string() }).strict(),
  z
    .object({
      type: z.literal('SCAN_RESULT'),
      now: z.number().finite(),
      requestId: z.number().int().positive(),
      enabledJobCount: z.number().int().nonnegative(),
      nextRunAt: z.number().finite().nullable(),
      error: z.string().optional()
    })
    .strict(),
  z.object({ type: z.literal('STOP'), now: z.number().finite(), reason: z.string() }).strict()
])

export function parseCoreHelperMessage(kind: CoreHelperKind, value: unknown) {
  switch (kind) {
    case 'exec':
      return rpc.parse(value)
    case 'code':
      return code.parse(value)
    case 'scheduler':
      return scheduler.parse(value)
    case 'content':
    case 'git':
      return watcherRpc.parse(value)
  }
}

export function isCoreHelperDrain(input: unknown): boolean {
  const parsed = z.tuple([CoreHelperCommandSchema]).safeParse(input)
  if (!parsed.success) return false
  const [command] = parsed.data
  if (command.operation === 'close' || command.operation === 'terminate') return true
  if (command.operation !== 'send') return false
  const message = command.message as { type?: string; method?: string } | null
  return (
    message?.type === 'STOP' ||
    (message?.type === 'file-watcher:request' &&
      ['shutdown', 'unwatch'].includes(message.method ?? '')) ||
    (message?.type === 'background-exec:request' &&
      ['shutdown', 'kill', 'clear', 'remove', 'cleanupConversation'].includes(message.method ?? ''))
  )
}
