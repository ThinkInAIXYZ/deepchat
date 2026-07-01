import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type {
  MemoryArchiveCandidateLifecyclePreview,
  MemoryHealthDto,
  MemoryLifecycle
} from '@shared/contracts/routes'
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

interface SettingsJson {
  deepchatAgents?: {
    memoryManager?: {
      health?: { archivePrediction?: Record<string, unknown> }
    }
  }
}

type SettingsModule = SettingsJson | { default: SettingsJson }

const settingsModules = import.meta.glob<SettingsModule>(
  '../../../src/renderer/src/i18n/*/settings.json',
  { eager: true }
)

function resolveSettingsModule(module: SettingsModule): SettingsJson {
  if (module && typeof module === 'object' && 'default' in module) return module.default
  return module
}

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

const archiveCandidateLifecycle: MemoryLifecycle = {
  memoryId: 'archive-candidate-1',
  kind: 'semantic',
  status: 'embedded',
  recallable: true,
  decayTier: 'archive_candidate',
  recall: {
    weights: { similarity: 0.6, recency: 0.25, importance: 0.15 },
    similarity: 0.3,
    similaritySource: 'baseline',
    recency: 0.1,
    importance: 0.5,
    confidenceFactor: 1,
    importanceFloor: 0.075,
    final: 0.2,
    flooredByImportance: false,
    halfLifeMs: 14 * 24 * 60 * 60 * 1000
  },
  forget: {
    anchorAt: 1000,
    ageDays: 120,
    halfLifeDays: 45,
    decayScore: 0.02,
    materializedDecay: null,
    materializedStale: true
  },
  archiveEligibility: {
    eligible: true,
    oldEnough: true,
    decayedEnough: true,
    neverAccessed: true,
    active: true,
    exempt: false,
    exemptReasons: [],
    gaps: {}
  }
}

const archiveCandidateLifecyclePreview: MemoryArchiveCandidateLifecyclePreview = {
  lifecycles: [archiveCandidateLifecycle],
  previewLimit: 25,
  scanLimit: 200,
  scanned: 1,
  previewTruncated: false,
  scanTruncated: false
}

function mountSection(props: {
  health: MemoryHealthDto | null
  loading?: boolean
  error?: string | null
  archiveCandidateLifecyclePreview?: MemoryArchiveCandidateLifecyclePreview | null
  archiveCandidateLifecyclePreviewLoading?: boolean
  archiveCandidateLifecyclePreviewError?: string | null
}) {
  return mount(MemoryHealthSection, {
    props: {
      health: props.health,
      loading: props.loading ?? false,
      error: props.error ?? null,
      archiveCandidateLifecyclePreview: props.archiveCandidateLifecyclePreview,
      archiveCandidateLifecyclePreviewLoading: props.archiveCandidateLifecyclePreviewLoading,
      archiveCandidateLifecyclePreviewError: props.archiveCandidateLifecyclePreviewError
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

  it('renders archive candidate lifecycle preview states without memory content', () => {
    const loaded = mountSection({
      health: loadedHealth,
      archiveCandidateLifecyclePreview
    })

    expect(loaded.text()).toContain(
      'settings.deepchatAgents.memoryManager.health.archivePrediction.title'
    )
    expect(loaded.text()).toContain('archive-candidate-1')
    expect(loaded.text()).toContain(
      'settings.deepchatAgents.memoryManager.lifecycle.tier.archive_candidate'
    )
    expect(loaded.text()).toContain(
      'settings.deepchatAgents.memoryManager.health.archivePrediction.decayScore'
    )
    expect(loaded.text()).not.toContain('repo uses pnpm archive-candidate-1')

    const loading = mountSection({
      health: loadedHealth,
      archiveCandidateLifecyclePreviewLoading: true
    })
    expect(loading.text()).toContain('common.loading')

    const error = mountSection({
      health: loadedHealth,
      archiveCandidateLifecyclePreviewError: 'candidate unavailable'
    })
    expect(error.text()).toContain('candidate unavailable')

    const empty = mountSection({
      health: loadedHealth,
      archiveCandidateLifecyclePreview: {
        ...archiveCandidateLifecyclePreview,
        lifecycles: [],
        scanned: 0
      }
    })
    expect(empty.text()).toContain(
      'settings.deepchatAgents.memoryManager.health.archivePrediction.empty'
    )

    const scanLimited = mountSection({
      health: loadedHealth,
      archiveCandidateLifecyclePreview: {
        ...archiveCandidateLifecyclePreview,
        scanned: 200,
        scanTruncated: true
      }
    })
    expect(scanLimited.text()).toContain(
      'settings.deepchatAgents.memoryManager.health.archivePrediction.scanLimited'
    )

    const previewLimited = mountSection({
      health: loadedHealth,
      archiveCandidateLifecyclePreview: {
        ...archiveCandidateLifecyclePreview,
        lifecycles: Array.from({ length: 25 }, (_, index) => ({
          ...archiveCandidateLifecycle,
          memoryId: `archive-candidate-${index}`
        })),
        scanned: 40,
        previewTruncated: true,
        scanTruncated: false
      }
    })
    expect(previewLimited.text()).toContain(
      'settings.deepchatAgents.memoryManager.health.archivePrediction.previewLimited'
    )
    expect(previewLimited.text()).not.toContain(
      'settings.deepchatAgents.memoryManager.health.archivePrediction.scanLimited'
    )

    const exactlyFull = mountSection({
      health: loadedHealth,
      archiveCandidateLifecyclePreview: {
        ...archiveCandidateLifecyclePreview,
        lifecycles: Array.from({ length: 25 }, (_, index) => ({
          ...archiveCandidateLifecycle,
          memoryId: `exact-candidate-${index}`
        })),
        scanned: 25,
        previewTruncated: false
      }
    })
    expect(exactlyFull.text()).not.toContain(
      'settings.deepchatAgents.memoryManager.health.archivePrediction.previewLimited'
    )
  })

  it('keeps archive prediction locale strings local and free of review-model terms', () => {
    const bannedPatterns = [
      /\breview\b/i,
      /\bnext review\b/i,
      /\breview interval\b/i,
      /\breinforcement\b/i,
      /\bpromotion\b/i,
      /复习|晋级|回顾|下一次|倒计时/
    ]
    const requiredKeys = [
      'title',
      'description',
      'empty',
      'decayScore',
      'ageDays',
      'scanLimited',
      'previewLimited'
    ]
    const failures: string[] = []

    if (Object.keys(settingsModules).length === 0) failures.push('missing locale modules')

    for (const [settingsPath, settingsModule] of Object.entries(settingsModules)) {
      const locale = settingsPath.match(/\/i18n\/([^/]+)\/settings\.json$/)?.[1] ?? settingsPath
      const settings = resolveSettingsModule(settingsModule)
      const messages = settings.deepchatAgents?.memoryManager?.health?.archivePrediction
      if (!messages) {
        failures.push(`${locale}: missing archivePrediction`)
        continue
      }

      for (const key of requiredKeys) {
        const value = messages[key]
        if (typeof value !== 'string' || value.trim().length === 0) {
          failures.push(`${locale}.archivePrediction.${key}: missing local text`)
          continue
        }
        for (const pattern of bannedPatterns) {
          if (pattern.test(value)) failures.push(`${locale}.archivePrediction.${key}: ${value}`)
        }
      }
    }

    expect(failures).toEqual([])
  })
})
