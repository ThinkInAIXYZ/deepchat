import { z } from 'zod'
import type { DialogButton, DialogIcon } from '../../types/dialog.js'
import { EntityIdSchema, defineRouteContract } from '../common.js'

const DialogIconSchema = z.custom<DialogIcon>()
const DialogButtonSchema = z.custom<DialogButton>()

export const dialogRespondRoute = defineRouteContract({
  name: 'dialog.respond',
  input: z.object({
    id: EntityIdSchema,
    button: z.string()
  }),
  output: z.object({
    handled: z.literal(true)
  })
})

export const dialogErrorRoute = defineRouteContract({
  name: 'dialog.error',
  input: z.object({
    id: EntityIdSchema
  }),
  output: z.object({
    handled: z.literal(true)
  })
})

export const dialogRequestSchema = z.object({
  id: EntityIdSchema,
  title: z.string(),
  description: z.string().optional(),
  i18n: z.boolean(),
  icon: DialogIconSchema.optional(),
  buttons: z.array(DialogButtonSchema),
  timeout: z.number()
})
