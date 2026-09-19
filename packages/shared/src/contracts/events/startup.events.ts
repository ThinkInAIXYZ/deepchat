import { StartupWorkloadChangedPayloadSchema, defineEventContract } from '../common.js'

export const startupWorkloadChangedEvent = defineEventContract({
  name: 'startup.workload.changed',
  payload: StartupWorkloadChangedPayloadSchema
})
