import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import { buildMemoryProvenanceKey } from '../core/scoring'
import { estimateTokens } from '../core/injectionPort'
import { WORKING_BLOB_TOKEN_LIMIT, WORKING_PROVENANCE_SEED } from '../runtimeConstants'
import { isUniqueConstraintError, type MemoryRuntimeContext } from '../context'
import type { WorkingMemoryReadPort } from '../ports'

export class WorkingMemoryService implements WorkingMemoryReadPort {
  private readonly workingRefreshInFlight = new Set<string>()

  constructor(private readonly ctx: MemoryRuntimeContext) {}

  readWorkingMemory(agentId: string): string | null {
    const row = this.ctx.deps.repository.getByProvenanceKey(agentId, this.workingMemoryKey(agentId))
    const content = row?.content?.trim()
    return content ? content : null
  }

  workingMemoryKey(agentId: string): string {
    return buildMemoryProvenanceKey(agentId, 'working', WORKING_PROVENANCE_SEED)
  }

  deleteWorkingMemory(agentId: string): void {
    const existing = this.ctx.deps.repository.getByProvenanceKey(
      agentId,
      this.workingMemoryKey(agentId)
    )
    if (existing) this.ctx.deps.repository.delete(existing.id)
  }

  syncWorkingMemoryAfterMutation(agentId: string): void {
    if (this.ctx.isDisposed) return
    if (this.ctx.canReadAgentMemory(agentId)) this.refreshWorkingMemory(agentId)
    else this.deleteWorkingMemory(agentId)
  }

  scheduleWorkingRefresh(agentId: string): void {
    if (!this.ctx.canReadAgentMemory(agentId)) return
    if (this.workingRefreshInFlight.has(agentId)) return
    this.workingRefreshInFlight.add(agentId)
    void Promise.resolve()
      .then(() => {
        if (this.ctx.canReadAgentMemory(agentId)) {
          this.refreshWorkingMemory(agentId)
        }
      })
      .catch((error) => {
        logger.warn(`[Memory] working refresh skipped: ${String(error)}`)
      })
      .finally(() => {
        this.workingRefreshInFlight.delete(agentId)
      })
  }

  refreshWorkingMemory(agentId: string): void {
    if (!this.ctx.canReadAgentMemory(agentId)) return
    const workingKey = this.workingMemoryKey(agentId)
    const existing = this.ctx.deps.repository.getByProvenanceKey(agentId, workingKey)
    const blob = this.buildWorkingBlob(agentId)
    if (!blob) {
      if (existing) this.ctx.deps.repository.delete(existing.id)
      return
    }
    if (existing) {
      if (existing.content === blob) return
      this.ctx.deps.repository.updateContent(existing.id, blob, workingKey, Date.now())
      return
    }
    const now = Date.now()
    try {
      this.ctx.deps.repository.insert({
        id: `working-${nanoid(12)}`,
        agentId,
        kind: 'working',
        content: blob,
        importance: 0,
        status: 'fts_only',
        provenanceKey: workingKey,
        createdAt: now
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  }

  buildWorkingBlob(agentId: string): string {
    const units = this.ctx.deps.repository
      .listByAgent(agentId, { kinds: ['semantic', 'reflection', 'episodic'] })
      .slice()
      .sort(
        (a, b) =>
          b.importance - a.importance ||
          b.access_count - a.access_count ||
          b.created_at - a.created_at
      )
    const lines: string[] = []
    let tokens = 0
    for (const unit of units) {
      const content = unit.content.trim()
      if (!content) continue
      const line = `- ${content}`
      const cost = estimateTokens(line)
      if (tokens + cost > WORKING_BLOB_TOKEN_LIMIT) continue
      lines.push(line)
      tokens += cost
    }
    return lines.join('\n').trim()
  }

  cleanupAgent(agentId: string): void {
    this.workingRefreshInFlight.delete(agentId)
  }

  /** @internal Live mutable state for legacy facade-oracle tests only. */
  getMutableRuntimeStateForTests(): { workingRefreshInFlight: Set<string> } {
    return { workingRefreshInFlight: this.workingRefreshInFlight }
  }
}
