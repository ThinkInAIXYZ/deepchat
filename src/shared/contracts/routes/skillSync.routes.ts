import { z } from 'zod'
import { defineRouteContract } from '../common'
import type {
  LinkDeepChatSkillResult,
  InstalledSkillAgent,
  InstalledSkillAgentDetail,
  SkillDetail
} from '../../types/skillSync'
import {
  SkillSyncExternalToolConfigSchema,
  SkillSyncNewDiscoverySchema,
  SkillSyncScanResultSchema
} from '../domainSchemas'

const ToolIdSchema = z.string().min(1)
const SkillNameSchema = z.string().min(1)
const InstalledSkillAgentSchema = z.custom<InstalledSkillAgent>()
const InstalledSkillAgentDetailSchema = z.custom<InstalledSkillAgentDetail>()
const SkillDetailSchema = z.custom<SkillDetail>()
const LinkDeepChatSkillResultSchema = z.custom<LinkDeepChatSkillResult>()
const AgentSkillLinkInputSchema = z.object({
  agentId: ToolIdSchema,
  skillName: SkillNameSchema
})

export const skillSyncScanExternalToolsRoute = defineRouteContract({
  name: 'skillSync.scanExternalTools',
  input: z.object({}).default({}),
  output: z.object({
    results: z.array(SkillSyncScanResultSchema)
  })
})

export const skillSyncGetNewDiscoveriesRoute = defineRouteContract({
  name: 'skillSync.getNewDiscoveries',
  input: z.object({}).default({}),
  output: z.object({
    discoveries: z.array(SkillSyncNewDiscoverySchema)
  })
})

export const skillSyncAcknowledgeDiscoveriesRoute = defineRouteContract({
  name: 'skillSync.acknowledgeDiscoveries',
  input: z.object({}).default({}),
  output: z.object({
    acknowledged: z.boolean()
  })
})

export const skillSyncGetRegisteredToolsRoute = defineRouteContract({
  name: 'skillSync.getRegisteredTools',
  input: z.object({}).default({}),
  output: z.object({
    tools: z.array(SkillSyncExternalToolConfigSchema)
  })
})

export const skillSyncScanAgentsRoute = defineRouteContract({
  name: 'skillSync.scanAgents',
  input: z.object({}).default({}),
  output: z.object({
    agents: z.array(InstalledSkillAgentSchema)
  })
})

export const skillSyncGetAgentDetailRoute = defineRouteContract({
  name: 'skillSync.getAgentDetail',
  input: z.object({
    agentId: ToolIdSchema
  }),
  output: z.object({
    agent: InstalledSkillAgentDetailSchema
  })
})

export const skillSyncGetAgentSkillDetailRoute = defineRouteContract({
  name: 'skillSync.getAgentSkillDetail',
  input: z.object({
    agentId: ToolIdSchema,
    skillName: SkillNameSchema
  }),
  output: z.object({
    detail: SkillDetailSchema
  })
})

export const skillSyncRepairAgentSkillLinkRoute = defineRouteContract({
  name: 'skillSync.repairAgentSkillLink',
  input: AgentSkillLinkInputSchema,
  output: z.object({
    result: LinkDeepChatSkillResultSchema
  })
})

export const skillSyncRemoveAgentSkillLinkRoute = defineRouteContract({
  name: 'skillSync.removeAgentSkillLink',
  input: AgentSkillLinkInputSchema,
  output: z.object({
    result: LinkDeepChatSkillResultSchema
  })
})
