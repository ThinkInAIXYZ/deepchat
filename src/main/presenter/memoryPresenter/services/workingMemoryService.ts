import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import { buildMemoryProvenanceKey } from '../core/scoring'
import { estimateTokens } from '../core/injectionPort'
import {
  WORKING_BLOB_TOKEN_LIMIT,
  WORKING_CANDIDATE_PAGE_LIMIT,
  WORKING_CANDIDATE_SCAN_LIMIT,
  WORKING_PROVENANCE_SEED
} from '../runtimeConstants'
import { isUniqueConstraintError, type MemoryRuntimeContext } from '../context'
import type { WorkingMemoryReadPort } from '../ports'
import type { AgentMemoryWorkingCandidateCursor } from '../types'

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
    const lines: string[] = []
    let tokens = 0
    let scanned = 0
    let cursor: AgentMemoryWorkingCandidateCursor | undefined
    while (scanned < WORKING_CANDIDATE_SCAN_LIMIT && tokens < WORKING_BLOB_TOKEN_LIMIT) {
      const pageLimit = Math.min(
        WORKING_CANDIDATE_PAGE_LIMIT,
        WORKING_CANDIDATE_SCAN_LIMIT - scanned
      )
      const units = this.ctx.deps.repository.listWorkingCandidates(agentId, pageLimit, cursor)
      if (!units.length) break
      scanned += units.length
      for (const unit of units) {
        const content = unit.content.trim()
        if (!content) continue
        const line = `- ${content}`
        const cost = estimateTokens(line)
        if (tokens + cost > WORKING_BLOB_TOKEN_LIMIT) continue
        lines.push(line)
        tokens += cost
        if (tokens >= WORKING_BLOB_TOKEN_LIMIT) break
      }
      const last = units[units.length - 1]
      cursor = {
        importance: last.importance,
        accessCount: last.access_count,
        createdAt: last.created_at,
        id: last.id
      }
      if (units.length < pageLimit) break
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
