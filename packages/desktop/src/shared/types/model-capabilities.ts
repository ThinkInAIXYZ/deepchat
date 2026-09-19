import { z } from 'zod'
import type { ReasoningEffort, ReasoningPortrait, Verbosity } from './model-db'
import { ModelType, NEW_API_ENDPOINT_TYPES } from '../model'
import type { ModelRequestPolicy } from '../modelRequestPolicy'
import type { ToolMode } from '../toolMode'

export type ResolvedCapabilityIdentity =
  | {
      providerId: string
      requestModelId: string
      catalogMatched: true
      catalogModelId: string
    }
  | {
      providerId: string
      requestModelId: string
      catalogMatched: false
      catalogModelId: null
    }

export const CapabilityRouteOverrideSchema = z.object({
  endpointType: z.enum(NEW_API_ENDPOINT_TYPES).optional(),
  supportedEndpointTypes: z.array(z.enum(NEW_API_ENDPOINT_TYPES)).optional(),
  type: z.enum(ModelType).optional(),
  ownedBy: z.string().optional()
})

export type CapabilityRouteOverride = z.infer<typeof CapabilityRouteOverrideSchema>

export const CapabilitySnapshotQuerySchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  routeOverride: CapabilityRouteOverrideSchema.optional(),
  reasoningEnabled: z.boolean().optional()
})

export type CapabilitySnapshotQuery = z.infer<typeof CapabilitySnapshotQuerySchema>

export type ResolvedModelCapabilitySnapshot = {
  identity: ResolvedCapabilityIdentity
  defaultToolMode?: ToolMode
  requestPolicy: ModelRequestPolicy
  supportsAudioInput: boolean
  supportsReasoning: boolean
  reasoningPortrait: ReasoningPortrait | null
  thinkingBudgetRange: {
    min?: number
    max?: number
    default?: number
  }
  supportsSearch: boolean
  searchExecution?: 'provider'
  searchDefaults: {
    default?: boolean
    forced?: boolean
    strategy?: 'turbo' | 'max'
  }
  temperatureCapability: boolean | undefined
  supportsTemperatureControl: boolean
  supportsReasoningEffort: boolean
  reasoningEffortDefault: ReasoningEffort | undefined
  supportsVerbosity: boolean
  verbosityDefault: Verbosity | undefined
}
