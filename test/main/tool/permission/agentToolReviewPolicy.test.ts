import { describe, expect, it } from 'vitest'
import { TOOL_EXECUTION } from '@shared/types/core/mcp'
import {
  collectAgentToolApprovalPaths,
  requiresAgentToolApprovalPaths,
  requiresAgentToolApprovalShellProfile,
  resolveAgentToolReview
} from '@/tool/permission/agentToolReviewPolicy'

const review = (
  toolName: string,
  args: Record<string, unknown>,
  execution = TOOL_EXECUTION.write
) => resolveAgentToolReview({ toolName, args, execution, source: 'agent' })

describe('agent tool review policy', () => {
  describe('scenarios that used to produce an unapprovable payload', () => {
    it('reviews a process call without demanding filesystem paths', () => {
      const decision = review('process', { action: 'kill', sessionId: 'sess-1' })

      expect(decision).toMatchObject({
        reviewed: true,
        scope: 'tool',
        permissionType: 'write',
        paths: []
      })
      expect(requiresAgentToolApprovalPaths('process')).toBe(false)
    })

    it('does not read a tape_search kind filter as a path', () => {
      const decision = review('tape_search', { query: 'review', kinds: ['event', 'anchor'] })

      expect(decision.paths).toEqual([])
    })

    it('does not read a subagent id list as a path', () => {
      const decision = review('deepchat_subagents', {
        operation: 'send',
        delegationIds: ['delegation-1', 'delegation-2']
      })

      expect(decision.paths).toEqual([])
    })

    it('does not read a skill draft path as a workspace path', () => {
      const decision = review('skill_manage', {
        action: 'write_file',
        filePath: 'SKILL.md',
        content: 'body'
      })

      expect(decision).toMatchObject({ reviewed: true, scope: 'tool', paths: [] })
    })

    it('does not read a skill script as a shell command', () => {
      const decision = review('skill_run', { skill: 'demo', script: 'run.sh', args: ['--fast'] })

      expect(decision).toMatchObject({ scope: 'tool', permissionType: 'write' })
    })

    it('does not read a str_replace_editor operation name as a shell command', () => {
      const decision = review('str_replace_editor', {
        command: 'str_replace',
        path: 'src/app.ts'
      })

      expect(decision).toMatchObject({ scope: 'paths', permissionType: 'write' })
      expect(decision.paths).toEqual(['src/app.ts'])
    })
  })

  describe('coverage follows the declared execution contract', () => {
    it('does not review read-effect tools', () => {
      expect(
        review('glob', { query: '*.ts', pathScope: ['src'] }, TOOL_EXECUTION.read.parallel)
      ).toMatchObject({ reviewed: false })
      expect(review('grep', { query: 'needle' }, TOOL_EXECUTION.read.parallel)).toMatchObject({
        reviewed: false
      })
    })

    it('reviews a file write that carries no path keyword in its name', () => {
      const decision = review('apply_patch', {
        patch: '*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** End Patch'
      })

      expect(decision).toMatchObject({ reviewed: true, scope: 'paths' })
      expect(decision.paths).toEqual(['src/new.ts'])
    })

    it('reviews only the process actions that change a session', () => {
      expect(review('process', { action: 'log', sessionId: 'sess-1' }).reviewed).toBe(false)
      expect(review('process', { action: 'kill', sessionId: 'sess-1' }).reviewed).toBe(true)
    })

    it('reviews only the str_replace_editor actions that write', () => {
      expect(review('str_replace_editor', { command: 'view', path: 'src/app.ts' }).reviewed).toBe(
        false
      )
      expect(review('str_replace_editor', { command: 'create', path: 'src/app.ts' }).reviewed).toBe(
        true
      )
    })

    it('leaves tools that own an approval path alone', () => {
      expect(review('cronjob', { action: 'create', job: {} }).reviewed).toBe(false)
      expect(review('deepchat_subagents', { operation: 'spawn', prompt: 'go' }).reviewed).toBe(
        false
      )
    })

    it('does not review retrievals that are declared as writes', () => {
      expect(review('memory_recall', { query: 'preference' }).reviewed).toBe(false)
      expect(review('skill_view', { name: 'demo' }).reviewed).toBe(false)
    })

    it('does not review session-local plan updates', () => {
      expect(review('update_plan', { plan: [] }).reviewed).toBe(false)
    })

    it('does not review MCP tool calls', () => {
      expect(
        resolveAgentToolReview({
          toolName: 'create_issue',
          args: { path: '/tmp/report.md' },
          execution: TOOL_EXECUTION.write,
          source: 'mcp'
        }).reviewed
      ).toBe(false)
      expect(
        resolveAgentToolReview({
          toolName: 'write',
          args: { path: '/tmp/report.md' },
          execution: TOOL_EXECUTION.write
        }).reviewed
      ).toBe(false)
    })
  })

  describe('approval requirements', () => {
    it('keeps requiring paths for path-bearing tools', () => {
      expect(requiresAgentToolApprovalPaths('write')).toBe(true)
      expect(requiresAgentToolApprovalPaths('apply_patch')).toBe(true)
      expect(requiresAgentToolApprovalPaths('str_replace_editor')).toBe(true)
      expect(requiresAgentToolApprovalPaths('unrecognized-tool')).toBe(true)
    })

    it('requires a shell profile for every agent-filesystem approval', () => {
      expect(requiresAgentToolApprovalShellProfile('agent-filesystem')).toBe(true)
      expect(requiresAgentToolApprovalShellProfile('agent-tape')).toBe(false)
      expect(requiresAgentToolApprovalShellProfile(undefined)).toBe(false)
    })

    it('collects paths only from arguments that really are paths', () => {
      expect(collectAgentToolApprovalPaths('write', { path: 'src/app.ts' })).toEqual(['src/app.ts'])
      expect(collectAgentToolApprovalPaths('write', { path: '  ' })).toEqual([])
      expect(collectAgentToolApprovalPaths('skill_manage', { filePath: 'SKILL.md' })).toEqual([])
      expect(collectAgentToolApprovalPaths('deepchat_subagents', { delegationIds: ['a'] })).toEqual(
        []
      )
    })
  })
})
