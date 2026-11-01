import { z } from 'zod'
import { settingsGetSnapshotRoute, settingsUpdateRoute } from '../contracts/routes'
import { createDeepchatEventEnvelope, type DeepchatEventEnvelope } from '../contracts/events'
import { SUPPORTED_LOCALES } from '../locales'
import type { NativeConfigurationSnapshot } from '../types/nativeConfiguration'

export const CoreConfigurationCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('read'), input: settingsGetSnapshotRoute.input }).strict(),
  z.object({ operation: z.literal('update'), input: settingsUpdateRoute.input }).strict(),
  z.object({ operation: z.literal('nativeSnapshot') }).strict(),
  z
    .object({
      operation: z.literal('floatingBounds'),
      bounds: z
        .object({
          x: z.number().finite(),
          y: z.number().finite(),
          dockSide: z.enum(['left', 'right'])
        })
        .strict()
    })
    .strict(),
  z.object({ operation: z.literal('initialize') }).strict()
])
export type CoreConfigurationCommand = z.infer<typeof CoreConfigurationCommandSchema>

const theme = z.enum(['dark', 'light', 'system'])
export const NativeConfigurationSnapshotSchema: z.ZodType<NativeConfigurationSnapshot> = z
  .object({
    ownerId: z.string().uuid(),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    language: z.enum(SUPPORTED_LOCALES),
    notificationsEnabled: z.boolean(),
    closeToQuit: z.boolean(),
    contentProtectionEnabled: z.boolean(),
    shortcutKeys: z.record(z.string().max(256), z.string().max(256)),
    floatingButtonEnabled: z.boolean(),
    floatingButtonBounds: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        dockSide: z.enum(['left', 'right'])
      })
      .strict()
      .nullable(),
    loggingEnabled: z.boolean(),
    privacyModeEnabled: z.boolean(),
    updateChannel: z.enum(['stable', 'beta'])
  })
  .strict()

const event = z
  .object({
    name: z.enum([
      'settings.changed',
      'config.language.changed',
      'config.theme.changed',
      'config.systemTheme.changed',
      'config.floatingButton.changed',
      'config.shortcutKeys.changed'
    ]),
    payload: z.unknown()
  })
  .strict()
  .transform(
    (value): DeepchatEventEnvelope => createDeepchatEventEnvelope(value.name, value.payload)
  )

export const CoreConfigurationNativeSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('readTheme') }).strict(),
  z.object({ operation: z.literal('applyTheme'), theme }).strict(),
  z.object({ operation: z.literal('refreshLanguage'), locale: z.enum(SUPPORTED_LOCALES) }).strict(),
  z.object({ operation: z.literal('refreshTheme'), isDark: z.boolean() }).strict(),
  z.object({ operation: z.literal('readLaunchAtLogin') }).strict(),
  z.object({ operation: z.literal('setLaunchAtLogin'), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('applyContentProtection'), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('applyFloatingButtonEnabled'), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('applyLogging'), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('openLoggingFolder') }).strict(),
  z.object({ operation: z.literal('enumerateFonts') }).strict(),
  z
    .object({ operation: z.literal('snapshot'), snapshot: NativeConfigurationSnapshotSchema })
    .strict(),
  z.object({ operation: z.literal('events'), events: z.array(event).max(64) }).strict()
])
export type CoreConfigurationNative = z.infer<typeof CoreConfigurationNativeSchema>
