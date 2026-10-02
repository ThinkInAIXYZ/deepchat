import { z } from 'zod'

export const SESSION_REFERENCE_DRAG_TYPE = 'application/x-deepchat-session'

export const SessionReferenceSchema = z.object({
  sessionId: z.string().min(1).max(256),
  title: z.string().max(1024),
  projectDir: z.string().max(4096).nullable(),
  tapeIncarnationId: z.string().min(1).max(256)
})

export type SessionReference = z.infer<typeof SessionReferenceSchema>

/** Plain-text provenance for search/copy/export; never expands source content. */
export function getSessionReferenceText(inlineItems: unknown): string {
  if (!Array.isArray(inlineItems)) return ''
  return inlineItems
    .flatMap((item) => {
      if (item?.type !== 'session') return []
      const reference = SessionReferenceSchema.safeParse(item)
      return reference.success
        ? [`[Session: ${reference.data.title} (${reference.data.sessionId})]`]
        : []
    })
    .join('\n')
}

export const SessionReferenceCandidateSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  projectDir: z.string().nullable(),
  agentId: z.string(),
  updatedAt: z.number()
})

export const ReadSessionInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    action: z
      .enum(['messages', 'search', 'message', 'context'])
      .describe(
        'messages: chronological previews; search: scoped previews matching query; message: raw detail; context: neighboring previews.'
      ),
    query: z.string().trim().min(1).max(500).optional().describe('Required only for search.'),
    role: z
      .enum(['user', 'assistant'])
      .optional()
      .describe('Filter before pagination or expansion.'),
    cursor: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe(
        'messages/search only. Use nextCursor unchanged with the same session, action, query and role.'
      ),
    messageId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe('Required for message/context; use a returned messageId, not a Tape entry ID.'),
    offset: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional()
      .describe(
        'message only: Unicode code-point offset, initially 0. Continue with message.nextOffset while hasMore.'
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe(
        'messages/search only: maximum items, default 20. Each preview is at most 800 code points; use message for detail.'
      ),
    before: z
      .number()
      .int()
      .min(0)
      .max(5)
      .optional()
      .describe('context only: earlier matching messages, default 3.'),
    after: z
      .number()
      .int()
      .min(0)
      .max(5)
      .optional()
      .describe('context only: later matching messages, default 3.')
  })
  .strict()

export type ReadSessionInput = z.infer<typeof ReadSessionInputSchema>
