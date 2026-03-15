import { z } from 'zod'
import { jsonrepair } from 'jsonrepair'
import type { QuestionInfo } from '@shared/types/core/question'

export const QUESTION_TOOL_NAME = 'deepchat_question'

const questionOptionSchema = z.object({
  label: z.string().trim().min(1).max(30),
  description: z.string().trim().max(200).optional()
})

export const questionToolSchema = z.object({
  header: z.string().trim().max(30).optional(),
  question: z.string().trim().min(1).max(500),
  options: z.array(questionOptionSchema).min(1).max(10),
  multiple: z.boolean().optional().default(false),
  custom: z.boolean().optional().default(true)
})

export type QuestionToolInput = z.infer<typeof questionToolSchema>

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

export const parseQuestionToolArgs = (
  rawArgs: string
): { success: true; data: QuestionInfo } | { success: false; error: string } => {
  let parsed: unknown = {}
  if (rawArgs && rawArgs.trim()) {
    try {
      parsed = JSON.parse(rawArgs) as Record<string, unknown>
    } catch {
      try {
        parsed = JSON.parse(jsonrepair(rawArgs)) as Record<string, unknown>
      } catch {
        return { success: false, error: 'Invalid JSON for question tool arguments.' }
      }
    }
  }

  const result = questionToolSchema.safeParse(parsed)
  if (!result.success) {
    return { success: false, error: result.error.message }
  }

  return { success: true, data: normalizeQuestionInfo(result.data) }
}
