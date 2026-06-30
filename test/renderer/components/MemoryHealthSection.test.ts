import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { MemoryHealthDto } from '@shared/contracts/routes'
import { createEmptyMemoryHealth } from '@shared/contracts/routes'
import MemoryHealthSection from '../../../src/renderer/settings/components/MemoryHealthSection.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key
  })
}))

vi.mock('@shadcn/components/ui/badge', () => ({
  Badge: {
    name: 'Badge',
    template: '<span><slot /></span>'
  }
}))

const loadedHealth: MemoryHealthDto = {
  ...createEmptyMemoryHealth(),
  totalRows: 2,
  byKind: { episodic: 0, semantic: 2, reflection: 0, persona: 0, working: 0 },
  byCategory: {
    user_preference: 0,
    project_fact: 1,
    task_outcome: 0,
    heuristic: 0,
    anti_pattern: 0,
    uncategorized: 1
  },
  byStatus: {
    pending_embedding: 0,
    embedded: 2,
    error: 0,
    fts_only: 0,
    archived: 0,
    conflicted: 0
  },
  embeddings: { pending: 0, error: 0, ftsOnly: 0, stale: 1 },
  lifecycle: { archiveCandidates: 1, archived: 0 },
  access: {
    topAccessed: [
      {
        id: 'm1',
        kind: 'semantic',
        category: 'project_fact',
        content: 'repo uses pnpm',
        importance: 0.6,
        accessCount: 3,
        lastAccessed: 0
      }
    ],
    neverAccessed: 1
  },
  quality: { importanceAvg: 0.55, importanceMedian: null, confidenceAvg: null },
  maintenance: {
    completed: 1,
    skipped: 1,
    failed: 1,
    scanLimit: 200,
    recentFailures: [
      {
        eventType: 'memory/maintenance_llm',
        status: 'failed',
        reason: 'model unavailable',
        createdAt: Date.UTC(2026, 0, 15, 12, 0)
      }
    ]
  }
}

function mountSection(props: {
  health: MemoryHealthDto | null
  loading?: boolean
  error?: string | null
}) {
  return mount(MemoryHealthSection, {
    props: {
      health: props.health,
      loading: props.loading ?? false,
      error: props.error ?? null
    }
  })
}

describe('MemoryHealthSection', () => {
  it('renders the loading state', () => {
    const wrapper = mountSection({ health: null, loading: true })

    expect(wrapper.text()).toContain('common.loading')
    expect(wrapper.text()).not.toContain('settings.deepchatAgents.memoryManager.emptyHealth')
  })

  it('renders the error state', () => {
    const wrapper = mountSection({ health: null, error: 'health unavailable' })

    expect(wrapper.text()).toContain('health unavailable')
  })

  it('renders the empty state when health is null', () => {
    const wrapper = mountSection({ health: null })

    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.emptyHealth')
  })

  it('renders zero health without NaN distribution widths', () => {
    const wrapper = mountSection({ health: createEmptyMemoryHealth() })
    const bars = wrapper
      .findAll('div')
      .map((element) => element.attributes('style'))
      .filter((style): style is string => Boolean(style?.includes('width')))

    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.emptyHealth')
    expect(wrapper.text()).not.toContain('NaN')
    expect(bars.length).toBeGreaterThan(0)
    expect(bars.every((style) => style.includes('width: 0%'))).toBe(true)
  })

  it('renders loaded metrics, top accessed preview, recent failures, and placeholders', () => {
    const wrapper = mountSection({ health: loadedHealth })

    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.health.totalRows')
    expect(wrapper.text()).toContain('settings.deepchatAgents.memoryManager.health.byKind')
    expect(wrapper.text()).toContain('repo uses pnpm')
    expect(wrapper.text()).toContain('Jan')
    expect(wrapper.text()).toContain('memory/maintenance_llm')
    expect(wrapper.text()).toContain('model unavailable')
    expect(wrapper.text()).toContain('—')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
