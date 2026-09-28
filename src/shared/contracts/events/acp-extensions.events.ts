import { z } from 'zod'
import { defineEventContract } from '../common'

export const acpElicitationChangedEvent = defineEventContract({
  name: 'acp.elicitation.changed',
  payload: z.object({ version: z.number() })
})

export const acpExtensionsChangedEvent = defineEventContract({
  name: 'acp.extensions.changed',
  payload: z.object({ conversationId: z.string(), agentId: z.string(), revision: z.number() })
})
