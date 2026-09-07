import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import {
  ToolchainDownloadReasonSchema,
  ToolchainInstallPhaseSchema,
  ToolchainKindSchema,
  ToolchainResolveReasonSchema
} from '../routes/toolchains.routes'

export const toolchainsProgressEvent = defineEventContract({
  name: 'toolchains.progress',
  payload: z.object({
    kind: ToolchainKindSchema,
    phase: ToolchainInstallPhaseSchema,
    receivedBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative().nullable(),
    error: ToolchainDownloadReasonSchema.nullable(),
    version: TimestampMsSchema
  })
})

export const toolchainsMissingEvent = defineEventContract({
  name: 'toolchains.missing',
  payload: z.object({
    missing: z
      .array(
        z.object({
          kind: ToolchainKindSchema,
          reason: ToolchainResolveReasonSchema
        })
      )
      .max(8),
    version: TimestampMsSchema
  })
})

export const toolchainsChangedEvent = defineEventContract({
  name: 'toolchains.changed',
  payload: z.object({
    version: TimestampMsSchema
  })
})
