import { TimestampMsSchema, defineEventContract } from '../common'
import { KnowledgeFileMessageSchema, KnowledgeFileProgressSchema } from '../domainSchemas'

export const knowledgeFileUpdatedEvent = defineEventContract({
  name: 'knowledge.file.updated',
  payload: KnowledgeFileMessageSchema.extend({
    version: TimestampMsSchema
  })
})

export const knowledgeFileProgressEvent = defineEventContract({
  name: 'knowledge.file.progress',
  payload: KnowledgeFileProgressSchema.extend({
    version: TimestampMsSchema
  })
})
