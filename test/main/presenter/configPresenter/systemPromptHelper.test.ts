import { describe, expect, it } from 'vitest'
import { DEFAULT_SYSTEM_PROMPT } from '@/presenter/configPresenter/systemPromptHelper'
import { DEEPCHAT_SUBAGENT_MODEL_GUIDANCE } from '@shared/lib/deepchatSubagents'

describe('default system prompt', () => {
  it('uses the shared conservative Subagent delegation guidance', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE)
    expect(DEFAULT_SYSTEM_PROMPT).toContain('When `subagent_orchestrator` is available')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('use them when requested and available')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('For proactive delegation')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('Do not proactively delegate simple')
  })
})
