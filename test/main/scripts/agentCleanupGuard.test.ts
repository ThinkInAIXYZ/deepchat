import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findAgentBoundaryViolations,
  findNativeCompositionViolations
} from '../../../scripts/agent-cleanup-guard.mjs'
const source = (name: string) => path.resolve('src/main', name)

describe('agent execution boundaries', () => {
  it('rejects retired executors and both alias and relative imports', () => {
    for (const [file, code] of [
      ['app/composition.ts', "import { factory } from '@/agent/deepchat/harness'"],
      ['agent/dim/backend.ts', "import type { LoopRun } from '../deepchat/loop/loopRun'"],
      ['app/composition.ts', 'new DeepChatAgentHarness(dependencies)'],
      ['tool/index.ts', 'new RunCodeRuntimeManager(options)'],
      ['tool/index.ts', "import { Runtime } from './codeMode/runtime'"]
    ])
      expect(findAgentBoundaryViolations(code, source(file)).length).toBeGreaterThan(0)
    expect(
      findAgentBoundaryViolations('', source('agent/deepchat/runtime/newLoop.ts'))
    ).toContainEqual(expect.objectContaining({ kind: 'retired-runtime-source' }))
  })
  it('keeps direct ACP independent of dim transport while allowing shared desktop contracts', () => {
    expect(
      findAgentBoundaryViolations(
        "import { Client } from '@/agent/acp/client'",
        source('agent/dim/transport.ts')
      )
    ).toContainEqual(expect.objectContaining({ kind: 'dim-imports-acp' }))
    expect(
      findAgentBoundaryViolations(
        "import { DimContent } from '../../dim/content'",
        source('agent/acp/client/transport.ts')
      )
    ).toContainEqual(expect.objectContaining({ kind: 'acp-imports-dim' }))
    expect(
      findAgentBoundaryViolations(
        "import { SessionResources } from '@/agent/shared/resources/sessionResources'",
        source('agent/acp/compatibility/dependencies.ts')
      )
    ).toEqual([])
  })
  it('requires production native owners for agents and every inference facade', () => {
    expect(findNativeCompositionViolations('')).toHaveLength(6)
    expect(
      findNativeCompositionViolations(`
      const host = new DimRuntimeSupervisor({ nativePlugins: true })
      const agent = createDimAgent({ host })
      provider.setNativeModels(text)
      provider.setNativeMedia(media)
      provider.setNativeEmbedding(embedding)
    `)
    ).toEqual([])
  })
  it('preserves skill and MCP isolation rules', () => {
    expect(
      findAgentBoundaryViolations(
        'presenter.sessionPresenter.getLegacyConversation()',
        source('skill/index.ts')
      ).map((item) => item.kind)
    ).toEqual(['legacy-session-access', 'skill-global-presenter', 'skill-legacy-fallback'])
    expect(
      findAgentBoundaryViolations('input_chatMode = next', source('mcp/toolManager.ts'))
    ).toContainEqual(expect.objectContaining({ kind: 'global-chat-mode' }))
  })
})
