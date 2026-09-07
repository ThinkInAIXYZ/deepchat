import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT,
  AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS,
  AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS
} from '@shared/types/agent-memory'

import { normalizeMemoryDirective } from '@/memory/domain/directives'
import { makePresenter } from './support/memoryFakes'

describe('DirectiveService', () => {
  it('requires explicit approval before a derived suggestion becomes active', () => {
    let now = 1_000
    const onMemoryChanged = vi.fn()
    const { presenter, auditRepo } = makePresenter({ memoryEnabled: true }, undefined, {
      clock: { now: () => now, timeZone: () => 'UTC' },
      onMemoryChanged
    })

    const draft = presenter.suggestDirective('a', {
      kind: 'suppress_topic',
      content: 'Do not mention Project Saffron.',
      topic: 'Project Saffron'
    })
    expect(draft).toMatchObject({
      status: 'draft',
      source: 'derived_suggestion',
      normalized_topic: 'project saffron'
    })
    expect(presenter.listActiveDirectives('a')).toEqual([])
    expect(presenter.getStatus('a')).toMatchObject({
      directiveDraftCount: 1,
      activeDirectiveCount: 0
    })

    now = 2_000
    expect(presenter.approveDirective('a', draft!.id)).toMatchObject({
      id: draft!.id,
      status: 'active',
      source: 'derived_suggestion'
    })
    expect(presenter.listActiveDirectives('a')).toHaveLength(1)
    expect(presenter.getStatus('a')).toMatchObject({
      directiveDraftCount: 0,
      activeDirectiveCount: 1
    })
    expect(presenter.approveDirective('a', draft!.id)).toBeNull()
    expect(presenter.listDirectives('a')).toHaveLength(1)

    const serializedAudit = JSON.stringify(auditRepo.rows)
    expect(serializedAudit).not.toContain('Project Saffron')
    expect(auditRepo.rows.map((row) => row.event_type)).toEqual([
      'memory/directive_suggest',
      'memory/directive_approve'
    ])
    expect(onMemoryChanged.mock.calls).toEqual([
      ['a', 'directive-suggest', { directiveId: draft!.id }],
      ['a', 'directive-approve', { directiveId: draft!.id }]
    ])
  })

  it('does not let repeated model output reopen a rejected suggestion', () => {
    const { presenter } = makePresenter({ memoryEnabled: true })
    const input = {
      kind: 'instruction' as const,
      content: 'Prefer concise answers.'
    }
    const draft = presenter.suggestDirective('a', input)
    expect(draft).not.toBeNull()
    expect(presenter.rejectDirectiveResult('a', draft!.id)).toMatchObject({
      action: 'applied',
      directive: { status: 'rejected' }
    })
    expect(presenter.rejectDirectiveResult('a', draft!.id)).toEqual({
      action: 'rejected',
      directive: null,
      reason: 'not-found'
    })

    expect(presenter.suggestDirective('a', input)).toBeNull()
    expect(presenter.listDirectives('a')).toEqual([
      expect.objectContaining({ id: draft!.id, status: 'rejected' })
    ])

    const explicit = presenter.createDirective('a', input, 'explicit_user')
    expect(explicit).toMatchObject({
      id: draft!.id,
      status: 'active',
      source: 'explicit_user'
    })
  })

  it('deduplicates normalized explicit content and emits no duplicate mutation', () => {
    const { presenter, auditRepo } = makePresenter({ memoryEnabled: true })
    const first = presenter.createDirective('a', {
      kind: 'instruction',
      content: 'Use concise answers.'
    })
    const duplicate = presenter.createDirective('a', {
      kind: 'instruction',
      content: 'Use concise answers.'
    })

    expect(duplicate?.id).toBe(first?.id)
    expect(presenter.listDirectives('a')).toHaveLength(1)
    expect(
      auditRepo.rows.filter((row) => row.event_type === 'memory/directive_create')
    ).toHaveLength(1)
  })

  it('enforces ownership, disabled-runtime isolation, deletion, and input bounds', () => {
    const { presenter } = makePresenter({ memoryEnabled: true })
    const active = presenter.createDirective('a', {
      kind: 'suppress_topic',
      content: 'Do not mention Alpha.',
      topic: 'Alpha'
    })
    expect(active).not.toBeNull()
    expect(presenter.listDirectives('b')).toEqual([])
    expect(presenter.approveDirective('b', active!.id)).toBeNull()
    expect(presenter.deleteDirectiveResult('b', active!.id)).toEqual({
      action: 'rejected',
      reason: 'not-found'
    })
    expect(presenter.deleteDirective('b', active!.id)).toBe(false)
    expect(presenter.deleteDirectiveResult('a', active!.id)).toEqual({ action: 'applied' })
    expect(presenter.listDirectives('a')).toEqual([])

    expect(() =>
      presenter.createDirective('bad/id', {
        kind: 'instruction',
        content: 'Unsafe owner'
      })
    ).toThrow(/invalid agentId/)
    expect(() =>
      presenter.createDirective('a', {
        kind: 'instruction',
        content: 'x'.repeat(AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS + 1)
      })
    ).toThrow(/exceeds/)

    const disabled = makePresenter({ memoryEnabled: false }).presenter
    const disabledDirective = disabled.createDirective('a', {
      kind: 'instruction',
      content: 'Inactive until memory is enabled.'
    })
    expect(disabledDirective).toMatchObject({ status: 'active' })
    expect(disabled.listActiveDirectives('a')).toEqual([])
    expect(disabled.deleteDirective('a', disabledDirective!.id)).toBe(true)
  })

  it('removes invisible controls before a directive can be reviewed or persisted', () => {
    const normalized = normalizeMemoryDirective({
      kind: 'suppress_topic',
      content: 'Keep\u202e\u200b\nanswers visible.',
      topic: 'Project\u202e\u200b\nSaffron'
    })

    expect(normalized.content).toBe('Keep answers visible.')
    expect(normalized.normalizedTopic).toBe('project saffron')
    expect(normalized.content).not.toMatch(/[\p{Cc}\p{Cf}]/u)
    expect(normalized.normalizedTopic).not.toMatch(/[\p{Cc}\p{Cf}]/u)
    expect(() =>
      normalizeMemoryDirective({ kind: 'instruction', content: '\u202e\u200b\n' })
    ).toThrow(/must not be empty/)
    expect(() =>
      normalizeMemoryDirective({
        kind: 'suppress_topic',
        content: 'Suppress compatibility ligatures.',
        topic: '\ufb03'.repeat(AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS)
      })
    ).toThrow(/topic exceeds 512 Unicode code points/)
  })

  it('rejects overbroad single-character CJK suppression topics', () => {
    expect(() =>
      normalizeMemoryDirective({
        kind: 'suppress_topic',
        content: 'Do not recall this broad topic.',
        topic: '工\u200d'
      })
    ).toThrow(/CJK topic requires at least 2 visible characters/)

    expect(
      normalizeMemoryDirective({
        kind: 'suppress_topic',
        content: 'Do not recall this exact topic.',
        topic: '工作'
      })
    ).toMatchObject({ normalizedTopic: '工作' })
  })

  it('returns typed capacity results for explicit creation and draft approval', () => {
    const { presenter } = makePresenter({ memoryEnabled: true })
    for (let index = 0; index < AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT; index += 1) {
      expect(
        presenter.createDirective('a', {
          kind: 'instruction',
          content: `Active directive ${index}`
        })
      ).not.toBeNull()
    }
    const draft = presenter.suggestDirective('a', {
      kind: 'instruction',
      content: 'Pending approval'
    })
    expect(draft).not.toBeNull()

    expect(
      presenter.createDirectiveResult('a', {
        kind: 'instruction',
        content: 'One directive too many'
      })
    ).toEqual({ action: 'rejected', directive: null, reason: 'capacity' })
    expect(presenter.approveDirectiveResult('a', draft!.id)).toEqual({
      action: 'rejected',
      directive: null,
      reason: 'capacity'
    })
  })
})
