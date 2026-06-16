import { describe, expect, it } from 'vitest'

import {
  appendMemorySection,
  buildMemorySection,
  type MemoryInjectionPayload,
  type MemoryInjectionPort
} from '@/presenter/memoryPresenter/injectionPort'

/**
 * 复刻 AgentRuntimePresenter.appendMemoryInjection 的核心契约：
 * - 无 port / 未启用 / 抛错 → 返回原 systemPrompt（不污染、不阻塞）
 * - 启用且有 payload → 末尾追加 Layer 4，且不改动前面的层
 */
async function appendMemoryInjection(
  port: MemoryInjectionPort | undefined,
  agentId: string,
  systemPrompt: string,
  query: string
): Promise<string> {
  if (!port) return systemPrompt
  try {
    if (!port.isEnabled(agentId)) return systemPrompt
    const payload = await port.buildInjection(agentId, query)
    return appendMemorySection(systemPrompt, payload)
  } catch {
    return systemPrompt
  }
}

const BASE_PROMPT = [
  'USER SYSTEM PROMPT',
  '',
  '## Conversation Summary',
  'previous summary text'
].join('\n')

function makePort(
  enabled: boolean,
  payload: MemoryInjectionPayload | null,
  throwOnBuild = false
): MemoryInjectionPort {
  return {
    isEnabled: () => enabled,
    buildInjection: async () => {
      if (throwOnBuild) throw new Error('boom')
      return payload
    }
  }
}

describe('appendMemoryInjection contract', () => {
  it('returns prompt unchanged when no port', async () => {
    expect(await appendMemoryInjection(undefined, 'a', BASE_PROMPT, 'q')).toBe(BASE_PROMPT)
  })

  it('returns prompt unchanged when memory disabled', async () => {
    const port = makePort(false, { selfModel: 'X', memories: [] })
    expect(await appendMemoryInjection(port, 'a', BASE_PROMPT, 'q')).toBe(BASE_PROMPT)
  })

  it('returns prompt unchanged when payload is null', async () => {
    const port = makePort(true, null)
    expect(await appendMemoryInjection(port, 'a', BASE_PROMPT, 'q')).toBe(BASE_PROMPT)
  })

  it('never throws and degrades to base prompt on error', async () => {
    const port = makePort(true, null, true)
    expect(await appendMemoryInjection(port, 'a', BASE_PROMPT, 'q')).toBe(BASE_PROMPT)
  })

  it('appends Layer 4 after existing layers without mutating them', async () => {
    const port = makePort(true, {
      selfModel: 'I answer concisely',
      memories: [{ id: '1', kind: 'semantic', content: 'user likes redis' }]
    })
    const result = await appendMemoryInjection(port, 'a', BASE_PROMPT, 'redis')

    // 前面的层逐字保留
    expect(result.startsWith(BASE_PROMPT)).toBe(true)
    // Layer 4 出现在最后
    const summaryIdx = result.indexOf('## Conversation Summary')
    const selfModelIdx = result.indexOf('## Self-Model')
    const memoriesIdx = result.indexOf('## Relevant Memories')
    expect(selfModelIdx).toBeGreaterThan(summaryIdx)
    expect(memoriesIdx).toBeGreaterThan(selfModelIdx)
    expect(result).toContain('user likes redis')
  })
})

describe('buildMemorySection ordering', () => {
  it('self-model precedes memories', () => {
    const section = buildMemorySection({
      selfModel: 'persona',
      memories: [{ id: '1', kind: 'episodic', content: 'event happened' }]
    })
    expect(section.indexOf('## Self-Model')).toBeLessThan(section.indexOf('## Relevant Memories'))
  })
})
