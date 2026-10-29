import { z } from 'zod'
import { YoBrowserStatusSchema } from '../contracts/domainSchemas'

const id = z.string().uuid()
const error = z.object({ name: z.string().max(256), message: z.string().max(8192) }).strict()
export const CoreBrowserCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('open'),
      id,
      toolName: z.enum(['get_browser_status', 'load_url', 'cdp_send']),
      args: z.record(z.string(), z.unknown()),
      conversationId: z.string().optional(),
      runId: z.string().optional(),
      authorize: z.boolean()
    })
    .strict(),
  z.object({ operation: z.literal('cancel'), id }).strict(),
  z.object({ operation: z.literal('close') }).strict()
])
export type CoreBrowserCommand = z.infer<typeof CoreBrowserCommandSchema>

const unavailable = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.literal('yobrowser_unavailable'),
        message: z.string(),
        recoverable: z.literal(true),
        sessionId: z.string(),
        method: z.string(),
        browserStatus: YoBrowserStatusSchema.nullable(),
        suggestedNextActions: z.array(z.string())
      })
      .strict()
  })
  .strict()

export const CoreBrowserOutcomeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.string() }).strict(),
  z.object({ ok: z.literal(false), error, unavailable: unavailable.optional() }).strict()
])
export type CoreBrowserOutcome = z.infer<typeof CoreBrowserOutcomeSchema>
export const CoreBrowserEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('browser.authorize'),
      id,
      args: z.record(z.string(), z.unknown())
    })
    .strict(),
  z.object({ type: z.literal('browser.completed'), id, outcome: CoreBrowserOutcomeSchema }).strict()
])
export type CoreBrowserEvent = z.infer<typeof CoreBrowserEventSchema>
export const CoreBrowserAuthorizationSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), error }).strict()
])
export type CoreBrowserAuthorization = z.infer<typeof CoreBrowserAuthorizationSchema>

export function isCoreBrowserDrain(input: unknown): boolean {
  const parsed = z.tuple([CoreBrowserCommandSchema]).safeParse(input)
  return parsed.success && parsed.data[0].operation !== 'open'
}

export function coreBrowserError(input: unknown): z.infer<typeof error> {
  return input instanceof Error
    ? { name: input.name.slice(0, 256), message: input.message.slice(0, 8192) }
    : { name: 'BrowserOperationError', message: 'Native browser operation failed' }
}
