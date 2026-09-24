import { describe, expect, it } from 'vitest'
import { TOOL_EXECUTION } from '@shared/types/core/mcp'
import {
  isAgentToolPathBearing,
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
        permissionType: 'write'
      })
      expect(isAgentToolPathBearing('process')).toBe(false)
    })

    it('never scopes a filter, id list or draft path to filesystem paths', () => {
      // These tools authorize no workspace path, so their approvals are tool-scoped whatever their
      // arguments happen to contain. Path extraction belongs to the tool layer, which reads only
      // the arguments that really are paths.
      expect(isAgentToolPathBearing('tape_search')).toBe(false)
      expect(isAgentToolPathBearing('deepchat_subagents')).toBe(false)
      expect(isAgentToolPathBearing('skill_manage')).toBe(false)
      expect(review('tape_search', { query: 'review', kinds: ['event', 'anchor'] })).toMatchObject({
        scope: 'tool'
      })
      expect(
        review('deepchat_subagents', {
          operation: 'send',
          delegationIds: ['delegation-1', 'delegation-2']
        })
      ).toMatchObject({ scope: 'tool' })
      expect(
        review('skill_manage', { action: 'write_file', filePath: 'SKILL.md', content: 'body' })
      ).toMatchObject({ reviewed: true, scope: 'tool' })
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
      expect(review('apply_patch', {})).toMatchObject({ reviewed: true, scope: 'paths' })
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
    it('requires paths only from tools that authorize them', () => {
      expect(isAgentToolPathBearing('write')).toBe(true)
      expect(isAgentToolPathBearing('apply_patch')).toBe(true)
      expect(isAgentToolPathBearing('str_replace_editor')).toBe(true)
      expect(isAgentToolPathBearing('read')).toBe(true)
      expect(isAgentToolPathBearing('exec')).toBe(true)
      expect(isAgentToolPathBearing('process')).toBe(false)
      expect(isAgentToolPathBearing('memory_recall')).toBe(false)
      expect(isAgentToolPathBearing('skill_manage')).toBe(false)
      expect(isAgentToolPathBearing('unrecognized-tool')).toBe(false)
    })

    it('requires a shell profile for every agent-filesystem approval', () => {
      expect(requiresAgentToolApprovalShellProfile('agent-filesystem')).toBe(true)
      expect(requiresAgentToolApprovalShellProfile('agent-tape')).toBe(false)
      expect(requiresAgentToolApprovalShellProfile(undefined)).toBe(false)
    })

    it('scopes a path-bearing tool to paths without re-deriving the path arguments', () => {
      // `apply_patch` sends raw patch text, not JSON, so the policy must not try to read a `path`
      // out of it: the tool layer resolves the targets from the raw text.
      expect(review('apply_patch', {}, TOOL_EXECUTION.write)).toMatchObject({
        reviewed: true,
        scope: 'paths'
      })
      expect(review('write', {}, TOOL_EXECUTION.write)).toMatchObject({
        reviewed: true,
        scope: 'paths'
      })
      expect(review('process', { action: 'kill' }, TOOL_EXECUTION.write)).toMatchObject({
        reviewed: true,
        scope: 'tool'
      })
    })
  })
})
