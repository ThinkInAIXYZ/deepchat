import { z } from 'zod'
import { WORKFLOW_RUNTIME_DEFAULT_LIMITS } from './runtimeProtocol'

export const WORKFLOW_SAVED_DIRECTORY_SEGMENTS = ['.deepchat', 'workflows'] as const
export const WORKFLOW_SAVED_MAX_FILES = 200
export const WORKFLOW_SAVED_MAX_SOURCE_BYTES = WORKFLOW_RUNTIME_DEFAULT_LIMITS.maxScriptBytes
export const WORKFLOW_SAVED_MAX_ARGS_BYTES = 256 * 1024

const UTF8_ENCODER = new TextEncoder()
const fitsUtf8ByteLimit = (value: string, maxBytes: number): boolean =>
  UTF8_ENCODER.encode(value).byteLength <= maxBytes

export const WorkflowSavedNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    'Workflow names may contain only letters, numbers, underscores, and hyphens'
  )

export const WorkflowSavedSourceHashSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/)

export const WorkflowSavedSummarySchema = z
  .object({
    name: WorkflowSavedNameSchema,
    relativePath: z.string().min(1).max(256),
    byteLength: z.number().int().positive().max(WORKFLOW_SAVED_MAX_SOURCE_BYTES),
    updatedAt: z.number().int().nonnegative()
  })
  .strict()

export const WorkflowSavedDocumentSchema = WorkflowSavedSummarySchema.extend({
  absolutePath: z.string().min(1).max(4_096),
  sourceHash: WorkflowSavedSourceHashSchema,
  source: z
    .string()
    .min(1)
    .max(WORKFLOW_SAVED_MAX_SOURCE_BYTES)
    .refine(
      (value) => fitsUtf8ByteLimit(value, WORKFLOW_SAVED_MAX_SOURCE_BYTES),
      `Workflow source must not exceed ${WORKFLOW_SAVED_MAX_SOURCE_BYTES} UTF-8 bytes.`
    )
}).strict()

export const WorkflowSavedCatalogSchema = z
  .object({
    directoryPath: z.string().min(1).max(4_096).nullable(),
    workflows: z.array(WorkflowSavedSummarySchema).max(WORKFLOW_SAVED_MAX_FILES)
  })
  .strict()

export const WorkflowSavedArgsTextSchema = z
  .string()
  .max(WORKFLOW_SAVED_MAX_ARGS_BYTES)
  .refine(
    (value) => fitsUtf8ByteLimit(value, WORKFLOW_SAVED_MAX_ARGS_BYTES),
    `Workflow arguments must not exceed ${WORKFLOW_SAVED_MAX_ARGS_BYTES} UTF-8 bytes.`
  )

export type WorkflowSavedSummary = z.infer<typeof WorkflowSavedSummarySchema>
export type WorkflowSavedDocument = z.infer<typeof WorkflowSavedDocumentSchema>
export type WorkflowSavedCatalog = z.infer<typeof WorkflowSavedCatalogSchema>
