import type { SearchEngineTemplate, SearchResult } from './thread.presenter'
import type { MODEL_META } from './llmprovider.presenter'

export interface ISearchPresenter {
  getEngines(): Promise<SearchEngineTemplate[]>
  getActiveEngine(): Promise<SearchEngineTemplate>
  setActiveEngine(engineId: string): Promise<boolean>
  testEngine(query?: string): Promise<boolean>

  executeSearch(conversationId: string, query: string): Promise<SearchResult[]>
  stopSearch(conversationId: string): Promise<void>

  updateEngines(engines: SearchEngineTemplate[]): Promise<void>
  addCustomEngine(engine: SearchEngineTemplate): Promise<void>
  removeCustomEngine(engineId: string): Promise<void>

  search(conversationId: string, query: string): Promise<SearchResult[]>
  testSearch(query?: string): Promise<boolean>

  setSearchAssistantModel(model: MODEL_META, providerId: string): void
}
