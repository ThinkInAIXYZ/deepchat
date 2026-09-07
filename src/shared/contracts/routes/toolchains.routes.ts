import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  TOOLCHAIN_DOWNLOAD_REASONS,
  TOOLCHAIN_INSTALL_PHASES,
  TOOLCHAIN_KINDS,
  TOOLCHAIN_RESOLVE_REASONS,
  TOOLCHAIN_SOURCES
} from '../../types/toolchains'

export const ToolchainKindSchema = z.enum(TOOLCHAIN_KINDS)
export const ToolchainSourceSchema = z.enum(TOOLCHAIN_SOURCES)
export const ToolchainResolveReasonSchema = z.enum(TOOLCHAIN_RESOLVE_REASONS)
export const ToolchainDownloadReasonSchema = z.enum(TOOLCHAIN_DOWNLOAD_REASONS)
export const ToolchainInstallPhaseSchema = z.enum(TOOLCHAIN_INSTALL_PHASES)

const ToolchainSelectionSchema = z
  .object({
    source: ToolchainSourceSchema,
    version: z.string().min(1).max(64).optional(),
    customPath: z.string().min(1).max(4096).optional()
  })
  .strict()

const ToolchainInstallProgressSchema = z
  .object({
    kind: ToolchainKindSchema,
    phase: ToolchainInstallPhaseSchema,
    receivedBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative().nullable(),
    error: ToolchainDownloadReasonSchema.nullable()
  })
  .strict()

const ToolchainKindStatusSchema = z
  .object({
    kind: ToolchainKindSchema,
    selection: ToolchainSelectionSchema,
    derived: z.boolean(),
    availability: z.enum(['ready', 'missing', 'incomplete', 'unconfigured']),
    reason: ToolchainResolveReasonSchema.nullable(),
    resolvedVersion: z.string().nullable(),
    resolvedPath: z.string().nullable(),
    bundledAvailable: z.boolean(),
    managedAvailable: z.boolean(),
    system: z
      .object({
        path: z.string(),
        version: z.string().nullable()
      })
      .nullable(),
    install: ToolchainInstallProgressSchema.nullable(),
    ocrCompatible: z.boolean().nullable()
  })
  .strict()

const ToolchainMissingNoticeSchema = z
  .object({
    kind: ToolchainKindSchema,
    reason: ToolchainResolveReasonSchema
  })
  .strict()

export const ToolchainStatusSnapshotSchema = z
  .object({
    node: ToolchainKindStatusSchema,
    uv: ToolchainKindStatusSchema,
    missing: z.array(ToolchainMissingNoticeSchema).max(8)
  })
  .strict()

const ToolchainStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    node: ToolchainSelectionSchema,
    uv: ToolchainSelectionSchema
  })
  .strict()

const ToolchainMutationResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ok'),
      state: ToolchainStateSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('cancelled'),
      reason: z.literal('cancelled'),
      state: ToolchainStateSchema
    })
    .strict()
])

export const toolchainsGetStatusRoute = defineRouteContract({
  name: 'toolchains.getStatus',
  input: z.object({}).default({}),
  output: ToolchainStatusSnapshotSchema
})

export const toolchainsSetSourceRoute = defineRouteContract({
  name: 'toolchains.setSource',
  input: z
    .object({
      kind: ToolchainKindSchema,
      selection: ToolchainSelectionSchema
    })
    .strict(),
  output: ToolchainStateSchema
})

export const toolchainsInstallRoute = defineRouteContract({
  name: 'toolchains.install',
  input: z.object({ kind: ToolchainKindSchema }).strict(),
  output: ToolchainMutationResultSchema
})

export const toolchainsCancelInstallRoute = defineRouteContract({
  name: 'toolchains.cancelInstall',
  input: z.object({ kind: ToolchainKindSchema }).strict(),
  output: z.object({ cancelled: z.boolean() }).strict()
})

export const toolchainsRepairRoute = defineRouteContract({
  name: 'toolchains.repair',
  input: z.object({ kind: ToolchainKindSchema }).strict(),
  output: ToolchainMutationResultSchema
})

export const toolchainsRevertRoute = defineRouteContract({
  name: 'toolchains.revert',
  input: z.object({ kind: ToolchainKindSchema }).strict(),
  output: ToolchainStateSchema
})

export const toolchainsPickCustomRoute = defineRouteContract({
  name: 'toolchains.pickCustom',
  input: z.object({ kind: ToolchainKindSchema }).strict(),
  output: z
    .object({
      canceled: z.boolean(),
      state: ToolchainStateSchema
    })
    .strict()
})
