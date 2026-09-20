// TypeSafe "System One" (Jev) protocol vocabulary.
//
// Jev is not a chat model: it evaluates typed questions against a state and returns typed
// answers. The wire contract is a single endpoint, `POST {baseUrl}/v1/systemone`, with
// `{ state, model, questions }` in and `{ model, answers, usage }` out.

export type JevQuestionType = 'choice' | 'score' | 'noul'

export type JevChoiceQuestion = {
  type: 'choice'
  instructions: string
  criteria: Record<string, string | null>
}

export type JevScoreQuestion = {
  type: 'score'
  instructions: string
  criteria: string[]
}

export type JevNoulQuestion = {
  type: 'noul'
  instructions: string
  criteria?: Record<string, string>
}

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion

export type JevChoiceAnswer = {
  type: 'choice'
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export type JevScoreAnswer = {
  type: 'score'
  score: number
  confidence: number
  legend: Record<string, string>
  probabilities: Record<string, number>
}

/**
 * A Noul answer carries no `confidence`: the single value already describes the whole
 * two-outcome distribution, so a value near 0.5 means "yes and no are similarly likely"
 * rather than "moderate intensity".
 */
export type JevNoulAnswer = {
  type: 'noul'
  noul: number
}

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer

export type JevUsage = {
  input_tokens?: number
  output_tokens?: number
}

export type JevJudgmentResult = {
  /** The versioned model id that answered, e.g. `jev-1.13.0`, even when an alias was sent. */
  model: string
  answers: Record<string, JevAnswer>
  usage?: JevUsage
}

export type JevJudgmentRequest = {
  state: unknown
  questions: Record<string, JevQuestion>
  model: string
}

/**
 * Answer-type guards. Only the types a caller actually consumes get a guard: adding one for an
 * answer type that no code reads would read as support for it. `Score` remains part of the wire
 * vocabulary above because the API accepts it, but nothing here handles a score answer, and a
 * caller that asked a score question gets no composed result from it.
 */
export function isJevChoiceAnswer(answer: JevAnswer): answer is JevChoiceAnswer {
  return answer.type === 'choice'
}

export function isJevNoulAnswer(answer: JevAnswer): answer is JevNoulAnswer {
  return answer.type === 'noul'
}
