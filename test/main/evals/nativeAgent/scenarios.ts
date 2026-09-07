import type {
  NativeAgentEvalScenario,
  NativeAgentEvalUsage,
  ScriptedProviderRound,
  ScriptedProviderUsage
} from './harness'
import { completionRound, toolRound } from './harness'

const DIRECT_USAGE = { inputTokens: 10, outputTokens: 4, totalTokens: 14 }
const MAX_TOKENS_USAGE = { inputTokens: 11, outputTokens: 4, totalTokens: 15 }
const TRUNCATED_TOOL_RECOVERY_ROUND_USAGES = [
  { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  { inputTokens: 4, outputTokens: 1, totalTokens: 5 }
] satisfies ScriptedProviderUsage[]
const TRUNCATED_TOOL_RECOVERY_USAGE = { inputTokens: 7, outputTokens: 3, totalTokens: 10 }
const SINGLE_TOOL_USAGE = { inputTokens: 18, outputTokens: 6, totalTokens: 24 }
const MULTI_TOOL_ROUND_USAGES = [
  {
    inputTokens: 7,
    outputTokens: 1,
    totalTokens: 8,
    cachedInputTokens: 2,
    cacheWriteInputTokens: 1
  },
  { inputTokens: 8, outputTokens: 2, totalTokens: 10, cachedInputTokens: 3 },
  { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheWriteInputTokens: 2 }
] satisfies ScriptedProviderUsage[]
const MULTI_TOOL_USAGE = {
  inputTokens: 25,
  outputTokens: 8,
  totalTokens: 33,
  cachedInputTokens: 5,
  cacheWriteInputTokens: 3
}
const TOOL_FAILURE_USAGE = { inputTokens: 12, outputTokens: 5, totalTokens: 17 }
const GENERIC_ERROR_USAGE = { inputTokens: 8, outputTokens: 1, totalTokens: 9 }
const CONTEXT_WINDOW_USAGE = { inputTokens: 20, outputTokens: 1, totalTokens: 21 }
const MAX_TOOL_CALLS_USAGE = { inputTokens: 130, outputTokens: 1, totalTokens: 131 }
const MAX_TOOL_CALLS = 128

function expectedUsage(usage?: ScriptedProviderUsage): NativeAgentEvalUsage {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    cachedInputTokens: usage?.cachedInputTokens ?? null,
    cacheWriteInputTokens: usage?.cacheWriteInputTokens ?? null
  }
}

function maxToolCallRounds(): ScriptedProviderRound[] {
  return Array.from({ length: MAX_TOOL_CALLS + 1 }, (_, index) => {
    const iteration = index + 1
    const events: ScriptedProviderRound['events'] = []
    if (index === MAX_TOOL_CALLS) {
      events.push({
        type: 'usage',
        usage: {
          prompt_tokens: MAX_TOOL_CALLS_USAGE.inputTokens,
          completion_tokens: MAX_TOOL_CALLS_USAGE.outputTokens,
          total_tokens: MAX_TOOL_CALLS_USAGE.totalTokens
        }
      })
    }
    events.push(
      {
        type: 'tool_call_start',
        tool_call_id: `call-action-${iteration}`,
        tool_call_name: 'action'
      },
      {
        type: 'tool_call_end',
        tool_call_id: `call-action-${iteration}`,
        tool_call_arguments_complete: JSON.stringify({ iteration })
      },
      { type: 'stop', stop_reason: 'tool_use' }
    )
    return { events }
  })
}

export const NATIVE_AGENT_EVAL_SCENARIOS: NativeAgentEvalScenario[] = [
  {
    id: 'direct-completion',
    rounds: [completionRound('Direct answer', DIRECT_USAGE)],
    budget: { maxProviderRounds: 1, maxToolCalls: 0 },
    expected: {
      status: 'completed',
      stopReason: 'complete',
      persistedStatus: 'sent',
      persistedRunOutcome: 'completed',
      persistedRunStopReason: 'complete',
      providerRounds: 1,
      toolCalls: 0,
      finalTextIncludes: 'Direct answer',
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage(DIRECT_USAGE)
    }
  },
  {
    id: 'max-tokens',
    rounds: [
      {
        events: [
          {
            type: 'usage',
            usage: {
              prompt_tokens: MAX_TOKENS_USAGE.inputTokens,
              completion_tokens: MAX_TOKENS_USAGE.outputTokens,
              total_tokens: MAX_TOKENS_USAGE.totalTokens
            }
          },
          { type: 'text', content: 'Truncated answer' },
          { type: 'stop', stop_reason: 'max_tokens' }
        ]
      }
    ],
    budget: { maxProviderRounds: 1, maxToolCalls: 0 },
    expected: {
      status: 'completed',
      stopReason: 'max_tokens',
      persistedStatus: 'sent',
      persistedRunOutcome: 'completed',
      persistedRunStopReason: 'max_tokens',
      providerRounds: 1,
      toolCalls: 0,
      finalTextIncludes: 'Truncated answer',
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage(MAX_TOKENS_USAGE)
    }
  },
  {
    id: 'truncated-tool-call-recovery',
    rounds: [
      {
        events: [
          {
            type: 'usage',
            usage: {
              prompt_tokens: TRUNCATED_TOOL_RECOVERY_ROUND_USAGES[0].inputTokens,
              completion_tokens: TRUNCATED_TOOL_RECOVERY_ROUND_USAGES[0].outputTokens,
              total_tokens: TRUNCATED_TOOL_RECOVERY_ROUND_USAGES[0].totalTokens
            }
          },
          {
            type: 'tool_call_start',
            tool_call_id: 'call-truncated-action',
            tool_call_name: 'action'
          },
          {
            type: 'tool_call_chunk',
            tool_call_id: 'call-truncated-action',
            tool_call_arguments_chunk: '{"path":"result.txt"'
          },
          { type: 'stop', stop_reason: 'max_tokens' }
        ]
      },
      completionRound('Recovered truncated tool call', TRUNCATED_TOOL_RECOVERY_ROUND_USAGES[1])
    ],
    tools: {
      action: {
        response: 'must not execute',
        permission: {
          permissionType: 'write',
          description: 'Must not request permission for a truncated call'
        }
      }
    },
    permissionMode: 'ask_user',
    budget: { maxProviderRounds: 2, maxToolCalls: 0 },
    expected: {
      status: 'completed',
      stopReason: 'complete',
      persistedStatus: 'sent',
      persistedRunOutcome: 'completed',
      persistedRunStopReason: 'complete',
      providerRounds: 2,
      toolCalls: 0,
      finalTextIncludes: 'Recovered truncated tool call',
      toolMessageIncludes: ['model response reached the output token limit'],
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage(TRUNCATED_TOOL_RECOVERY_USAGE)
    }
  },
  {
    id: 'single-tool-round',
    rounds: [
      toolRound('call-read-1', 'read', '{"path":"src/main.ts"}'),
      completionRound('Read completed', SINGLE_TOOL_USAGE)
    ],
    tools: {
      read: { response: 'export const answer = 42' }
    },
    budget: { maxProviderRounds: 2, maxToolCalls: 1 },
    expected: {
      status: 'completed',
      stopReason: 'complete',
      persistedStatus: 'sent',
      persistedRunOutcome: 'completed',
      persistedRunStopReason: 'complete',
      providerRounds: 2,
      toolCalls: 1,
      finalTextIncludes: 'Read completed',
      toolMessageIncludes: ['export const answer = 42'],
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage(SINGLE_TOOL_USAGE)
    }
  },
  {
    id: 'multiple-tool-rounds',
    rounds: [
      toolRound('call-search-1', 'grep', '{"query":"answer"}', MULTI_TOOL_ROUND_USAGES[0]),
      toolRound('call-read-2', 'read', '{"path":"src/answer.ts"}', MULTI_TOOL_ROUND_USAGES[1]),
      completionRound('Located the answer', MULTI_TOOL_ROUND_USAGES[2])
    ],
    tools: {
      grep: { response: '[{"path":"src/answer.ts","lineNumber":1}]' },
      read: { response: 'export const answer = 42' }
    },
    budget: { maxProviderRounds: 4, maxToolCalls: 3 },
    expected: {
      status: 'completed',
      stopReason: 'complete',
      persistedStatus: 'sent',
      persistedRunOutcome: 'completed',
      persistedRunStopReason: 'complete',
      providerRounds: 3,
      toolCalls: 2,
      finalTextIncludes: 'Located the answer',
      toolMessageIncludes: ['src/answer.ts', 'export const answer = 42'],
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage(MULTI_TOOL_USAGE)
    }
  },
  {
    id: 'tool-failure-recovery',
    rounds: [
      toolRound('call-lookup-1', 'lookup', '{"id":"missing"}'),
      completionRound('Recovered after tool failure', TOOL_FAILURE_USAGE)
    ],
    tools: {
      lookup: { error: 'simulated lookup failure' }
    },
    budget: { maxProviderRounds: 2, maxToolCalls: 1 },
    expected: {
      status: 'completed',
      stopReason: 'complete',
      persistedStatus: 'sent',
      persistedRunOutcome: 'completed',
      persistedRunStopReason: 'complete',
      providerRounds: 2,
      toolCalls: 1,
      finalTextIncludes: 'Recovered after tool failure',
      toolMessageIncludes: ['Error: simulated lookup failure'],
      failedToolCalls: 1,
      permissionRequests: 0,
      usage: expectedUsage(TOOL_FAILURE_USAGE)
    }
  },
  {
    id: 'permission-pause',
    rounds: [toolRound('call-write-1', 'write', '{"path":"result.txt","content":"ok"}')],
    tools: {
      write: {
        response: 'written',
        permission: {
          permissionType: 'write',
          description: 'Allow writing result.txt'
        }
      }
    },
    permissionMode: 'ask_user',
    budget: { maxProviderRounds: 1, maxToolCalls: 0 },
    expected: {
      status: 'paused',
      stopReason: null,
      persistedStatus: 'pending',
      persistedRunOutcome: 'paused',
      persistedRunStopReason: 'interaction',
      providerRounds: 1,
      toolCalls: 0,
      failedToolCalls: 0,
      permissionRequests: 1,
      usage: expectedUsage()
    }
  },
  {
    id: 'cancellation',
    rounds: [
      {
        events: [
          { type: 'text', content: 'Partial answer' },
          { type: 'stop', stop_reason: 'complete' }
        ],
        abortBeforeEventIndex: 1
      }
    ],
    budget: { maxProviderRounds: 1, maxToolCalls: 0 },
    expected: {
      status: 'aborted',
      stopReason: 'user_stop',
      persistedStatus: 'error',
      persistedRunOutcome: 'aborted',
      persistedRunStopReason: 'user_stop',
      providerRounds: 1,
      toolCalls: 0,
      finalTextIncludes: 'common.error.userCanceledGeneration',
      errorMessageIncludes: 'common.error.userCanceledGeneration',
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage()
    }
  },
  {
    id: 'pending-input-yield',
    rounds: [toolRound('call-read-pending', 'read', '{"path":"pending.txt"}')],
    tools: {
      read: { response: 'pending result' }
    },
    yieldForPendingInput: true,
    budget: { maxProviderRounds: 1, maxToolCalls: 1 },
    expected: {
      status: 'completed',
      stopReason: 'pending_input',
      persistedStatus: 'sent',
      persistedRunOutcome: 'completed',
      persistedRunStopReason: 'pending_input',
      providerRounds: 1,
      toolCalls: 1,
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage()
    }
  },
  {
    id: 'max-provider-rounds',
    rounds: [toolRound('call-loop-1', 'loop', '{}')],
    tools: {
      loop: { response: 'continue' }
    },
    maxProviderRounds: 1,
    budget: { maxProviderRounds: 1, maxToolCalls: 1 },
    expected: {
      status: 'error',
      stopReason: 'max_turns',
      persistedStatus: 'error',
      persistedRunOutcome: 'error',
      persistedRunStopReason: 'max_turns',
      providerRounds: 1,
      toolCalls: 1,
      terminalErrorIncludes: 'Maximum agent turns exceeded (1).',
      errorMessageIncludes: 'Maximum agent turns exceeded (1).',
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage()
    }
  },
  {
    id: 'max-tool-calls',
    rounds: maxToolCallRounds(),
    tools: {
      action: { response: 'completed action' }
    },
    budget: { maxProviderRounds: 129, maxToolCalls: 128 },
    expected: {
      status: 'completed',
      stopReason: 'max_tool_calls',
      persistedStatus: 'sent',
      persistedRunOutcome: 'completed',
      persistedRunStopReason: 'max_tool_calls',
      providerRounds: 129,
      toolCalls: 128,
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage(MAX_TOOL_CALLS_USAGE)
    }
  },
  {
    id: 'repeated-tool-no-progress',
    rounds: [
      toolRound('call-loop-1', 'loop', '{"target":"same"}'),
      toolRound('call-loop-2', 'loop', '{"target":"same"}'),
      toolRound('call-loop-3', 'loop', '{"target":"same"}'),
      toolRound('call-loop-4', 'loop', '{"target":"same"}')
    ],
    tools: {
      loop: { response: 'unchanged result' }
    },
    budget: { maxProviderRounds: 4, maxToolCalls: 4 },
    expected: {
      status: 'error',
      stopReason: 'no_progress',
      persistedStatus: 'error',
      persistedRunOutcome: 'error',
      persistedRunStopReason: 'no_progress',
      providerRounds: 4,
      toolCalls: 4,
      finalTextIncludes: 'four identical tool batches produced no progress',
      terminalErrorIncludes: 'four identical tool batches produced no progress',
      errorMessageIncludes: 'four identical tool batches produced no progress',
      toolMessageIncludes: ['agent_no_progress'],
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage()
    }
  },
  {
    id: 'empty-provider-output',
    rounds: [{ events: [{ type: 'stop', stop_reason: 'complete' }] }],
    budget: { maxProviderRounds: 1, maxToolCalls: 0 },
    expected: {
      status: 'error',
      stopReason: 'empty_response',
      persistedStatus: 'error',
      persistedRunOutcome: 'error',
      persistedRunStopReason: 'empty_response',
      providerRounds: 1,
      toolCalls: 0,
      finalTextIncludes: 'common.error.noModelResponse',
      terminalErrorIncludes: 'common.error.noModelResponse',
      errorMessageIncludes: 'common.error.noModelResponse',
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage()
    }
  },
  {
    id: 'generic-provider-error',
    rounds: [
      {
        events: [
          {
            type: 'usage',
            usage: {
              prompt_tokens: GENERIC_ERROR_USAGE.inputTokens,
              completion_tokens: GENERIC_ERROR_USAGE.outputTokens,
              total_tokens: GENERIC_ERROR_USAGE.totalTokens
            }
          },
          { type: 'text', content: 'Partial provider answer' },
          { type: 'error', error_message: 'Rate limit exceeded' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      }
    ],
    budget: { maxProviderRounds: 1, maxToolCalls: 0 },
    expected: {
      status: 'error',
      stopReason: 'provider_error',
      persistedStatus: 'error',
      persistedRunOutcome: 'error',
      persistedRunStopReason: 'provider_error',
      providerRounds: 1,
      toolCalls: 0,
      finalTextIncludes: 'Rate limit exceeded',
      terminalErrorIncludes: 'Rate limit exceeded',
      errorMessageIncludes: 'Rate limit exceeded',
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage(GENERIC_ERROR_USAGE)
    }
  },
  {
    id: 'context-window-error',
    rounds: [
      {
        events: [
          {
            type: 'usage',
            usage: {
              prompt_tokens: CONTEXT_WINDOW_USAGE.inputTokens,
              completion_tokens: CONTEXT_WINDOW_USAGE.outputTokens,
              total_tokens: CONTEXT_WINDOW_USAGE.totalTokens
            }
          },
          {
            type: 'error',
            error_message: 'maximum context length exceeded'
          }
        ]
      }
    ],
    budget: { maxProviderRounds: 1, maxToolCalls: 0 },
    expected: {
      status: 'error',
      stopReason: 'context_window',
      persistedStatus: 'error',
      persistedRunOutcome: 'error',
      persistedRunStopReason: 'context_window',
      providerRounds: 1,
      toolCalls: 0,
      finalTextIncludes: 'maximum context length exceeded',
      terminalErrorIncludes: 'maximum context length exceeded',
      errorMessageIncludes: 'maximum context length exceeded',
      failedToolCalls: 0,
      permissionRequests: 0,
      usage: expectedUsage(CONTEXT_WINDOW_USAGE)
    }
  }
]
