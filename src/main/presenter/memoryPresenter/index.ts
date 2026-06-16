import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import {
  DEFAULT_SIMILARITY_THRESHOLD,
  FTS_SIMILARITY_BASELINE,
  isSafeAgentId,
  type AgentMemoryRow,
  type IMemoryVectorStore,
  type MemoryCandidate,
  type MemoryPresenterDeps,
  type MemoryRecallItem,
  type MemoryStatus,
  type WriteMemoriesOptions
} from './types'
import {
  buildMemoryProvenanceKey,
  distanceToSimilarity,
  resolveRetrieval,
  retrievalScore
} from './scoring'
import {
  appendMemorySection,
  buildMemorySection,
  type MemoryInjectionPayload,
  type MemoryInjectionPort,
  type MemoryRuntimePort
} from './injectionPort'
import { buildExtractionPrompt, parseMemoryCandidates } from './extraction'
import { buildReflectionPrompt, sanitizeSelfModel } from './extraction'
import type { MemoryExtractionInput, MemoryExtractionResult, MemoryUpdateReason } from './types'

export { appendMemorySection, buildMemorySection, isSafeAgentId }
export type { MemoryInjectionPayload, MemoryInjectionPort, MemoryRuntimePort }

/** 触发反思的最少（非人格）记忆数。 */
const MIN_MEMORIES_FOR_REFLECTION = 3
/** 每累积 N 条记忆触发一次反思。 */
const REFLECT_EVERY_N_MEMORIES = 5
/** 反思时纳入的记忆条数上限。 */
const REFLECTION_MEMORY_LIMIT = 20

export class MemoryPresenter implements MemoryRuntimePort {
  private readonly vectorStores = new Map<string, IMemoryVectorStore>()

  constructor(private readonly deps: MemoryPresenterDeps) {}

  isEnabled(agentId: string): boolean {
    return this.deps.resolveAgentConfig(agentId)?.memoryEnabled === true
  }

  /** 校验外部传入的 agentId 格式；非法直接抛错（视为调用方 bug / 越权尝试）。 */
  private assertSafeAgentId(agentId: string): void {
    if (!isSafeAgentId(agentId)) {
      throw new Error(`[Memory] invalid agentId: ${JSON.stringify(agentId)}`)
    }
  }

  /** 是否为可管理的真实 DeepChat agent（未提供严格校验依赖时，仅依赖格式校验）。 */
  private isManagedAgent(agentId: string): boolean {
    return this.deps.isManagedAgent ? this.deps.isManagedAgent(agentId) : true
  }

  /** 广播记忆变更（宿主接 typed 事件）；无回调时静默。 */
  private emitChanged(agentId: string, reason: MemoryUpdateReason): void {
    this.deps.onMemoryChanged?.(agentId, reason)
  }

  /**
   * 阶段1（同步、调用方事务内）：写入记忆行（status=pending_embedding），幂等去重。
   * 返回新建（非重复）记忆的 id 列表，供调用方落 tape anchor / 触发阶段2。
   */
  writeMemoriesSync(candidates: MemoryCandidate[], options: WriteMemoriesOptions): string[] {
    if (!candidates.length) return []
    const created: string[] = []
    for (const candidate of candidates) {
      const content = candidate.content.trim()
      if (!content) continue
      const provenanceKey = buildMemoryProvenanceKey(options.agentId, candidate.kind, content)
      if (this.deps.repository.getByProvenanceKey(options.agentId, provenanceKey)) {
        continue
      }
      const id = `mem-${nanoid(12)}`
      try {
        this.deps.repository.insert({
          id,
          agentId: options.agentId,
          kind: candidate.kind,
          content,
          importance: candidate.importance,
          status: 'pending_embedding',
          sourceSession: options.sourceSession ?? null,
          userScope: options.userScope ?? null,
          provenanceKey
        })
        created.push(id)
      } catch (error) {
        // 唯一索引并发冲突 → 视为已存在，跳过
        logger.warn(`[Memory] insert skipped (dedupe/race): ${String(error)}`)
      }
    }
    return created
  }

  /**
   * 阶段2（异步、事务外）：为 pending_embedding 的记忆计算向量并写入向量库，回填状态。
   * 无 embedding 配置 → 标记 fts_only（仍可被 FTS 召回）。
   */
  async processPendingEmbeddings(agentId: string, limit = 50): Promise<void> {
    const config = this.deps.resolveAgentConfig(agentId)
    const pending = this.deps.repository
      .listPendingEmbedding(limit)
      .filter((row) => row.agent_id === agentId)
    if (!pending.length) return

    const embedding = config?.memoryEmbedding
    if (!embedding?.providerId || !embedding?.modelId) {
      for (const row of pending) {
        this.deps.repository.updateStatus(row.id, 'fts_only')
      }
      return
    }

    for (const row of pending) {
      try {
        const vectors = await this.deps.getEmbeddings(embedding.providerId, embedding.modelId, [
          row.content
        ])
        const vector = vectors[0]
        if (!vector?.length) {
          this.deps.repository.updateStatus(row.id, 'error')
          continue
        }
        const store = await this.getVectorStore(agentId, vector.length)
        await store.upsert([{ memoryId: row.id, embedding: vector }])
        this.deps.repository.updateStatus(row.id, 'embedded', {
          embeddingId: row.id,
          embeddingDim: vector.length
        })
      } catch (error) {
        logger.error(`[Memory] embedding failed for ${row.id}: ${String(error)}`)
        this.deps.repository.updateStatus(row.id, 'error')
      }
    }
  }

  /**
   * 从对话片段抽取记忆（独立廉价 LLM 调用）并写入。
   * 返回 { ok:true, createdIds } 表示成功（createdIds 可能为空）；{ ok:false } 表示抽取失败。
   * 失败不抛出、不影响对话主流程，但调用方应据此避免推进记忆游标以便后续重试。
   */
  async extractAndStore(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    // 未启用 / 空片段：视为“成功消费、无新增”，调用方可安全推进游标
    if (!this.isEnabled(input.agentId)) return { ok: true, createdIds: [] }
    const span = input.spanText.trim()
    if (!span) return { ok: true, createdIds: [] }
    try {
      const response = await this.deps.generateText(
        input.model.providerId,
        input.model.modelId,
        buildExtractionPrompt(span)
      )
      const candidates = parseMemoryCandidates(response)
      const created = candidates.length
        ? this.writeMemoriesSync(candidates, {
            agentId: input.agentId,
            sourceSession: input.sourceSession ?? null
          })
        : []
      if (created.length) {
        this.emitChanged(input.agentId, 'extract')
        // 阶段2：异步向量化，不阻塞调用方
        void this.processPendingEmbeddings(input.agentId).catch((error) => {
          logger.warn(`[Memory] background embedding failed: ${String(error)}`)
        })
      }
      return { ok: true, createdIds: created }
    } catch (error) {
      // 模型调用 / 解析失败：返回 ok:false，调用方据此保持游标不变以便后续重试
      logger.warn(`[Memory] extraction failed: ${String(error)}`)
      return { ok: false }
    }
  }

  /**
   * 显式记忆写入（`memory_remember` 工具路径）：写入 + 异步向量化 + 广播变更。
   * 与自动抽取共用 'extract' 变更原因（订阅方仅据 agentId 决定刷新，不区分细分原因）。
   */
  async rememberMemory(
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions
  ): Promise<string[]> {
    const created = this.writeMemoriesSync([candidate], options)
    if (created.length) {
      this.emitChanged(options.agentId, 'extract')
      void this.processPendingEmbeddings(options.agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
    }
    return created
  }

  /**
   * 检索：向量（仅 embedded）+ FTS 混合召回，按综合打分取 top-K。
   * 无 embedding 配置时退化为纯 FTS。
   */
  async recall(agentId: string, query: string, now = Date.now()): Promise<MemoryRecallItem[]> {
    const config = this.deps.resolveAgentConfig(agentId)
    const { topK, weights } = resolveRetrieval(config?.memoryRetrieval)
    const normalizedQuery = query.trim()

    const scored = new Map<string, MemoryRecallItem>()

    // FTS 召回（embedded | fts_only | error 均可，只要有 content）
    if (normalizedQuery) {
      for (const row of this.deps.repository.search(agentId, normalizedQuery, topK * 2)) {
        scored.set(row.id, this.toRecallItem(row, FTS_SIMILARITY_BASELINE, now, weights))
      }
    }

    // 向量召回（仅 embedded）
    const embedding = config?.memoryEmbedding
    if (normalizedQuery && embedding?.providerId && embedding?.modelId) {
      try {
        const vectors = await this.deps.getEmbeddings(embedding.providerId, embedding.modelId, [
          normalizedQuery
        ])
        const vector = vectors[0]
        if (vector?.length) {
          const store = await this.getVectorStore(agentId, vector.length)
          const matches = await store.query(vector, { topK: topK * 2 })
          for (const match of matches) {
            const similarity = distanceToSimilarity(match.distance)
            if (similarity < DEFAULT_SIMILARITY_THRESHOLD) continue
            const row = this.deps.repository.getById(match.memoryId)
            if (!row || row.superseded_by) continue
            // 向量相似度优先于 FTS 基线
            scored.set(row.id, this.toRecallItem(row, similarity, now, weights))
          }
        }
      } catch (error) {
        logger.warn(`[Memory] vector recall failed, FTS only: ${String(error)}`)
      }
    }

    const results = Array.from(scored.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    for (const item of results) {
      this.deps.repository.recordAccess(item.id, now)
    }
    return results
  }

  /** 组装 Layer 4 注入载荷：常驻自我模型 + top-K 召回。 */
  async buildInjection(agentId: string, query: string): Promise<MemoryInjectionPayload | null> {
    if (!this.isEnabled(agentId)) return null
    const persona = this.deps.repository.getActivePersona(agentId)
    const recalled = await this.recall(agentId, query)
    if (!persona && recalled.length === 0) return null
    return {
      selfModel: persona?.content ?? null,
      memories: recalled.map((item) => ({ id: item.id, kind: item.kind, content: item.content }))
    }
  }

  // ==================== 人格演化 ====================

  /**
   * 反思并演化自我模型（人格的核心）。节流：仅在记忆量跨过阈值倍数、或尚无人格时触发。
   * createdCount = 本轮新写入的记忆数，用于判断是否"跨过"反思阈值。
   * 返回新人格版本 id，或 null（未触发 / 失败）。独立廉价 LLM 调用，失败不抛。
   */
  async maybeReflect(
    agentId: string,
    model: { providerId: string; modelId: string },
    createdCount: number
  ): Promise<string | null> {
    if (!this.isEnabled(agentId)) return null
    try {
      const active = this.deps.repository
        .listByAgent(agentId)
        .filter((row) => row.kind !== 'persona')
      if (active.length < MIN_MEMORIES_FOR_REFLECTION) return null

      const previous = this.deps.repository.getActivePersona(agentId)
      const before = Math.max(0, active.length - Math.max(0, createdCount))
      const crossed =
        Math.floor(before / REFLECT_EVERY_N_MEMORIES) <
        Math.floor(active.length / REFLECT_EVERY_N_MEMORIES)
      const shouldReflect = (!previous && active.length >= MIN_MEMORIES_FOR_REFLECTION) || crossed
      if (!shouldReflect) return null

      const top = active
        .slice()
        .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
        .slice(0, REFLECTION_MEMORY_LIMIT)
      const selfModelText = await this.deps.generateText(
        model.providerId,
        model.modelId,
        buildReflectionPrompt(
          previous?.content ?? null,
          top.map((row) => row.content)
        )
      )
      const sanitized = sanitizeSelfModel(selfModelText)
      if (!sanitized) return null
      return this.evolvePersona(agentId, sanitized)
    } catch (error) {
      logger.warn(`[Memory] reflection skipped: ${String(error)}`)
      return null
    }
  }

  /** 写入新自我模型版本，旧版本 superseded。锚点（is_anchor）不参与替换。 */
  evolvePersona(agentId: string, content: string, sourceSession?: string | null): string | null {
    const trimmed = content.trim()
    if (!trimmed) return null
    const previous = this.deps.repository.getActivePersona(agentId)
    const id = `persona-${nanoid(12)}`
    this.deps.repository.insert({
      id,
      agentId,
      kind: 'persona',
      content: trimmed,
      importance: 1,
      status: 'fts_only',
      sourceSession: sourceSession ?? null
    })
    if (previous && previous.is_anchor === 0) {
      this.deps.repository.markSuperseded(previous.id, id)
    }
    this.emitChanged(agentId, 'persona-evolve')
    return id
  }

  listPersonaVersions(agentId: string): AgentMemoryRow[] {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return []
    return this.deps.repository.listPersonaVersions(agentId)
  }

  /** 回滚：将指定历史 persona 版本设为 active（清除其 superseded_by），并 supersede 当前 active。 */
  rollbackPersona(agentId: string, versionId: string): boolean {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    const target = this.deps.repository.getById(versionId)
    if (!target || target.agent_id !== agentId || target.kind !== 'persona') return false
    const current = this.deps.repository.getActivePersona(agentId)
    if (current && current.id !== versionId && current.is_anchor === 0) {
      this.deps.repository.markSuperseded(current.id, versionId)
    }
    this.deps.repository.markSuperseded(versionId, null)
    this.emitChanged(agentId, 'persona-rollback')
    return true
  }

  // ==================== 管理 ====================

  listMemories(agentId: string): AgentMemoryRow[] {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return []
    return this.deps.repository.listByAgent(agentId)
  }

  async deleteMemory(agentId: string, memoryId: string): Promise<boolean> {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    const row = this.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    this.deps.repository.delete(memoryId)
    const store = this.vectorStores.get(agentId)
    if (store) {
      await store.deleteByMemoryIds([memoryId]).catch((error) => {
        logger.warn(`[Memory] vector delete failed: ${String(error)}`)
      })
    }
    this.emitChanged(agentId, 'delete')
    return true
  }

  async clearMemories(agentId: string): Promise<number> {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return 0
    const removed = this.deps.repository.clearByAgent(agentId)
    const store = this.vectorStores.get(agentId)
    if (store) {
      await store.clear().catch((error) => {
        logger.warn(`[Memory] vector clear failed: ${String(error)}`)
      })
    }
    if (removed > 0) this.emitChanged(agentId, 'clear')
    return removed
  }

  getStatus(agentId: string): MemoryStatus {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) {
      return { total: 0, pendingEmbedding: 0, hasPersona: false }
    }
    const all = this.deps.repository.listByAgent(agentId, { includeSuperseded: true })
    return {
      total: all.length,
      pendingEmbedding: all.filter((row) => row.status === 'pending_embedding').length,
      hasPersona: all.some((row) => row.kind === 'persona' && !row.superseded_by)
    }
  }

  async dispose(): Promise<void> {
    for (const store of this.vectorStores.values()) {
      await store.close().catch(() => undefined)
    }
    this.vectorStores.clear()
  }

  // ==================== 内部 ====================

  private toRecallItem(
    row: AgentMemoryRow,
    similarity: number,
    now: number,
    weights: { similarity: number; recency: number; importance: number }
  ): MemoryRecallItem {
    return {
      id: row.id,
      kind: row.kind,
      content: row.content,
      importance: row.importance,
      score: retrievalScore(row, similarity, now, weights)
    }
  }

  private async getVectorStore(agentId: string, dimensions: number): Promise<IMemoryVectorStore> {
    const existing = this.vectorStores.get(agentId)
    if (existing) return existing
    const store = await this.deps.createVectorStore(agentId, dimensions)
    this.vectorStores.set(agentId, store)
    return store
  }
}
