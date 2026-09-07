export function createDeepSeekWebSearchCall(query = 'DeepChat') {
  return {
    type: 'web_search_call' as const,
    id: 'ws_1',
    status: 'completed' as const,
    action: {
      type: 'search' as const,
      query
    }
  }
}

export function createDeepSeekReplayJson(query = 'DeepChat'): string {
  return JSON.stringify({
    version: 1,
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    item: createDeepSeekWebSearchCall(query)
  })
}
