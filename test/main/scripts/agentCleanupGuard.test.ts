import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findDeepChatHarnessBarrelViolations,
  findDeepChatRootOwnershipViolations,
  findMissingDeepChatOwnershipSymbols,
  isDeepChatHarnessImport
} from '../../../scripts/agent-cleanup-guard.mjs'

const repositoryRoot = process.cwd()

describe('agent cleanup guard', () => {
  it('rejects harness imports from every DeepChat owner directory', () => {
    const ownerFiles = [
      'src/main/agent/deepchat/instance/deepChatAgentRuntime.ts',
      'src/main/agent/deepchat/loop/contextCoordinator.ts',
      'src/main/agent/deepchat/memory/memoryRuntimeCoordinator.ts',
      'src/main/agent/deepchat/resources/systemPromptBuilder.ts',
      'src/main/agent/deepchat/runtime/runLifecycleCoordinator.ts'
    ]

    for (const ownerFile of ownerFiles) {
      expect(
        isDeepChatHarnessImport(path.join(repositoryRoot, ownerFile), '@/agent/deepchat/harness')
      ).toBe(true)
      expect(
        isDeepChatHarnessImport(
          path.join(repositoryRoot, ownerFile),
          '@/agent/deepchat/harness/deepChatAgentHarness'
        )
      ).toBe(true)
    }
  })

  it('recognizes relative harness imports from an owner directory', () => {
    const ownerFile = path.join(
      repositoryRoot,
      'src/main/agent/deepchat/memory/memoryRuntimeCoordinator.ts'
    )

    expect(isDeepChatHarnessImport(ownerFile, '../harness')).toBe(true)
    expect(isDeepChatHarnessImport(ownerFile, '../harness/createDeepChatAgentHarness.ts')).toBe(
      true
    )
  })

  it('allows the harness layer itself and adapters outside the DeepChat implementation', () => {
    expect(
      isDeepChatHarnessImport(
        path.join(repositoryRoot, 'src/main/agent/deepchat/harness/deepChatAgentHarness.ts'),
        './createDeepChatAgentHarness'
      )
    ).toBe(false)
    expect(
      isDeepChatHarnessImport(
        path.join(repositoryRoot, 'src/main/agent/manager/deepChatAgentBackend.ts'),
        '@/agent/deepchat/harness'
      )
    ).toBe(false)
    expect(
      isDeepChatHarnessImport(
        path.join(repositoryRoot, 'src/main/app/composition.ts'),
        '@/agent/deepchat/harness'
      )
    ).toBe(false)
  })

  it('accepts only allowlisted harness barrel exports', () => {
    expect(
      findDeepChatHarnessBarrelViolations(`
        export { createDeepChatAgentHarness } from './createDeepChatAgentHarness'
        export type { DeepChatAgentHarness } from './deepChatAgentHarness'
        declare const createDeepChatAgentHarness: unknown
        export default createDeepChatAgentHarness
      `)
    ).toEqual([])
  })

  it('rejects every declaration and default-export escape from the harness barrel', () => {
    const violations = [
      `
        export enum InternalMode { Default }
        export namespace RuntimeOwners {}
        export import InternalHarness = RuntimeOwners
        const internalOwner = {}
        export default internalOwner
        const owners = { hiddenOwner: {} }
        export const { hiddenOwner } = owners
      `,
      'export default {}',
      'export default function () {}'
    ].flatMap(findDeepChatHarnessBarrelViolations)

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'deepchat-harness-export-surface', detail: 'InternalMode' },
        { kind: 'deepchat-harness-export-surface', detail: 'RuntimeOwners' },
        { kind: 'deepchat-harness-export-surface', detail: 'InternalHarness' },
        { kind: 'deepchat-harness-export-surface', detail: 'internalOwner' },
        { kind: 'deepchat-harness-export-surface', detail: 'default export' },
        { kind: 'deepchat-harness-export-surface', detail: 'hiddenOwner' }
      ])
    )
  })

  it('detects protected ownership calls through syntax rather than source text', () => {
    expect(
      findDeepChatRootOwnershipViolations(`
        class Harness {
          run() {
            this.pendingInputs.claimQueuedInput('session', 'item')
          }
        }
      `)
    ).toContainEqual({
      kind: 'pending-input-claim-lifecycle',
      detail: 'claimQueuedInput()'
    })
  })

  it('detects session projection implementations reappearing on the harness', () => {
    const violations = findDeepChatRootOwnershipViolations(`
      class Harness {
        async refresh(messageId: string) {
          await normalizeToolResultContent(this.deps, {})
          this.transcript.updateAssistantContent(messageId, [])
        }
      }
    `)

    expect(violations).toContainEqual({
      kind: 'session-projection-implementation',
      detail: 'normalizeToolResultContent()'
    })
    expect(violations).toContainEqual({
      kind: 'session-projection-implementation',
      detail: 'updateAssistantContent()'
    })
  })

  it('ignores protected symbol names that appear only in comments or strings', () => {
    expect(
      findDeepChatRootOwnershipViolations(`
        // this.pendingInputs.claimQueuedInput('session', 'item')
        const diagnostic = 'tryAcquirePendingQueueDrain()'
      `)
    ).toEqual([])
  })

  it('keeps every configured ownership symbol anchored to a real owner declaration', async () => {
    await expect(findMissingDeepChatOwnershipSymbols()).resolves.toEqual([])
  })
})
