import { z } from 'zod'
import { defineRouteContract } from '../common'

const AcpAuthMethodSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['agent', 'terminal', 'unsupported'])
})

export const AcpAuthChallengeSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  agentName: z.string().min(1),
  workdir: z.string().min(1),
  methods: z.array(AcpAuthMethodSchema),
  origin: z.enum(['draft_session', 'session_prepare', 'settings_probe']),
  sessionId: z.string().min(1).optional()
})

export const AcpAuthRunStateSchema = z.enum([
  'required',
  'running',
  'reconnecting',
  'succeeded',
  'cancelled',
  'failed'
])

export const AcpAuthRunStatusSchema = z.object({
  challengeId: z.string().min(1),
  runId: z.string().min(1).optional(),
  state: AcpAuthRunStateSchema,
  error: z.string().optional(),
  version: z.number().int().nonnegative()
})

export const acpAuthInspectRoute = defineRouteContract({
  name: 'acpAuth.inspect',
  input: z.object({
    agentId: z.string().min(1),
    workdir: z.string().optional()
  }),
  output: z.object({
    challenge: AcpAuthChallengeSchema
  })
})

export const acpAuthStartRoute = defineRouteContract({
  name: 'acpAuth.start',
  input: z.object({
    challengeId: z.string().min(1),
    methodId: z.string().min(1)
  }),
  output: AcpAuthRunStatusSchema
})

export const acpAuthInputRoute = defineRouteContract({
  name: 'acpAuth.input',
  input: z.object({
    runId: z.string().min(1),
    data: z.string().min(1).max(16_384)
  }),
  output: z.object({
    sent: z.literal(true)
  })
})

export const acpAuthCancelRoute = defineRouteContract({
  name: 'acpAuth.cancel',
  input: z.object({
    runId: z.string().min(1)
  }),
  output: z.object({
    cancelled: z.boolean()
  })
})

export const acpAuthStatusRoute = defineRouteContract({
  name: 'acpAuth.status',
  input: z.object({
    challengeId: z.string().min(1)
  }),
  output: AcpAuthRunStatusSchema
})
