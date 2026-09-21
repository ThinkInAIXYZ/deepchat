import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { JevAnswer } from '@shared/jevProtocol'
import {
  applyJevPruningDecisions,
  buildJevPruningQuestions,
  collectJevPruningCandidates,
  decideJevPruningDrop,
  fitJevPruningState,
  JEV_PRUNING_MAX_CANDIDATES,
  JEV_PRUNING_MAX_STATE_TOKENS,
  JEV_TOOL_RESULT_PRUNED_MARKER,
  pruneClosedToolResultsForContext,
  readJevPruningSignals
} from '@/agent/deepchat/runtime/jevToolResultPruning'

const user = (content: string): ChatMessage => ({ role: 'user', content }) as ChatMessage

const assistantCall = (ids: string[]): ChatMessage =>
  ({
    role: 'assistant',
    content: '',
    tool_calls: ids.map((id) => ({ id, function: { name: 'exec', arguments: '{}' } }))
  }) as unknown as ChatMessage

const toolResult = (id: string, content: string): ChatMessage =>
  ({ role: 'tool', tool_call_id: id, content }) as unknown as ChatMessage

const noul = (value: number): JevAnswer => ({ type: 'noul', noul: value })

describe('collectJevPruningCandidates', () => {
  it('collects completed tool exchanges inside the active turn', () => {
    const messages = [
      user('the task'),
      assistantCall(['c1']),
      toolResult('c1', 'first output'),
      assistantCall(['c2']),
      toolResult('c2', 'second output')
    ]

    const candidates = collectJevPruningCandidates(messages, new Set())

    expect(candidates.map((candidate) => candidate.toolCallId)).toEqual(['c1', 'c2'])
  })

  it('leaves everything before the last user message alone', () => {
    // The scope boundary is the last user message, matching compactClosedToolResultsForContext:
    // earlier turns are handled by the compaction service, not here. Getting this backwards would
    // mean asking Jev about history this pass is not responsible for.
    const messages = [
      user('earlier turn'),
      assistantCall(['old']),
      toolResult('old', 'from a previous turn'),
      user('the current task')
    ]

    expect(collectJevPruningCandidates(messages, new Set())).toEqual([])
  })

  it('skips a unit whose results do not fully pair with its calls', () => {
    const messages = [
      user('the task'),
      assistantCall(['c1', 'c2']),
      toolResult('c1', 'only one of two results')
    ]

    expect(collectJevPruningCandidates(messages, new Set())).toEqual([])
  })

  it('skips protected, replayed and already pruned results', () => {
    const pruned = `${JEV_TOOL_RESULT_PRUNED_MARKER}\nTool call ID: c3`
    const messages = [
      user('the task'),
      assistantCall(['c1', 'c2', 'c3']),
      toolResult('c1', 'protected'),
      { ...toolResult('c2', 'replayed'), provider_replay: true } as unknown as ChatMessage,
      toolResult('c3', pruned)
    ]

    expect(collectJevPruningCandidates(messages, new Set(['c1']))).toEqual([])
  })

  it('caps the candidate list, oldest first', () => {
    const ids = Array.from({ length: JEV_PRUNING_MAX_CANDIDATES + 5 }, (_, i) => `c${i}`)
    const messages = [
      user('the task'),
      ...ids.flatMap((id) => [assistantCall([id]), toolResult(id, `output ${id}`)])
    ]

    const candidates = collectJevPruningCandidates(messages, new Set())

    expect(candidates).toHaveLength(JEV_PRUNING_MAX_CANDIDATES)
    expect(candidates[0].toolCallId).toBe('c0')
  })

  it('returns nothing when there is no active turn', () => {
    expect(
      collectJevPruningCandidates([assistantCall(['c1']), toolResult('c1', 'x')], new Set())
    ).toEqual([])
  })
})

describe('buildJevPruningQuestions', () => {
  it('asks two nouls per candidate, keyed by tool call id', () => {
    // Two, not one: TypeSafe's guidance is that a question with two conditions makes both answers
    // mean less. Relevance and recoverability are separate questions, combined in code.
    const questions = buildJevPruningQuestions([
      { toolCallId: 'c1', toolName: 'exec', toolArgs: 'a', content: 'a', resultIndex: 1 },
      { toolCallId: 'c2', toolName: 'read', toolArgs: 'b', content: 'b', resultIndex: 3 }
    ])

    expect(Object.keys(questions).sort()).toEqual([
      'recoverable_c1',
      'recoverable_c2',
      'relevant_c1',
      'relevant_c2'
    ])
    expect(questions.relevant_c1.type).toBe('noul')
    expect(questions.recoverable_c1.type).toBe('noul')
  })

  it('names the candidate it is asking about', () => {
    // The question this replaced pointed at a field that did not exist and never said which candidate
    // it meant, leaving the model to guess among all of them.
    const questions = buildJevPruningQuestions([
      { toolCallId: 'call_abc', toolName: 'exec', toolArgs: 'a', content: 'a', resultIndex: 1 }
    ])

    const relevant = questions.relevant_call_abc as { instructions: string }
    expect(relevant.instructions).toContain('call_abc')
  })
})

describe('readJevPruningSignals', () => {
  const candidates = [
    { toolCallId: 'c1', toolName: 'exec', toolArgs: 'a', content: 'a', resultIndex: 1 },
    { toolCallId: 'c2', toolName: 'exec', toolArgs: 'b', content: 'b', resultIndex: 3 }
  ]

  it('reads both answers per candidate', () => {
    const signals = readJevPruningSignals(
      { relevant_c1: noul(0.8), recoverable_c1: noul(0.3) },
      candidates
    )

    expect(signals.get('c1')).toEqual({ relevance: 0.8, recoverable: 0.3 })
  })

  it('reports null for a missing or wrong-typed answer', () => {
    const signals = readJevPruningSignals(
      { relevant_c1: { type: 'choice', choice: 'x', confidence: 1, probabilities: {} } },
      candidates
    )

    expect(signals.get('c1')).toEqual({ relevance: null, recoverable: null })
    expect(signals.get('c2')).toEqual({ relevance: null, recoverable: null })
  })
})

describe('decideJevPruningDrop', () => {
  it('keeps a result the work still depends on', () => {
    expect(decideJevPruningDrop({ relevance: 0.9, recoverable: 0.9 })).toBe(false)
  })

  it('drops a result that is clearly irrelevant', () => {
    expect(decideJevPruningDrop({ relevance: 0.05, recoverable: 0.1 })).toBe(true)
  })

  it('resolves an undecided band by whether a re-run would bring the contents back', () => {
    // The middle band is the structure fast-jev-compaction has and a plain two-way cut does not:
    // removal there needs the second answer to agree, rather than one uncertain answer deciding.
    expect(decideJevPruningDrop({ relevance: 0.35, recoverable: 0.9 })).toBe(true)
    expect(decideJevPruningDrop({ relevance: 0.35, recoverable: 0.1 })).toBe(false)
  })

  it('keeps when the recoverability answer is unreadable', () => {
    expect(decideJevPruningDrop({ relevance: 0.35, recoverable: null })).toBe(false)
  })

  it('keeps when the relevance answer is unreadable', () => {
    // An unreadable answer is not evidence that the result is stale.
    expect(decideJevPruningDrop({ relevance: null, recoverable: 0.99 })).toBe(false)
  })
})

describe('applyJevPruningDecisions', () => {
  const candidates = [
    {
      toolCallId: 'c1',
      toolName: 'exec',
      toolArgs: 'args-1',
      content: 'stale output',
      resultIndex: 1
    },
    {
      toolCallId: 'c2',
      toolName: 'exec',
      toolArgs: 'args-2',
      content: 'needed output',
      resultIndex: 2
    }
  ]

  const buildMessages = (): ChatMessage[] => [
    user('the task'),
    toolResult('c1', 'stale output'),
    toolResult('c2', 'needed output')
  ]

  it('replaces a result judged stale with a recallable placeholder', () => {
    const { messages: result, decisions } = applyJevPruningDecisions({
      messages: buildMessages(),
      candidates,
      signals: new Map([
        ['c1', { relevance: 0.05, recoverable: 0.9 }],
        ['c2', { relevance: 0.9, recoverable: 0.1 }]
      ])
    })

    expect(result[1].content).toContain(JEV_TOOL_RESULT_PRUNED_MARKER)
    expect(result[1].content).toContain('Tool call ID: c1')
    expect(result[1].content).toContain('tape_search')
    expect(result[2].content).toBe('needed output')
    expect(decisions.map((decision) => decision.kept)).toEqual([false, true])
  })

  it('keeps a result whose answer could not be read', () => {
    // An unreadable answer is not evidence that the result is stale. Defaulting to "drop" here would
    // let a malformed response silently delete context, which is the failure mode this design exists
    // to avoid.
    const messages = buildMessages()

    const { messages: result } = applyJevPruningDecisions({
      messages,
      candidates,
      signals: new Map([
        ['c1', { relevance: null, recoverable: null }],
        ['c2', { relevance: null, recoverable: null }]
      ])
    })

    expect(result).toBe(messages)
  })

  it('does not mutate the input array or its messages', () => {
    const messages = buildMessages()
    const originalContent = messages[1].content

    applyJevPruningDecisions({
      messages,
      candidates,
      signals: new Map([['c1', { relevance: 0, recoverable: 1 }]])
    })

    expect(messages[1].content).toBe(originalContent)
  })

  it('keeps everything when nothing is judged stale', () => {
    const messages = buildMessages()

    const { messages: result } = applyJevPruningDecisions({
      messages,
      candidates,
      signals: new Map([
        ['c1', { relevance: 0.9, recoverable: 0.1 }],
        ['c2', { relevance: 0.9, recoverable: 0.1 }]
      ])
    })

    expect(result).toBe(messages)
  })
})

describe('fitJevPruningState', () => {
  it('reports the candidates that actually travelled in the state', () => {
    const messages = [
      user('the task'),
      assistantCall(['c1']),
      toolResult('c1', 'small output'),
      assistantCall(['c2']),
      toolResult('c2', 'another output')
    ]

    const fitted = fitJevPruningState({ messages })

    expect(fitted?.shape).toBe('full')
    expect(fitted?.candidates.map((candidate) => candidate.toolCallId)).toEqual(['c1', 'c2'])
    expect(fitted?.estimatedTokens).toBeLessThanOrEqual(JEV_PRUNING_MAX_STATE_TOKENS)
  })

  it('tightens the shape and drops candidates when the full state does not fit', () => {
    // The candidates a tighter shape drops are dropped from the questions too: asking about content
    // that was not sent would be judging something the model never saw.
    //
    // Punctuation-heavy content, not prose. The estimator charges a letter run one token per six
    // letters but every other symbol nine tenths, so 24 candidates of 1200 `{` cost about 26k tokens
    // while 24 candidates of 1200 letters cost about 4.8k. Tool results are JSON often enough that
    // the tight shapes are reachable in practice; letter-only fixtures would never exercise them.
    const messages = [
      user('the task'),
      ...Array.from({ length: 20 }, (_, i) => [
        assistantCall([`c${i}`]),
        toolResult(`c${i}`, '{'.repeat(20_000))
      ]).flat()
    ]

    const fitted = fitJevPruningState({ messages })

    expect(fitted).not.toBeNull()
    expect(fitted!.shape).not.toBe('full')
    expect(fitted!.candidates.length).toBeLessThan(JEV_PRUNING_MAX_CANDIDATES)
    expect(fitted!.estimatedTokens).toBeLessThanOrEqual(JEV_PRUNING_MAX_STATE_TOKENS)
  })

  it('returns null when there is nothing in scope', () => {
    expect(fitJevPruningState({ messages: [user('the task')] })).toBeNull()
  })
})

describe('pruneClosedToolResultsForContext', () => {
  // Above JEV_PRUNING_MIN_CANDIDATE_CHARS, so the pre-call gate does not swallow these fixtures.
  const longResult = (label: string): string => `${label} ${'x'.repeat(2_500)}`

  it('skips without asking when there is nothing to judge', async () => {
    const messages = [user('hello')]
    let asked = false

    const outcome = await pruneClosedToolResultsForContext({
      messages,
      ask: async () => {
        asked = true
        return {}
      }
    })

    expect(asked).toBe(false)
    expect(outcome.messages).toBe(messages)
    expect(outcome.attempted).toBe(false)
    expect(outcome.skipReason).toBe('nothing-to-judge')
  })

  it('skips without asking when the candidates are too small to be worth a request', async () => {
    // The gate is deliberately before the call: `fast-jev-compaction` checks the reduction ratio
    // after the answers arrive, which is too late to save the request.
    const messages = [user('the task'), assistantCall(['c1']), toolResult('c1', 'tiny')]
    let asked = false

    const outcome = await pruneClosedToolResultsForContext({
      messages,
      ask: async () => {
        asked = true
        return {}
      }
    })

    expect(asked).toBe(false)
    expect(outcome.messages).toBe(messages)
    expect(outcome.skipReason).toBe('below-minimum-payload')
  })

  it('asks once for every candidate and reports the freed fraction', async () => {
    const messages = [
      user('the task'),
      assistantCall(['c1']),
      toolResult('c1', longResult('stale')),
      assistantCall(['c2']),
      toolResult('c2', longResult('needed'))
    ]

    let questionCount = 0
    const outcome = await pruneClosedToolResultsForContext({
      messages,
      ask: async ({ questions }) => {
        questionCount = Object.keys(questions).length
        return {
          relevant_c1: noul(0.05),
          recoverable_c1: noul(0.05),
          relevant_c2: noul(0.95),
          recoverable_c2: noul(0.05)
        }
      }
    })

    expect(questionCount).toBe(4)
    expect(outcome.attempted).toBe(true)
    expect(outcome.messages[2].content).toContain(JEV_TOOL_RESULT_PRUNED_MARKER)
    expect(outcome.messages[4].content).toContain('needed')
    expect(outcome.decisions.map((decision) => decision.kept)).toEqual([false, true])
    // Only the stale candidate's content was freed, out of both candidates' content.
    expect(outcome.reductionRatio).toBeGreaterThan(0)
    expect(outcome.reductionRatio).toBeLessThan(1)
  })

  it('reports a zero reduction when nothing is judged stale', async () => {
    const messages = [user('the task'), assistantCall(['c1']), toolResult('c1', longResult('kept'))]

    const outcome = await pruneClosedToolResultsForContext({
      messages,
      ask: async () => ({ relevant_c1: noul(0.99), recoverable_c1: noul(0.01) })
    })

    expect(outcome.attempted).toBe(true)
    expect(outcome.reductionRatio).toBe(0)
    expect(outcome.messages).toBe(messages)
  })
})
