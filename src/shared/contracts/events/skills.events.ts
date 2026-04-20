import { z } from 'zod'
import type { SkillMetadata } from '@shared/types/skill'
import { EntityIdSchema, defineEventContract } from '../common'

const SkillMetadataSchema = z.custom<SkillMetadata>()

export const skillsCatalogChangedEvent = defineEventContract({
  name: 'skills.catalog.changed',
  payload: z.object({
    reason: z.enum(['discovered', 'installed', 'uninstalled', 'metadata-updated']),
    name: z.string().optional(),
    skill: SkillMetadataSchema.optional(),
    skills: z.array(SkillMetadataSchema).optional(),
    version: z.number().int()
  })
})

export const skillsSessionChangedEvent = defineEventContract({
  name: 'skills.session.changed',
  payload: z.object({
    conversationId: EntityIdSchema,
    skills: z.array(z.string()),
    change: z.enum(['activated', 'deactivated']),
    version: z.number().int()
  })
})
