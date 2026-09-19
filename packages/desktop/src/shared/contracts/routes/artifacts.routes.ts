import { z } from 'zod'
import { defineRouteContract } from '../contract'
import { TimestampMsSchema } from '../json'

const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000

export const ArtifactIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)

export const ArtifactMetadataSchema = z
  .object({
    id: ArtifactIdSchema,
    requestId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    owner: z.enum(['human', 'agent']),
    mimeType: z
      .string()
      .min(3)
      .max(255)
      .regex(
        /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;\s*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*$/
      ),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]+$/),
    filename: z.string().min(1).max(255),
    createdAt: TimestampMsSchema.max(MAX_DATE_TIMESTAMP_MS),
    expiresAt: TimestampMsSchema.max(MAX_DATE_TIMESTAMP_MS)
  })
  .strict()
  .refine((artifact) => artifact.expiresAt > artifact.createdAt, {
    message: 'Artifact expiry must be later than creation'
  })

export const artifactsDescribeRoute = defineRouteContract({
  name: 'artifacts.describe',
  input: z.object({ id: ArtifactIdSchema }).strict(),
  output: z.object({ artifact: ArtifactMetadataSchema }).strict()
})

export const artifactsReadRoute = defineRouteContract({
  name: 'artifacts.read',
  input: z.object({ id: ArtifactIdSchema }).strict(),
  output: z.object({ artifact: ArtifactMetadataSchema }).strict()
})

export const artifactsDeleteRoute = defineRouteContract({
  name: 'artifacts.delete',
  input: z.object({ id: ArtifactIdSchema }).strict(),
  output: z.object({ deleted: z.literal(true) }).strict()
})

export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>
