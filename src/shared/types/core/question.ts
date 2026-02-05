export type QuestionOption = {
  label: string
  description?: string
}

export type QuestionInfo = {
  header?: string
  question: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type QuestionResolution = 'asked' | 'replied' | 'rejected'

export type QuestionAnswer = {
  answerText: string
  answerMessageId?: string
}
