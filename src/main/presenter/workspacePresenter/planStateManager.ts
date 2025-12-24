import crypto from 'crypto'
import { nanoid } from 'nanoid'
import type {
  WorkspacePlanEntry,
  WorkspacePlanStatus,
  WorkspaceRawPlanEntry
} from '@shared/presenter'

// Maximum number of completed entries to retain per conversation
const MAX_COMPLETED_ENTRIES = 10

/**
 * Plan State Manager
 * Maintains plan entries for each conversation, supports incremental updates
 */
export class PlanStateManager {
  // Map<conversationId, Map<contentHash, WorkspacePlanEntry>>
  private readonly planStore = new Map<string, Map<string, WorkspacePlanEntry>>()

  /**
   * Update plan entries (incremental merge)
   * @param conversationId Conversation ID
   * @param rawEntries Raw plan entries
   * @returns Updated complete entries list
   */
  updateEntries(conversationId: string, rawEntries: WorkspaceRawPlanEntry[]): WorkspacePlanEntry[] {
    if (!this.planStore.has(conversationId)) {
      this.planStore.set(conversationId, new Map())
    }
    const store = this.planStore.get(conversationId)!

    for (const raw of rawEntries) {
      const contentKey = this.hashContent(raw.content)
      const existing = store.get(contentKey)

      if (existing) {
        // Update existing entry status
        existing.status = this.normalizeStatus(raw.status)
        existing.priority = raw.priority ?? existing.priority
        existing.updatedAt = Date.now()
      } else {
        // Add new entry
        store.set(contentKey, {
          id: nanoid(8),
          content: raw.content,
          status: this.normalizeStatus(raw.status),
          priority: raw.priority ?? null,
          updatedAt: Date.now()
        })
      }
    }

    // Cleanup: keep only the latest MAX_COMPLETED_ENTRIES completed entries
    this.pruneCompletedEntries(store)

    return this.getEntries(conversationId)
  }

  /**
   * Get all plan entries for a conversation
   */
  getEntries(conversationId: string): WorkspacePlanEntry[] {
    const store = this.planStore.get(conversationId)
    if (!store) return []
    return Array.from(store.values())
  }

  /**
   * Clear conversation data
   */
  clear(conversationId: string): void {
    this.planStore.delete(conversationId)
  }

  /**
   * Prune completed entries, keeping only the latest MAX_COMPLETED_ENTRIES
   */
  private pruneCompletedEntries(store: Map<string, WorkspacePlanEntry>): void {
    const completedEntries: Array<{ key: string; entry: WorkspacePlanEntry }> = []

    for (const [key, entry] of store) {
      if (entry.status === 'completed') {
        completedEntries.push({ key, entry })
      }
    }

    // If completed entries exceed the limit, remove oldest ones
    if (completedEntries.length > MAX_COMPLETED_ENTRIES) {
      // Sort by updatedAt ascending (oldest first)
      completedEntries.sort((a, b) => a.entry.updatedAt - b.entry.updatedAt)

      // Remove oldest entries beyond the limit
      const toRemove = completedEntries.slice(0, completedEntries.length - MAX_COMPLETED_ENTRIES)
      for (const { key } of toRemove) {
        store.delete(key)
      }
    }
  }

  /**
   * Hash content using SHA-256 for reliable deduplication
   */
  private hashContent(content: string): string {
    const normalized = content.trim().toLowerCase()
    return crypto.createHash('sha256').update(normalized).digest('hex')
  }

  private normalizeStatus(status?: string | null): WorkspacePlanStatus {
    switch (status) {
      case 'completed':
      case 'done':
        return 'completed'
      case 'in_progress':
        return 'in_progress'
      case 'failed':
        return 'failed'
      case 'skipped':
        return 'skipped'
      default:
        return 'pending'
    }
  }
}
