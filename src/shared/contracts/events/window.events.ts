import { TimestampMsSchema, defineEventContract } from '../common'
import { WindowStateSchema } from '../domainSchemas'

export const windowStateChangedEvent = defineEventContract({
  name: 'window.state.changed',
  payload: WindowStateSchema.extend({
    version: TimestampMsSchema
  })
})
