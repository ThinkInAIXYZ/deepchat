import { z } from 'zod'
import fs from 'fs/promises'
import type { ContextToolDefinition } from './types'

const ReadArgsSchema = z.object({
  id: z.string().min(1),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(65536).default(8192)
})

async function readChunk(
  filePath: string,
  offset: number,
  limit: number
): Promise<{ content: string; done: boolean }> {
  const stats = await fs.stat(filePath)
  if (offset >= stats.size) {
    return { content: '', done: true }
  }

  const bytesToRead = Math.min(limit, stats.size - offset)
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset)
    const content = buffer.subarray(0, bytesRead).toString('utf-8')
    const done = offset + bytesRead >= stats.size
    return { content, done }
  } finally {
    await handle.close()
  }
}

export function createReadTools(): ContextToolDefinition[] {
  return [
    {
      name: 'context_read',
      description: 'Read a context file by byte offset and limit',
      schema: ReadArgsSchema,
      handler: async (args, context) => {
        const { id, offset, limit } = ReadArgsSchema.parse(args ?? {})
        const { entry } = await context.getEntry(id)
        const filePath = await context.ensureMaterialized(entry)
        const { content, done } = await readChunk(filePath, offset, limit)
        const result = { id, offset, limit, done, content }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }
    }
  ]
}
