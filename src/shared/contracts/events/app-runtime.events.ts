import { z } from 'zod'
import { defineEventContract } from '../common'

const EmptyPayloadSchema = z.object({}).default({})

export const appRuntimeStartDeeplinkRequestedEvent = defineEventContract({
  name: 'appRuntime.startDeeplinkRequested',
  payload: z.object({
    msg: z.string().min(1),
    modelId: z.string().nullable().optional(),
    systemPrompt: z.string().optional(),
    mentions: z.array(z.string()).optional(),
    autoSend: z.boolean().optional()
  })
})

export const appRuntimeMcpInstallRequestedEvent = defineEventContract({
  name: 'appRuntime.mcpInstallRequested',
  payload: z.object({
    mcpConfig: z.string().min(1)
  })
})

export const appRuntimeGuidedOnboardingStartRequestedEvent = defineEventContract({
  name: 'appRuntime.guidedOnboardingStartRequested',
  payload: EmptyPayloadSchema
})

export const appRuntimeWindowFocusedEvent = defineEventContract({
  name: 'appRuntime.windowFocused',
  payload: z.object({
    windowId: z.number().optional()
  })
})

export const appRuntimeWindowBlurredEvent = defineEventContract({
  name: 'appRuntime.windowBlurred',
  payload: z.object({
    windowId: z.number().optional()
  })
})

export const appRuntimeShortcutRequestedEvent = defineEventContract({
  name: 'appRuntime.shortcutRequested',
  payload: z.object({
    action: z.enum([
      'zoomIn',
      'zoomOut',
      'zoomResume',
      'createNewConversation',
      'toggleSidebar',
      'toggleWorkspace',
      'toggleSpotlight'
    ])
  })
})

export const appRuntimeDataResetCompleteDevEvent = defineEventContract({
  name: 'appRuntime.dataResetCompleteDev',
  payload: EmptyPayloadSchema
})

export const appRuntimeSystemNotificationClickedEvent = defineEventContract({
  name: 'appRuntime.systemNotificationClicked',
  payload: z.object({
    payload: z.unknown()
  })
})
