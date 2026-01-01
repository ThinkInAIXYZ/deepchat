import type { ISearchPresenter } from './interface'
import { SearchManager } from './managers/searchManager'
import type {
  IConfigPresenter,
  ILlmProviderPresenter,
  IWindowPresenter,
  MODEL_META,
  SearchEngineTemplate
} from '@shared/presenter'

interface SearchPresenterDependencies {
  configPresenter: IConfigPresenter
  windowPresenter: IWindowPresenter
  llmProviderPresenter: ILlmProviderPresenter
}

export class SearchPresenter implements ISearchPresenter {
  private readonly searchManager: SearchManager
  private searchAssistantModel: MODEL_META | null = null
  private searchAssistantProviderId: string | null = null

  constructor(deps: SearchPresenterDependencies) {
    this.searchManager = new SearchManager({
      configPresenter: deps.configPresenter,
      windowPresenter: deps.windowPresenter,
      llmProviderPresenter: deps.llmProviderPresenter,
      getSearchAssistantModel: () => this.searchAssistantModel,
      getSearchAssistantProviderId: () => this.searchAssistantProviderId
    })
  }

  getSearchManager(): SearchManager {
    return this.searchManager
  }

  getSearchAssistantModel(): MODEL_META | null {
    return this.searchAssistantModel
  }

  getSearchAssistantProviderId(): string | null {
    return this.searchAssistantProviderId
  }

  setSearchAssistantModel(model: MODEL_META, providerId: string): void {
    this.searchAssistantModel = model
    this.searchAssistantProviderId = providerId
  }

  async getEngines() {
    return this.searchManager.getEngines()
  }

  async getActiveEngine() {
    return this.searchManager.getActiveEngine()
  }

  async setActiveEngine(engineId: string) {
    return this.searchManager.setActiveEngine(engineId)
  }

  async testEngine(query?: string) {
    return this.searchManager.testSearch(query)
  }

  async executeSearch(conversationId: string, query: string) {
    return this.searchManager.search(conversationId, query)
  }

  async stopSearch(conversationId: string) {
    await this.searchManager.stopSearch(conversationId)
  }

  async updateEngines(engines: SearchEngineTemplate[]) {
    await this.searchManager.updateEngines(engines)
  }

  async addCustomEngine(engine: SearchEngineTemplate) {
    await this.searchManager.addCustomEngine(engine)
  }

  async removeCustomEngine(engineId: string) {
    await this.searchManager.removeCustomEngine(engineId)
  }

  async search(conversationId: string, query: string) {
    return this.searchManager.search(conversationId, query)
  }

  async testSearch(query?: string) {
    return this.searchManager.testSearch(query)
  }

  destroy() {
    this.searchManager.destroy()
  }
}
