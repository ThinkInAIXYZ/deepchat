import { z } from 'zod'
import type { ContextToolDefinition } from './types'

const ListArgsSchema = z.object({
  kind: z.enum(['artifact', 'history', 'catalog']).optional(),
  limit: z.number().int().min(1).max(500).default(50)
})

export function createListTools(): ContextToolDefinition[] {
  return [
    {
      name: 'context_list',
      description: 'List context files for the current conversation',
      schema: ListArgsSchema,
      handler: async (args, context) => {
        const { kind, limit } = ListArgsSchema.parse(args ?? {})
        const items = await context.store.listRefs(context.conversationId, kind, limit)
        return {
          content: [{ type: 'text', text: JSON.stringify({ items }, null, 2) }]
        }
      }
    }
  ]
}
