import { z } from 'zod'
import {
  IMAGE_GENERATION_MODERATION_VALUES,
  IMAGE_GENERATION_OUTPUT_FORMAT_VALUES,
  IMAGE_GENERATION_QUALITY_VALUES,
  OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES
} from '../../imageGenerationSettings'
import { TTS_RESPONSE_FORMAT_VALUES } from '../../ttsSettings'
import { ArtifactMetadataSchema } from './artifacts.routes'
import { EntityIdSchema, defineRouteContract } from '../common'

const MediaProviderIdSchema = EntityIdSchema.max(128)
const MediaModelIdSchema = z.string().min(1).max(256)
const MediaPromptSchema = z
  .string()
  .min(1)
  .max(64 * 1024)
  .refine((value) => value.trim().length > 0, { message: 'Media input must not be blank' })

export const PublicImageGenerationOptionsSchema = z
  .object({
    size: z.string().min(1).max(32).optional(),
    quality: z.enum(IMAGE_GENERATION_QUALITY_VALUES).optional(),
    outputFormat: z.enum(IMAGE_GENERATION_OUTPUT_FORMAT_VALUES).optional(),
    outputCompression: z.number().int().min(0).max(100).optional(),
    background: z.enum(OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES).optional(),
    moderation: z.enum(IMAGE_GENERATION_MODERATION_VALUES).optional()
  })
  .strict()

export const PublicVideoGenerationOptionsSchema = z
  .object({
    seconds: z.string().min(1).max(32).optional(),
    size: z.string().min(1).max(32).optional(),
    ratio: z.string().min(1).max(32).optional(),
    duration: z.number().int().min(-1).max(3_600).optional(),
    resolution: z.string().min(1).max(32).optional(),
    watermark: z.boolean().optional(),
    generateAudio: z.boolean().optional()
  })
  .strict()

export const PublicSpeechGenerationOptionsSchema = z
  .object({
    voice: z.string().min(1).max(128).optional(),
    responseFormat: z.enum(TTS_RESPONSE_FORMAT_VALUES).optional(),
    speed: z.number().min(0.25).max(4).optional(),
    instructions: z
      .string()
      .min(1)
      .max(16 * 1024)
      .optional()
  })
  .strict()

export const MediaGenerationEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('started'),
      providerId: MediaProviderIdSchema,
      modelId: MediaModelIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('artifact'),
      index: z.number().int().nonnegative(),
      artifact: ArtifactMetadataSchema
    })
    .strict()
])

export const imagesGenerateRoute = defineRouteContract({
  name: 'images.generate',
  input: z
    .object({
      providerId: MediaProviderIdSchema,
      modelId: MediaModelIdSchema,
      prompt: MediaPromptSchema,
      options: PublicImageGenerationOptionsSchema.optional()
    })
    .strict(),
  output: z
    .object({
      providerId: MediaProviderIdSchema,
      modelId: MediaModelIdSchema,
      artifacts: z.array(ArtifactMetadataSchema).min(1).max(8),
      requestedOptions: PublicImageGenerationOptionsSchema.optional(),
      durationMs: z.number().int().nonnegative()
    })
    .strict()
})

export const videosGenerateRoute = defineRouteContract({
  name: 'videos.generate',
  input: z
    .object({
      providerId: MediaProviderIdSchema,
      modelId: MediaModelIdSchema,
      prompt: MediaPromptSchema,
      options: PublicVideoGenerationOptionsSchema.optional()
    })
    .strict(),
  output: z
    .object({
      providerId: MediaProviderIdSchema,
      modelId: MediaModelIdSchema,
      artifacts: z.array(ArtifactMetadataSchema).min(1).max(4),
      requestedOptions: PublicVideoGenerationOptionsSchema.optional(),
      durationMs: z.number().int().nonnegative()
    })
    .strict()
})

export const speechGenerateRoute = defineRouteContract({
  name: 'speech.generate',
  input: z
    .object({
      providerId: MediaProviderIdSchema,
      modelId: MediaModelIdSchema,
      text: MediaPromptSchema,
      options: PublicSpeechGenerationOptionsSchema.optional()
    })
    .strict(),
  output: z
    .object({
      providerId: MediaProviderIdSchema,
      modelId: MediaModelIdSchema,
      artifacts: z.array(ArtifactMetadataSchema).length(1),
      requestedOptions: PublicSpeechGenerationOptionsSchema.optional(),
      durationMs: z.number().int().nonnegative()
    })
    .strict()
})

export type MediaGenerationEvent = z.infer<typeof MediaGenerationEventSchema>
export type ImageGenerationInput = z.infer<typeof imagesGenerateRoute.input>
export type ImageGenerationOutput = z.infer<typeof imagesGenerateRoute.output>
export type VideoGenerationInput = z.infer<typeof videosGenerateRoute.input>
export type VideoGenerationOutput = z.infer<typeof videosGenerateRoute.output>
export type SpeechGenerationInput = z.infer<typeof speechGenerateRoute.input>
export type SpeechGenerationOutput = z.infer<typeof speechGenerateRoute.output>
