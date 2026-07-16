import { vi } from 'vitest'

import { MemoryService as BaseMemoryService } from '@/memory'
import type { ConflictService } from '@/memory/services/conflictService'
import type { MaintenanceService } from '@/memory/services/maintenanceService'
import type { MemoryDiagnosticsCollector } from '@/memory/infra/diagnostics/memoryDiagnosticsCollector'
import type { VectorStoreManager } from '@/memory/infra/vectorStoreManager'
import type { MemoryServiceDeps } from '@/memory/types'
import type { AgentMemoryRow } from '@/memory/domain/types'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  createFakeRepository,
  FakeAuditRepository,
  FakeVectorStore,
  textToVector,
  type FakeRepository
} from './support/memoryFakes'

export const DAY = 24 * 60 * 60 * 1000

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export class MemoryService extends BaseMemoryService {
  constructor(deps: ConstructorParameters<typeof BaseMemoryService>[0]) {
    super({ executeWithRateLimit: vi.fn(async () => undefined), ...deps })
  }
}

export const embeddingDimensions = async () => ({
  data: { dimensions: textToVector('').length, normalized: false }
})

export async function waitForMemoryCondition(
  condition: () => boolean,
  message = 'memory background condition was not met'
): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

export async function flushMicrotasks(cycles = 3): Promise<void> {
  for (let index = 0; index < cycles; index += 1) await Promise.resolve()
}

type MemoryServiceRuntimeTestSeams = {
  embedding: {
    warmVectorStore(
      agentId: string,
      embedding: { providerId: string; modelId: string }
    ): Promise<void>
    warmEmbeddingConnection(
      agentId: string,
      embedding: { providerId: string; modelId: string }
    ): void
    abandonAgent(agentId: string): void
    cleanupAgent(agentId: string): Promise<void>
  }
  vectorStore: VectorStoreManager
  conflict: Pick<ConflictService, 'repairConflictIntegrity' | 'runChallengeResolutionPass'>
  maintenance: Pick<MaintenanceService, 'clearCooldown'>
  diagnostics: Pick<MemoryDiagnosticsCollector, 'cleanupAgent'>
}

export function memoryRuntimeForTests(presenter: MemoryService) {
  const internals = presenter as unknown as MemoryServiceRuntimeTestSeams
  return {
    embeddingService: internals.embedding,
    vectorStoreService: internals.vectorStore,
    conflictService: internals.conflict,
    maintenanceService: internals.maintenance,
    diagnosticsCollector: internals.diagnostics,
    isVectorReady: (
      agentId: string,
      embedding: { providerId: string; modelId: string } = { providerId: 'p', modelId: 'm' }
    ) => internals.vectorStore.hasReadyCertificate(agentId, embedding),
    warmEmbeddingConnection: (
      agentId: string,
      embedding: { providerId: string; modelId: string }
    ) => internals.embedding.warmEmbeddingConnection(agentId, embedding),
    clearVectorStoreReady: (agentId: string) => internals.vectorStore.clearReady(agentId)
  }
}

export const embeddingConfig: DeepChatAgentConfig = {
  memoryEnabled: true,
  memoryEmbedding: { providerId: 'p', modelId: 'm' },
  memoryExtractionModel: { providerId: 'main', modelId: 'main' }
}

export function makeRow(id: string, overrides: Partial<AgentMemoryRow> = {}): AgentMemoryRow {
  return {
    id,
    agent_id: 'a',
    user_scope: null,
    kind: 'semantic',
    category: null,
    content: id,
    importance: 0.5,
    status: 'embedded',
    embedding_id: id,
    embedding_dim: textToVector('').length,
    embedding_model: 'p:m',
    source_session: null,
    provenance_key: null,
    is_anchor: 0,
    superseded_by: null,
    created_at: 1000,
    last_accessed: null,
    access_count: 0,
    decay_score: null,
    source_entry_ids: null,
    confidence: null,
    last_consolidated_at: null,
    conflict_state: null,
    conflict_with: null,
    persona_state: null,
    decision_revision: 1,
    ...overrides
  }
}

type RoutedLLMResponses = {
  extraction?: string
  decision?: string | string[]
  throwDecision?: boolean
}

export function routedLLM(responses: RoutedLLMResponses) {
  let decisionCursor = 0
  return vi.fn(async (_providerId: string, _modelId: string, prompt: string) => {
    if (prompt.includes('KEEP or SKIP')) return 'KEEP'
    if (prompt.includes('Choose exactly ONE decision')) {
      if (responses.throwDecision) throw new Error('decision failed')
      const configuredDecision =
        responses.decision ?? '{"decision":"NOOP","targetIndex":0,"mergedContent":null}'
      if (!prompt.includes('for every candidate')) {
        if (!Array.isArray(configuredDecision)) return configuredDecision
        const result = configuredDecision[Math.min(decisionCursor, configuredDecision.length - 1)]
        decisionCursor += 1
        return result
      }
      const decisions = Array.isArray(configuredDecision)
        ? configuredDecision
        : [configuredDecision]
      const candidates = [...prompt.matchAll(/^Candidate (\d+) /gmu)]
      const decisionOffset = Array.isArray(configuredDecision)
        ? Math.max(0, candidates.length - decisions.length)
        : 0
      const result = JSON.stringify(
        candidates.map((match, index) => {
          if (Array.isArray(configuredDecision) && index < decisionOffset) {
            return {
              candidateIndex: Number(match[1]),
              decision: 'ADD',
              targetIndex: null,
              mergedContent: null
            }
          }
          const selectedIndex = Array.isArray(configuredDecision)
            ? Math.min(decisionCursor + index - decisionOffset, decisions.length - 1)
            : 0
          const parsed = JSON.parse(decisions[selectedIndex]) as Record<string, unknown>
          return { candidateIndex: Number(match[1]), ...parsed }
        })
      )
      if (Array.isArray(configuredDecision)) decisionCursor += candidates.length
      return result
    }
    if (prompt.includes('JSON array')) return responses.extraction ?? '[]'
    return ''
  })
}

export function decisionCalls(generateText: ReturnType<typeof vi.fn>): number {
  return generateText.mock.calls.filter((call) =>
    String(call[2]).includes('Choose exactly ONE decision')
  ).length
}

export function makeLLMPresenter(
  generateText: MemoryServiceDeps['generateText'],
  config: DeepChatAgentConfig | null = embeddingConfig,
  repo: FakeRepository = createFakeRepository(),
  auditRepo: FakeAuditRepository = new FakeAuditRepository()
) {
  const store = new FakeVectorStore()
  const getEmbeddings = vi.fn(async (_providerId: string, _modelId: string, texts: string[]) =>
    texts.map((text) => textToVector(text))
  )
  const presenter = new MemoryService({
    repository: repo,
    auditRepository: auditRepo,
    resolveAgentConfig: () => config,
    resolveAgentDefaultModel: () => ({ providerId: 'main', modelId: 'main' }),
    executeWithRateLimit: vi.fn(async () => undefined),
    getEmbeddings,
    getDimensions: async () => ({
      data: { dimensions: textToVector('').length, normalized: false }
    }),
    generateText,
    createVectorStore: async () => store,
    resetVectorStore: async () => {
      store.vectors.clear()
    }
  })
  return { presenter, repo, auditRepo, store, getEmbeddings }
}

export async function seedEmbedded(presenter: MemoryService, content: string): Promise<string> {
  const [id] = presenter.writeMemoriesSync([{ kind: 'semantic', content }], { agentId: 'a' })
  if (!id) throw new Error('expected memory seed to be created')
  await presenter.processPendingEmbeddings('a')
  return id
}

export function seedConflicted(
  repo: FakeRepository,
  challengerId: string,
  targetId: string,
  content: string
): void {
  repo.insert({
    id: challengerId,
    agentId: 'a',
    kind: 'semantic',
    content,
    status: 'conflicted',
    conflictWith: targetId
  })
  repo.seedConflictState(targetId, 'challenged')
}
