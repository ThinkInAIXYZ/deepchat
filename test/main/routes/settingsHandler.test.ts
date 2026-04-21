import { SettingsRouteHandler } from '@/routes/settings/settingsHandler'
import type { SettingsRouteAdapter } from '@/routes/settings/settingsAdapter'

describe('SettingsRouteHandler', () => {
  const createAdapter = (): SettingsRouteAdapter => {
    const snapshot = {
      fontSizeLevel: 2,
      fontFamily: 'Inter',
      codeFontFamily: 'JetBrains Mono',
      artifactsEffectEnabled: false,
      autoScrollEnabled: true,
      autoCompactionEnabled: true,
      autoCompactionTriggerThreshold: 80,
      autoCompactionRetainRecentPairs: 2,
      contentProtectionEnabled: false,
      privacyModeEnabled: false,
      notificationsEnabled: true,
      traceDebugEnabled: false,
      copyWithCotEnabled: true,
      loggingEnabled: false
    }

    return {
      readSnapshot: vi.fn(() => ({ ...snapshot })),
      applyChange: vi.fn((change) => {
        ;(snapshot as Record<string, unknown>)[change.key] = change.value
      }),
      listSystemFonts: vi.fn().mockResolvedValue(['Inter', 'JetBrains Mono'])
    }
  }

  it('returns a filtered snapshot for typed settings reads', () => {
    const adapter = createAdapter()
    const handler = new SettingsRouteHandler(adapter)

    const result = handler.getSnapshot({
      keys: ['fontSizeLevel', 'fontFamily', 'privacyModeEnabled']
    })

    expect(result).toEqual({
      version: expect.any(Number),
      values: {
        fontSizeLevel: 2,
        fontFamily: 'Inter',
        privacyModeEnabled: false
      }
    })
  })

  it('aggregates typed update results after applying each change', () => {
    const adapter = createAdapter()
    const handler = new SettingsRouteHandler(adapter)

    const result = handler.update({
      changes: [
        { key: 'fontSizeLevel', value: 4 },
        { key: 'privacyModeEnabled', value: true }
      ]
    })

    expect(adapter.applyChange).toHaveBeenNthCalledWith(1, {
      key: 'fontSizeLevel',
      value: 4
    })
    expect(adapter.applyChange).toHaveBeenNthCalledWith(2, {
      key: 'privacyModeEnabled',
      value: true
    })
    expect(result).toEqual({
      version: expect.any(Number),
      changedKeys: ['fontSizeLevel', 'privacyModeEnabled'],
      values: {
        fontSizeLevel: 4,
        privacyModeEnabled: true
      }
    })
  })

  it('lists system fonts through the dedicated settings helper route', async () => {
    const adapter = createAdapter()
    const handler = new SettingsRouteHandler(adapter)

    const result = await handler.listSystemFonts({})

    expect(adapter.listSystemFonts).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      fonts: ['Inter', 'JetBrains Mono']
    })
  })
})
