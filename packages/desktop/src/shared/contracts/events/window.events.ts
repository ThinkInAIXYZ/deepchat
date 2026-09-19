import { TimestampMsSchema, defineEventContract } from '../common.js'
import { WindowStateSchema } from '../domainSchemas.js'

export const windowStateChangedEvent = defineEventContract({
  name: 'window.state.changed',
  payload: WindowStateSchema.extend({
    version: TimestampMsSchema
  })
})
