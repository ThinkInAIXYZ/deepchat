import { z } from 'zod'
import { jsonrepair } from 'jsonrepair'
import type { QuestionInfo } from '@shared/types/core/question'

export const QUESTION_TOOL_NAME = 'deepchat_question'
export const QUESTION_TOOL_CONTRACT_HINT =
  'Use a single object with fields `header?`, `question`, `options`, `multiple?`, and `custom?`. Each `options` item must use `label` and optional `description`; `header` is only for the top-level question. Ask exactly one question per tool call. Use `custom`, not `allowOther`, and pass `options` as an array of option objects, not a stringified JSON array.'

const questionOptionSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .describe(
      'Required short option label shown to the user. Use `label`, not `header`, inside each option.'
    ),
  description: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('Optional short explanation of what choosing this option means.')
})

export const questionToolSchema = z
  .strictObject({
    header: z
      .string()
      .trim()
      .max(30)
      .optional()
      .describe(
        'Optional short title for this single question. Use `header` only here; option objects use `label`.'
      ),
    question: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        'The exact single question to show the user. Ask only when missing user input would materially change the result.'
      ),
    options: z
      .array(questionOptionSchema)
      .min(1)
      .max(10)
      .describe(
        'Array of `{ label: string, description?: string }` objects for this one question. Never use `header` inside an option. Do not pass a stringified JSON array. Usually 2-5 options is best.'
      ),
    multiple: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Set true only when the user should be allowed to select more than one listed option.'
      ),
    custom: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'Whether free-form input is allowed for this question. The field name is `custom`, not `allowOther`.'
      )
  })
  .describe(
    'Ask exactly one blocking clarification question. For multiple clarifications, use multiple deepchat_question tool calls instead of sending a `questions` array.'
  )

export type QuestionToolInput = z.infer<typeof questionToolSchema>

type QuestionToolParseResult =
  | { success: true; data: QuestionInfo }
  | { success: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeQuestionOptionAliases = (input: unknown): unknown => {
  if (!isRecord(input) || !Array.isArray(input.options)) {
    return input
  }

  let changed = false
  const options = input.options.map((option) => {
    if (!isRecord(option) || Object.hasOwn(option, 'label') || typeof option.header !== 'string') {
      return option
    }

    const { header, ...rest } = option
    changed = true
    return { ...rest, label: header }
  })

  return changed ? { ...input, options } : input
}

const normalizeQuestionInfo = (input: QuestionToolInput): QuestionInfo => {
  const header = input.header?.trim()
  const question = input.question.trim()
  const options = input.options.map((option) => {
    const description = option.description?.trim()
    return {
      label: option.label.trim(),
      ...(description ? { description } : {})
    }
  })

  return {
    ...(header ? { header } : {}),
    question,
    options,
    multiple: Boolean(input.multiple),
    custom: input.custom !== false
  }
}

export const parseQuestionToolInput = (input: unknown): QuestionToolParseResult => {
  const result = questionToolSchema.safeParse(normalizeQuestionOptionAliases(input))
  if (!result.success) {
    return {
      success: false,
      error: `Invalid arguments for ${QUESTION_TOOL_NAME}. ${QUESTION_TOOL_CONTRACT_HINT} Validation details: ${result.error.message}`
    }
  }

  return { success: true, data: normalizeQuestionInfo(result.data) }
}

export const parseQuestionToolArgs = (rawArgs: string): QuestionToolParseResult => {
  let parsed: unknown = {}
  if (rawArgs && rawArgs.trim()) {
    try {
      parsed = JSON.parse(rawArgs) as Record<string, unknown>
    } catch {
      try {
        parsed = JSON.parse(jsonrepair(rawArgs)) as Record<string, unknown>
      } catch {
        return {
          success: false,
          error: `Invalid JSON for question tool arguments. ${QUESTION_TOOL_CONTRACT_HINT}`
        }
      }
    }
  }

  return parseQuestionToolInput(parsed)
}
