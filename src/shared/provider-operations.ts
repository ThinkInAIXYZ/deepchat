/**
 * Provider 操作类型和接口定义
 * 用于优化 provider 变更时的重建策略
 */

import type { LLM_PROVIDER } from './presenter'

/**
 * Provider 更新操作类型
 */
export interface ProviderUpdateOperation {
  /** Provider ID */
  providerId: string
  /** 更新的字段 */
  updates: Partial<LLM_PROVIDER>
  /** 是否需要重建 provider 实例 */
  requiresRebuild: boolean
}

/**
 * Provider 变更信息
 */
export interface ProviderChange {
  /** 操作类型 */
  operation: 'add' | 'remove' | 'update' | 'reorder'
  /** Provider ID */
  providerId: string
  /** 是否需要重建实例 */
  requiresRebuild: boolean
  /** 更新数据（仅用于 update 操作） */
  updates?: Partial<LLM_PROVIDER>
  /** 新的 provider 数据（仅用于 add 操作） */
  provider?: LLM_PROVIDER
}

/**
 * 需要重建 provider 实例的字段列表
 */
export const REBUILD_REQUIRED_FIELDS = [
  'enable',
  'apiKey',
  'baseUrl',
  'authMode',
  'oauthToken',
  'accessKeyId', // AWS Bedrock
  'secretAccessKey', // AWS Bedrock
  'region', // AWS Bedrock
  'azureResourceName', // Azure
  'azureApiVersion' // Azure
] as const

/**
 * 检查 provider 更新是否需要重建实例
 */
export function checkRequiresRebuild(updates: Partial<LLM_PROVIDER>): boolean {
  return REBUILD_REQUIRED_FIELDS.some((field) => field in updates)
}

/**
 * Provider 批量更新请求
 */
export interface ProviderBatchUpdate {
  /** 变更操作列表 */
  changes: ProviderChange[]
  /** 新的完整 provider 列表（用于顺序） */
  providers: LLM_PROVIDER[]
}
