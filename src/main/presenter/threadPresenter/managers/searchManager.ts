/**
 * Deprecated SearchManager
 * The legacy web search flow has been replaced by Yo Browser.
 * Original implementation is available in searchManager.ts.backup for reference.
 */

import type { SearchEngineTemplate, SearchResult } from '@shared/presenter'

export class SearchManager {
  private activeEngine: SearchEngineTemplate | null = null

  async startSearch(_query: string): Promise<SearchResult[]> {
    console.warn('[SearchManager] Deprecated: search is disabled, use Yo Browser instead.')
    return []
  }

  async getEngines(): Promise<SearchEngineTemplate[]> {
    return this.activeEngine ? [this.activeEngine] : []
  }

  getActiveEngine(): SearchEngineTemplate {
    if (!this.activeEngine) {
      this.activeEngine = {
        id: 'yo-browser',
        name: 'Yo Browser',
        selector: '',
        searchUrl: 'https://www.google.com/search?q={query}',
        extractorScript: ''
      }
    }
    return this.activeEngine
  }

  async setActiveEngine(engineId: string): Promise<boolean> {
    // Keep a placeholder engine to satisfy legacy calls
    this.activeEngine = {
      id: engineId,
      name: engineId,
      selector: '',
      searchUrl: 'https://www.google.com/search?q={query}',
      extractorScript: ''
    }
    return true
  }

  async search(_conversationId: string, _query: string): Promise<SearchResult[]> {
    console.warn('[SearchManager] Deprecated: search is disabled, use Yo Browser instead.')
    return []
  }

  async testSearch(_query: string): Promise<boolean> {
    console.warn('[SearchManager] testSearch is deprecated.')
    return false
  }

  async stopSearch(): Promise<void> {
    // no-op for deprecated flow
  }

  destroy(): void {
    // no-op
  }
}

export function generateSearchPrompt(_query: string, _results: SearchResult[]): string {
  return ''
}
