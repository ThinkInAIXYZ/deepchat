import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import type { OllamaModel } from '@shared/presenter'

export const useOllamaStore = defineStore('ollama', () => {
  const llmprovider = usePresenter('llmproviderPresenter')

  /**
   * 获取所有本地 Ollama 模型
   */
  const listModels = async (): Promise<OllamaModel[]> => {
    try {
      return await llmprovider.listOllamaModels()
    } catch (error) {
      console.error('Failed to list Ollama models:', error)
      return []
    }
  }

  /**
   * 获取所有运行中的 Ollama 模型
   */
  const listRunningModels = async (): Promise<OllamaModel[]> => {
    try {
      return await llmprovider.listOllamaRunningModels()
    } catch (error) {
      console.error('Failed to list running Ollama models:', error)
      return []
    }
  }

  /**
   * 获取 Ollama 模型信息
   */
  const getModelInfo = async (modelName: string) => {
    try {
      return await llmprovider.showOllamaModelInfo(modelName)
    } catch (error) {
      console.error(`Failed to get model info for ${modelName}:`, error)
      return null
    }
  }

  /**
   * 拉取 Ollama 模型
   */
  const pullModel = async (modelName: string): Promise<boolean> => {
    try {
      return await llmprovider.pullOllamaModels(modelName)
    } catch (error) {
      console.error(`Failed to pull model ${modelName}:`, error)
      return false
    }
  }

  /**
   * 删除 Ollama 模型
   */
  const deleteModel = async (modelName: string): Promise<boolean> => {
    try {
      return await llmprovider.deleteOllamaModel(modelName)
    } catch (error) {
      console.error(`Failed to delete model ${modelName}:`, error)
      return false
    }
  }

  return {
    listModels,
    listRunningModels,
    getModelInfo,
    pullModel,
    deleteModel
  }
})
