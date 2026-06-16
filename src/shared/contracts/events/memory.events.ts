import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'

/** 记忆数据发生变更的原因，供 UI 决定刷新范围/提示。 */
export const MemoryUpdateReasonSchema = z.enum([
  'extract',
  'delete',
  'clear',
  'persona-evolve',
  'persona-rollback'
])

/**
 * 记忆数据变更通知：写入/删除/清空/人格演化/回滚后广播，
 * renderer 据此刷新记忆管理 UI。payload 仅携带轻量元信息，不含记忆内容。
 */
export const memoryUpdatedEvent = defineEventContract({
  name: 'memory.updated',
  payload: z.object({
    agentId: z.string(),
    reason: MemoryUpdateReasonSchema,
    version: TimestampMsSchema
  })
})
