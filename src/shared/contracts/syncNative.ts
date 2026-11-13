import { z } from 'zod'

const MAX_BYTES = 256 * 1024 ** 3
const Integer = z.number().int().nonnegative().safe()
const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const Relative = z
  .string()
  .min(1)
  .max(32768)
  .refine(
    (value) =>
      !/[\\:\0]/.test(value) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..')
  )

/** Opaque native files. Content is admitted only by the native profile owner. */
export const SyncNativeProfileSchema = z
  .object({
    version: z.literal(1),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    bridgeVersion: z.string().min(1).max(128),
    storeFormat: Integer.positive(),
    sourceHome: z.string().min(1).max(32768).optional(),
    files: z
      .array(
        z
          .object({
            path: Relative,
            size: Integer.max(64 * 1024 ** 3),
            sha256: Digest,
            mode: z.union([z.literal(0o400), z.literal(0o500), z.literal(0o600), z.literal(0o700)])
          })
          .strict()
      )
      .max(100000)
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.files.map((file) => file.path)).size === value.files.length &&
      value.files.reduce((sum, file) => sum + file.size, 0) <= MAX_BYTES
  )
export const SyncNativeTransferSchema = z
  .object({
    id: Digest,
    manifest: SyncNativeProfileSchema
  })
  .strict()
export type SyncNativeTransfer = z.infer<typeof SyncNativeTransferSchema>
