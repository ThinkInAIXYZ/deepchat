import { z } from 'zod'

const WorkflowSubagentIdSchema = z.string().trim().min(1).max(256)

export const WorkflowSubagentContextSchema = z
  .object({
    runId: WorkflowSubagentIdSchema,
    invocationId: WorkflowSubagentIdSchema,
    correlationSlot: WorkflowSubagentIdSchema,
    lineageSlot: WorkflowSubagentIdSchema.optional()
  })
  .strict()

export type WorkflowSubagentContext = z.infer<typeof WorkflowSubagentContextSchema>

export function parseWorkflowSubagentContext(value: unknown): WorkflowSubagentContext | undefined {
  const parsed = WorkflowSubagentContextSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
