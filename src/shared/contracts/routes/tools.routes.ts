import { z } from 'zod'
import type { MCPToolDefinition } from '@shared/types/mcp'
import { defineRouteContract } from '../common'
import { JsonValueSchema } from '../json'

export const PROGRAMMATIC_TOOL_SEARCH_MAX_RESULTS = 32
export const PROGRAMMATIC_TOOL_BATCH_MAX_STEPS = 64
export const PROGRAMMATIC_TOOL_RPC_ENVELOPE_OVERHEAD_BYTES = 64 * 1024
export const PROGRAMMATIC_TOOL_RPC_MAX_BODY_BYTES =
  4 * 1024 * 1024 + PROGRAMMATIC_TOOL_RPC_ENVELOPE_OVERHEAD_BYTES
export const PROGRAMMATIC_TOOL_RPC_TIMEOUT_MS = 30 * 60_000

export const PROGRAMMATIC_TOOL_NAME_MAX_CHARACTERS = 512
export const PROGRAMMATIC_TOOL_QUERY_MAX_CHARACTERS = 4_096
export const PROGRAMMATIC_TOOL_DESCRIPTION_MAX_CHARACTERS = 2_048
export const PROGRAMMATIC_TOOL_SIGNATURE_MAX_CHARACTERS = 16 * 1024
export const PROGRAMMATIC_TOOL_EXAMPLE_MAX_CHARACTERS = 32 * 1024
const PROGRAMMATIC_TOOL_ERROR_MAX_CHARACTERS = 4_096
const PROGRAMMATIC_TOOL_BINDINGS_PER_STEP = 64
const PROGRAMMATIC_TOOL_POINTER_MAX_BYTES = 4_096
const PROGRAMMATIC_TOOL_POINTER_MAX_SEGMENTS = 64
const PROGRAMMATIC_TOOL_FROM_PATTERN = /^\$steps\/(0|[1-9][0-9]*)\/result(.*)$/s
const RFC_6901_SEGMENT_PATTERN = /^(?:[^~/]|~[01])*$/
const PROGRAMMATIC_TOOL_CONTROL_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}]/u
const UTF8_ENCODER = new TextEncoder()

function isBoundedJsonPointer(value: string): boolean {
  if (
    !value.startsWith('/') ||
    UTF8_ENCODER.encode(value).byteLength > PROGRAMMATIC_TOOL_POINTER_MAX_BYTES
  ) {
    return false
  }
  const segments = value.slice(1).split('/')
  return (
    segments.length <= PROGRAMMATIC_TOOL_POINTER_MAX_SEGMENTS &&
    segments.every((segment) => RFC_6901_SEGMENT_PATTERN.test(segment))
  )
}

export function decodeProgrammaticToolJsonPointer(value: string): string[] {
  return value
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

export function parseProgrammaticToolBindingSource(
  value: string
): Readonly<{ stepIndex: number; resultPointer: string }> | null {
  const match = PROGRAMMATIC_TOOL_FROM_PATTERN.exec(value)
  if (!match) return null
  const stepIndex = Number(match[1])
  if (!Number.isSafeInteger(stepIndex)) return null
  return Object.freeze({ stepIndex, resultPointer: match[2] })
}

function jsonPointerTargetsExistingValue(value: unknown, pointer: string): boolean {
  let current = value
  for (const segment of decodeProgrammaticToolJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) return false
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index >= current.length) return false
      current = current[index]
      continue
    }
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) return false
    current = (current as Record<string, unknown>)[segment]
  }
  return true
}

function jsonPointerPathsOverlap(left: string, right: string): boolean {
  const leftSegments = decodeProgrammaticToolJsonPointer(left)
  const rightSegments = decodeProgrammaticToolJsonPointer(right)
  const sharedLength = Math.min(leftSegments.length, rightSegments.length)
  return leftSegments.slice(0, sharedLength).every((segment, index) => {
    return segment === rightSegments[index]
  })
}

export const ProgrammaticToolInvocationNameSchema = z
  .string()
  .min(1)
  .max(PROGRAMMATIC_TOOL_NAME_MAX_CHARACTERS)
  .refine((value) => value === value.trim() && !PROGRAMMATIC_TOOL_CONTROL_PATTERN.test(value), {
    message: 'Programmatic Tool name must be canonical'
  })

export const ProgrammaticToolPropertyNameSchema = z
  .string()
  .max(PROGRAMMATIC_TOOL_NAME_MAX_CHARACTERS)
  .refine((value) => !PROGRAMMATIC_TOOL_CONTROL_PATTERN.test(value), {
    message: 'Programmatic Tool property name must not contain control characters'
  })

const ProgrammaticToolJsonObjectSchema = z.record(
  ProgrammaticToolPropertyNameSchema,
  JsonValueSchema
)

const ProgrammaticToolSummarySchema = z
  .object({
    name: ProgrammaticToolInvocationNameSchema,
    source: z.enum(['mcp', 'plugin']),
    effect: z.enum(['read', 'write']),
    description: z.string().max(PROGRAMMATIC_TOOL_DESCRIPTION_MAX_CHARACTERS),
    inputSignature: z.string().max(PROGRAMMATIC_TOOL_SIGNATURE_MAX_CHARACTERS),
    callExample: z.string().max(PROGRAMMATIC_TOOL_EXAMPLE_MAX_CHARACTERS)
  })
  .strict()

const ProgrammaticToolErrorSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z][a-z0-9_-]*$/),
    message: z.string().min(1).max(PROGRAMMATIC_TOOL_ERROR_MAX_CHARACTERS),
    retriable: z.boolean()
  })
  .strict()

export const ProgrammaticToolStepResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      childOrdinal: z
        .number()
        .int()
        .nonnegative()
        .max(PROGRAMMATIC_TOOL_BATCH_MAX_STEPS - 1),
      status: z.literal('success'),
      result: JsonValueSchema
    })
    .strict(),
  z
    .object({
      childOrdinal: z
        .number()
        .int()
        .nonnegative()
        .max(PROGRAMMATIC_TOOL_BATCH_MAX_STEPS - 1),
      status: z.literal('error'),
      error: ProgrammaticToolErrorSchema
    })
    .strict(),
  z
    .object({
      childOrdinal: z
        .number()
        .int()
        .nonnegative()
        .max(PROGRAMMATIC_TOOL_BATCH_MAX_STEPS - 1),
      status: z.literal('not_started')
    })
    .strict()
])

const ProgrammaticToolBindingSchema = z
  .object({
    to: z.string().min(1).max(PROGRAMMATIC_TOOL_POINTER_MAX_BYTES).refine(isBoundedJsonPointer, {
      message: 'Programmatic Tool binding destination must be a bounded RFC 6901 pointer'
    }),
    from: z
      .string()
      .min(1)
      .max(PROGRAMMATIC_TOOL_POINTER_MAX_BYTES)
      .refine(
        (value) => {
          if (UTF8_ENCODER.encode(value).byteLength > PROGRAMMATIC_TOOL_POINTER_MAX_BYTES) {
            return false
          }
          const source = parseProgrammaticToolBindingSource(value)
          return Boolean(
            source && (source.resultPointer === '' || isBoundedJsonPointer(source.resultPointer))
          )
        },
        { message: 'Programmatic Tool binding source must be a bounded prior-result pointer' }
      )
  })
  .strict()

const ProgrammaticToolBatchStepSchema = z
  .object({
    target: ProgrammaticToolInvocationNameSchema,
    arguments: ProgrammaticToolJsonObjectSchema,
    bindings: z
      .array(ProgrammaticToolBindingSchema)
      .max(PROGRAMMATIC_TOOL_BINDINGS_PER_STEP)
      .optional()
  })
  .strict()

const MCPToolDefinitionSchema = z.custom<MCPToolDefinition>()

export const toolsListDefinitionsRoute = defineRouteContract({
  name: 'tools.listDefinitions',
  input: z.object({
    enabledMcpTools: z.array(z.string()).optional(),
    disabledAgentTools: z.array(z.string()).optional(),
    chatMode: z.enum(['agent', 'acp agent']).optional(),
    supportsVision: z.boolean().optional(),
    agentWorkspacePath: z.string().nullable().optional(),
    conversationId: z.string().optional()
  }),
  output: z.object({
    tools: z.array(MCPToolDefinitionSchema)
  })
})

export const toolSearchRoute = defineRouteContract({
  name: 'tool.search',
  input: z
    .object({
      query: z
        .string()
        .min(1)
        .max(PROGRAMMATIC_TOOL_QUERY_MAX_CHARACTERS)
        .refine((value) => value === value.trim() && !value.includes('\0'), {
          message: 'Programmatic Tool search query must be canonical'
        }),
      limit: z.number().int().positive().max(PROGRAMMATIC_TOOL_SEARCH_MAX_RESULTS).optional()
    })
    .strict(),
  output: z
    .object({
      tools: z.array(ProgrammaticToolSummarySchema).max(PROGRAMMATIC_TOOL_SEARCH_MAX_RESULTS),
      truncated: z.boolean()
    })
    .strict()
})

export const toolDescribeRoute = defineRouteContract({
  name: 'tool.describe',
  input: z.object({ target: ProgrammaticToolInvocationNameSchema }).strict(),
  output: z
    .object({
      tool: ProgrammaticToolSummarySchema.extend({
        inputSchema: ProgrammaticToolJsonObjectSchema
      }).strict()
    })
    .strict()
})

export const toolCallRoute = defineRouteContract({
  name: 'tool.call',
  input: z
    .object({
      target: ProgrammaticToolInvocationNameSchema,
      arguments: ProgrammaticToolJsonObjectSchema
    })
    .strict(),
  output: z
    .object({ step: ProgrammaticToolStepResultSchema })
    .strict()
    .superRefine((result, context) => {
      if (result.step.childOrdinal !== 0) {
        context.addIssue({
          code: 'custom',
          message: 'Programmatic Tool call result must use child ordinal zero',
          path: ['step', 'childOrdinal']
        })
      }
      if (result.step.status === 'not_started') {
        context.addIssue({
          code: 'custom',
          message: 'Programmatic Tool call must report its single attempted step',
          path: ['step', 'status']
        })
      }
    })
})

export const toolBatchRoute = defineRouteContract({
  name: 'tool.batch',
  input: z
    .object({
      steps: z.array(ProgrammaticToolBatchStepSchema).min(1).max(PROGRAMMATIC_TOOL_BATCH_MAX_STEPS)
    })
    .strict()
    .superRefine((batch, context) => {
      batch.steps.forEach((step, stepIndex) => {
        step.bindings?.forEach((binding, bindingIndex) => {
          if (!jsonPointerTargetsExistingValue(step.arguments, binding.to)) {
            context.addIssue({
              code: 'custom',
              message: 'Programmatic Tool binding destination must already exist',
              path: ['steps', stepIndex, 'bindings', bindingIndex, 'to']
            })
          }
          const conflictingBindingIndex = step.bindings?.findIndex(
            (other, otherIndex) =>
              otherIndex < bindingIndex && jsonPointerPathsOverlap(other.to, binding.to)
          )
          if (conflictingBindingIndex !== undefined && conflictingBindingIndex >= 0) {
            context.addIssue({
              code: 'custom',
              message: 'Programmatic Tool binding destinations must not overlap',
              path: ['steps', stepIndex, 'bindings', bindingIndex, 'to']
            })
          }
          const source = parseProgrammaticToolBindingSource(binding.from)
          if (!source || source.stepIndex >= stepIndex) {
            context.addIssue({
              code: 'custom',
              message: 'Programmatic Tool bindings may reference only prior completed steps',
              path: ['steps', stepIndex, 'bindings', bindingIndex, 'from']
            })
          }
        })
      })
    }),
  output: z
    .object({
      steps: z.array(ProgrammaticToolStepResultSchema).min(1).max(PROGRAMMATIC_TOOL_BATCH_MAX_STEPS)
    })
    .strict()
    .superRefine((result, context) => {
      let stopped = false
      result.steps.forEach((step, index) => {
        if (step.childOrdinal !== index) {
          context.addIssue({
            code: 'custom',
            message: 'Programmatic Tool batch results must use contiguous plan-order ordinals',
            path: ['steps', index, 'childOrdinal']
          })
        }
        if (!stopped && step.status === 'not_started') {
          context.addIssue({
            code: 'custom',
            message: 'Programmatic Tool batch cannot stop without a failing step',
            path: ['steps', index, 'status']
          })
        }
        if (stopped && step.status !== 'not_started') {
          context.addIssue({
            code: 'custom',
            message: 'Programmatic Tool batch results must remain stopped after failure',
            path: ['steps', index, 'status']
          })
        }
        if (step.status !== 'success') stopped = true
      })
    })
})
