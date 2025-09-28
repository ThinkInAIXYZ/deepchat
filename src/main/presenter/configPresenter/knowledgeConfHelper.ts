import ElectronStore from 'electron-store'
import { BuiltinKnowledgeConfig } from '@shared/presenter'

export class KnowledgeConfHelper {
  private store: ElectronStore<{ knowledgeConfigs: BuiltinKnowledgeConfig[] }>

  constructor() {
    this.store = new ElectronStore<{ knowledgeConfigs: BuiltinKnowledgeConfig[] }>({
      name: 'knowledge-configs',
      defaults: {
        knowledgeConfigs: []
      }
    })
  }

  // Get all knowledge base configurations
  getKnowledgeConfigs(): BuiltinKnowledgeConfig[] {
    return this.store.get('knowledgeConfigs') || []
  }

  // Set all knowledge base configurations
  setKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): void {
    this.store.set('knowledgeConfigs', configs)
  }

  /**
   * Diff old and new configurations, returns { added, updated, deleted }
   * @param oldConfigs
   * @param newConfigs
   * @returns
   */
  static diffKnowledgeConfigs(
    oldConfigs: BuiltinKnowledgeConfig[],
    newConfigs: BuiltinKnowledgeConfig[]
  ): {
    added: BuiltinKnowledgeConfig[]
    deleted: BuiltinKnowledgeConfig[]
    updated: BuiltinKnowledgeConfig[]
  } {
    const oldMap = new Map(oldConfigs.map((cfg) => [cfg.id, cfg]))
    const newMap = new Map(newConfigs.map((cfg) => [cfg.id, cfg]))

    const added = newConfigs.filter((cfg) => !oldMap.has(cfg.id))
    const deleted = oldConfigs.filter((cfg) => !newMap.has(cfg.id))
    const updated = newConfigs.filter(
      (cfg) => oldMap.has(cfg.id) && JSON.stringify(cfg) !== JSON.stringify(oldMap.get(cfg.id))
    )

    return { added, deleted, updated }
  }
}
