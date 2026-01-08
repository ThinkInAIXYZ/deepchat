import { z } from 'zod'
import fs from 'fs/promises'
import type { ContextToolDefinition } from './types'

const TailArgsSchema = z.object({
  id: z.string().min(1),
  lines: z.number().int().min(1).max(2000).default(200)
})

async function readTail(filePath: string, lines: number): Promise<string> {
  const stats = await fs.stat(filePath)
  if (stats.size === 0) return ''

  const handle = await fs.open(filePath, 'r')
  const chunkSize = 64 * 1024
  let position = stats.size
  let buffer = ''

  try {
    while (position > 0) {
      const readSize = Math.min(chunkSize, position)
      position -= readSize
      const chunk = Buffer.alloc(readSize)
      await handle.read(chunk, 0, readSize, position)
      buffer = chunk.toString('utf-8') + buffer
      const segments = buffer.split('\n')
      if (segments.length > lines) {
        return segments.slice(-lines).join('\n')
      }
    }
  } finally {
    await handle.close()
  }

  return buffer
}

export function createTailTools(): ContextToolDefinition[] {
  return [
    {
      name: 'context_tail',
      description: 'Read the last N lines from a context file',
      schema: TailArgsSchema,
      handler: async (args, context) => {
        const { id, lines } = TailArgsSchema.parse(args ?? {})
        const { entry } = await context.getEntry(id)
        const filePath = await context.ensureMaterialized(entry)
        const content = await readTail(filePath, lines)
        const result = { id, lines, content }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }
    }
  ]
}
