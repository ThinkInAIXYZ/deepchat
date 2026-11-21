import type { QuestionOption } from './types/agent-interface'

export interface DimQuestion {
  id: string
  header?: string
  question: string
  options: QuestionOption[]
  multiSelect: boolean
  allowCustom: boolean
}
export interface DimQuestionAnswer {
  questionId: string
  selected: string[]
  custom?: string
}

/** A view of ask_user arguments; the Rust owner validates the actual tool invocation/answers. */
export function dimQuestions(value: unknown): DimQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return []
  const result: DimQuestion[] = []
  for (const [index, item] of value.entries()) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.question !== 'string' ||
      !Array.isArray(item.options)
    )
      return []
    if (
      item.options.some(
        (option: unknown) =>
          !option ||
          typeof option !== 'object' ||
          !('label' in option) ||
          typeof option.label !== 'string'
      )
    )
      return []
    const id = typeof item.id === 'string' ? item.id : String(index + 1)
    if (!id || result.some((question) => question.id === id)) return []
    result.push({
      id,
      ...(typeof item.header === 'string' ? { header: item.header } : {}),
      question: item.question,
      options: item.options.map((option: QuestionOption) => ({
        label: option.label,
        ...(typeof option.description === 'string' ? { description: option.description } : {})
      })),
      multiSelect: item.multiSelect === true,
      allowCustom: item.allowCustom !== false
    })
  }
  return result
}
