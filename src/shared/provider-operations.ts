/**
 * Provider operation types and interface definitions
 * Used to optimize rebuild strategy when provider changes
 */

import type { LLM_PROVIDER } from './presenter'

/**
 * Provider update operation type
 */
export interface ProviderUpdateOperation {
  /** Provider ID */
  providerId: string
  /** Updated fields */
  updates: Partial<LLM_PROVIDER>
  /** Whether provider instance rebuild is required */
  requiresRebuild: boolean
}

/**
 * Provider change information
 */
export interface ProviderChange {
  /** Operation type */
  operation: 'add' | 'remove' | 'update' | 'reorder'
  /** Provider ID */
  providerId: string
  /** Whether instance rebuild is required */
  requiresRebuild: boolean
  /** Update data (only for update operation) */
  updates?: Partial<LLM_PROVIDER>
  /** New provider data (only for add operation) */
  provider?: LLM_PROVIDER
}

/**
 * List of fields that require provider instance rebuild
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
 * Check if provider update requires instance rebuild
 */
export function checkRequiresRebuild(updates: Partial<LLM_PROVIDER>): boolean {
  return REBUILD_REQUIRED_FIELDS.some((field) => field in updates)
}

/**
 * Provider batch update request
 */
export interface ProviderBatchUpdate {
  /** List of change operations */
  changes: ProviderChange[]
  /** New complete provider list (for ordering) */
  providers: LLM_PROVIDER[]
}
