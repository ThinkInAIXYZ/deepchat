import { z } from 'zod'

export const WORKFLOW_SOURCE_OUTLINE_SCHEMA_VERSION = 1 as const
export const WORKFLOW_SOURCE_OUTLINE_MAX_NODES = 256

export const WorkflowSourceOutlineNodeKindSchema = z.enum([
  'phase',
  'agent',
  'parallel',
  'pipeline',
  'map_limit'
])

export const WorkflowSourceOutlineNodeSchema = z
  .object({
    id: z.string().min(1).max(64),
    ordinal: z.number().int().positive().max(WORKFLOW_SOURCE_OUTLINE_MAX_NODES),
    kind: WorkflowSourceOutlineNodeKindSchema,
    key: z.string().min(1).max(256).nullable(),
    label: z.string().min(1).max(512).nullable(),
    itemCount: z.number().int().nonnegative().max(1_000_000).nullable(),
    stageCount: z.number().int().nonnegative().max(1_000_000).nullable(),
    concurrency: z.number().int().positive().max(1_000_000).nullable(),
    dynamic: z.boolean()
  })
  .strict()

export const WorkflowSourceOutlineSchema = z
  .object({
    schemaVersion: z.literal(WORKFLOW_SOURCE_OUTLINE_SCHEMA_VERSION),
    confidence: z.enum(['exact', 'partial']),
    truncated: z.boolean(),
    nodes: z.array(WorkflowSourceOutlineNodeSchema).max(WORKFLOW_SOURCE_OUTLINE_MAX_NODES)
  })
  .strict()

export type WorkflowSourceOutlineNodeKind = z.infer<typeof WorkflowSourceOutlineNodeKindSchema>
export type WorkflowSourceOutlineNode = z.infer<typeof WorkflowSourceOutlineNodeSchema>
export type WorkflowSourceOutline = z.infer<typeof WorkflowSourceOutlineSchema>
