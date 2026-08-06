import { z } from 'zod'
import { EntityIdSchema, defineRouteContract } from '../common'
import { ArtifactIdSchema } from './artifacts.routes'

export const AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES = 25 * 1024 * 1024
export const AUDIO_TRANSCRIPTION_MAX_TEXT_CHARACTERS = 1_000_000

export const AudioInputMimeTypeSchema = z
  .string()
  .trim()
  .min(7)
  .max(255)
  .transform((value) => value.toLowerCase())
  .refine(
    (value) =>
      /^audio\/[a-z0-9!#$&^_.+-]+(?:;\s*[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+-]+)*$/.test(value),
    { message: 'Invalid audio MIME type' }
  )

export const AudioInputFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => value !== '.' && value !== '..' && !/[\\/\p{Cc}]/u.test(value), {
    message: 'Invalid input filename'
  })

export const AudioTranscriptionUploadInputSchema = z
  .object({
    providerId: EntityIdSchema.max(128),
    modelId: z.string().min(1).max(256),
    mimeType: AudioInputMimeTypeSchema,
    filename: AudioInputFilenameSchema.optional()
  })
  .strict()

export const AudioTranscriptionArtifactInputSchema = z
  .object({
    providerId: EntityIdSchema.max(128),
    modelId: z.string().min(1).max(256),
    artifactId: ArtifactIdSchema
  })
  .strict()

export const AudioTranscriptionOutputSchema = z
  .object({
    providerId: EntityIdSchema.max(128),
    modelId: z.string().min(1).max(256),
    text: z.string().max(AUDIO_TRANSCRIPTION_MAX_TEXT_CHARACTERS),
    truncated: z.boolean(),
    inputBytes: z.number().int().positive().max(AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES),
    mimeType: AudioInputMimeTypeSchema,
    durationMs: z
      .number()
      .finite()
      .nonnegative()
      .max(24 * 60 * 60_000)
  })
  .strict()

export const audioTranscribeUploadRoute = defineRouteContract({
  name: 'audio.transcribeUpload',
  input: AudioTranscriptionUploadInputSchema,
  output: AudioTranscriptionOutputSchema
})

export const audioTranscribeArtifactRoute = defineRouteContract({
  name: 'audio.transcribeArtifact',
  input: AudioTranscriptionArtifactInputSchema,
  output: AudioTranscriptionOutputSchema
})

export type AudioTranscriptionUploadInput = z.infer<typeof AudioTranscriptionUploadInputSchema>
export type AudioTranscriptionArtifactInput = z.infer<typeof AudioTranscriptionArtifactInputSchema>
export type AudioTranscriptionOutput = z.infer<typeof AudioTranscriptionOutputSchema>
