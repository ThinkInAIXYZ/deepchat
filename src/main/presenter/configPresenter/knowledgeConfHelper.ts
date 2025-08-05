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

  // 获取所有知识库配置
  getKnowledgeConfigs(): BuiltinKnowledgeConfig[] {
    return this.store.get('knowledgeConfigs') || []
  }

  // 设置所有知识库配置
  setKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): void {
    this.store.set('knowledgeConfigs', configs)
  }

  /**
   * diff 新旧配置，返回 { added, updated, deleted }
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
