import { StartupWorkloadChangedPayloadSchema, defineEventContract } from '../common'

export const startupWorkloadChangedEvent = defineEventContract({
  name: 'startup.workload.changed',
  payload: StartupWorkloadChangedPayloadSchema
})
