import { z } from 'zod'
import { defineRouteContract } from '../common'
import type { AcpExtensionState } from '../../types/acp-extensions'

export const AcpElicitationValueSchema = z.union([
  z.string().max(65_536),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(65_536)).max(128)
])
export const AcpElicitationDecisionSchema = z.object({
  requestId: z.string().min(1).max(256),
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.string().max(256), AcpElicitationValueSchema).optional()
})
const FieldSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'integer', 'boolean', 'single-select', 'multi-select']),
  required: z.boolean(),
  secret: z.boolean().optional(),
  preview: z.string().optional(),
  customAnswerFor: z.string().optional(),
  noteFor: z.string().optional(),
  options: z
    .array(
      z.object({
        value: z.string(),
        title: z.string(),
        description: z.string().optional(),
        preview: z.string().optional()
      })
    )
    .optional(),
  defaultValue: z.unknown().optional(),
  format: z.enum(['date', 'date-time', 'email', 'uri']).optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minItems: z.number().optional(),
  maxItems: z.number().optional()
})
export const AcpElicitationViewSchema = z.object({
  requestId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  conversationId: z.string().optional(),
  toolCallId: z.string().optional(),
  mode: z.enum(['form', 'url']),
  message: z.string(),
  fields: z.array(FieldSchema),
  url: z.string().optional(),
  expiresAt: z.number().optional(),
  status: z.enum(['pending', 'waiting_external', 'completed'])
})

export const acpElicitationListRoute = defineRouteContract({
  name: 'acp.elicitation.list',
  input: z.object({}),
  output: z.object({ requests: z.array(AcpElicitationViewSchema), version: z.number() })
})
export const acpElicitationRespondRoute = defineRouteContract({
  name: 'acp.elicitation.respond',
  input: AcpElicitationDecisionSchema,
  output: z.object({ resolved: z.boolean() })
})

const SessionInput = z.object({ sessionId: z.string().min(1) })
export const acpExtensionsInspectRoute = defineRouteContract({
  name: 'acp.extensions.inspect',
  input: SessionInput.extend({ agentId: z.string().min(1) }),
  output: z.object({ state: z.custom<AcpExtensionState>().nullable() })
})
export const acpRateLimitsRefreshRoute = defineRouteContract({
  name: 'acp.rateLimits.refresh',
  input: SessionInput.extend({
    accountId: z.string().min(1).max(256).optional(),
    modelId: z.string().min(1).max(256).optional()
  }),
  output: z.object({ refreshed: z.literal(true) })
})
export const acpTasksListRoute = defineRouteContract({
  name: 'acp.tasks.list',
  input: SessionInput,
  output: z.object({ refreshed: z.literal(true) })
})
export const acpTaskControlRoute = defineRouteContract({
  name: 'acp.tasks.control',
  input: SessionInput.extend({
    taskId: z.string().min(1).max(256),
    action: z.enum(['output', 'cancel']),
    tail: z.number().int().min(1).max(65_536).optional()
  }),
  output: z.object({ output: z.string().max(65_536) })
})
export const acpHistoryReadRoute = defineRouteContract({
  name: 'acp.history.read',
  input: SessionInput,
  output: z.object({ read: z.literal(true) })
})
export const acpHistoryImportRoute = defineRouteContract({
  name: 'acp.history.import',
  input: SessionInput,
  output: z.object({ imported: z.literal(true) })
})
export const acpGoalControlRoute = defineRouteContract({
  name: 'acp.goal.control',
  input: SessionInput.extend({
    action: z.enum(['set', 'resume', 'pause', 'clear']),
    objective: z.string().trim().min(1).max(65_536).optional()
  }),
  output: z.object({ started: z.literal(true) })
})
export const acpPlanReadRoute = defineRouteContract({
  name: 'acp.plan.read',
  input: SessionInput.extend({ planId: z.string().min(1).max(256) }),
  output: z.object({ content: z.string().max(262_144) })
})
