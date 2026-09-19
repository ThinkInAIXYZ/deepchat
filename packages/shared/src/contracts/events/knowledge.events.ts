import { TimestampMsSchema, defineEventContract } from '../common.js'
import { KnowledgeFileMessageSchema, KnowledgeFileProgressSchema } from '../domainSchemas.js'

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
