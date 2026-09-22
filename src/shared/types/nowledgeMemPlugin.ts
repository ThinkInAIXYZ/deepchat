import { z } from 'zod'

export const NOWLEDGE_PLUGIN_ID = 'com.deepchat.plugins.nowledge-mem'
export const NowledgeProfileIdSchema = z.enum(['local', 'remote'])
export type NowledgeProfileId = z.infer<typeof NowledgeProfileIdSchema>
export const NowledgeConnectionInputSchema = z
  .object({
    profile: NowledgeProfileIdSchema,
    baseUrl: z.string().trim().min(1).max(2048),
    apiBaseUrl: z.string().trim().max(2048).optional(),
    mcpUrl: z.string().trim().max(2048).optional(),
    timeout: z.number().int().min(5000).max(120000),
    apiKey: z.string().max(32768).optional(),
    connectLink: z.string().max(8192).optional(),
    legacySource: z.enum(['export', 'mcp']).optional(),
    replace: z.boolean().optional()
  })
  .strict()
export type NowledgeConnectionInput = z.infer<typeof NowledgeConnectionInputSchema>
export interface NowledgeConnection {
  profile: NowledgeProfileId
  baseUrl: string
  apiBaseUrl: string
  mcpUrl: string
  timeout: number
  verifiedAt: number
  hasApiKey: boolean
}
export interface NowledgePluginState {
  connections: Partial<Record<NowledgeProfileId, NowledgeConnection>>
  exportProfile: NowledgeProfileId | null
  legacy: Array<{
    source: 'export' | 'mcp'
    baseUrl: string
    apiBaseUrl: string
    mcpUrl: string
    hasApiKey: boolean
  }>
}
export const nowledgeServerName = (profile: NowledgeProfileId) => `nowledge-mem-${profile}`

export const NowledgeExportInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    profile: NowledgeProfileIdSchema,
    apiBaseUrl: z.string().min(1).max(2048)
  })
  .strict()
export type NowledgeExportInput = z.infer<typeof NowledgeExportInputSchema>
