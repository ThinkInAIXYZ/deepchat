import { describe, expect, it } from 'vitest'
import {
  CHANNEL_PLUGIN_API_VERSION,
  CHANNEL_PLUGIN_SCHEMA_VERSION,
  isChannelPluginManifest,
  parseChannelPluginManifest
} from '@/presenter/remoteControlPresenter/types/channel'

describe('Channel plugin manifest ABI', () => {
  it('accepts a valid plugin manifest', () => {
    const manifest = parseChannelPluginManifest({
      schemaVersion: CHANNEL_PLUGIN_SCHEMA_VERSION,
      pluginId: 'custom.im',
      apiVersion: CHANNEL_PLUGIN_API_VERSION,
      entry: 'dist/index.js',
      types: 'dist/index.d.ts',
      channelType: 'custom-im',
      configSchema: 'dist/config.schema.json'
    })

    expect(manifest).toEqual(
      expect.objectContaining({
        pluginId: 'custom.im',
        channelType: 'custom-im'
      })
    )
    expect(isChannelPluginManifest(manifest)).toBe(true)
  })

  it('rejects invalid or unsafe plugin manifests', () => {
    expect(() =>
      parseChannelPluginManifest({
        schemaVersion: CHANNEL_PLUGIN_SCHEMA_VERSION,
        pluginId: 'Custom Plugin',
        apiVersion: CHANNEL_PLUGIN_API_VERSION,
        entry: '../index.js',
        types: 'dist/index.d.ts',
        channelType: 'custom-im'
      })
    ).toThrow()

    expect(
      isChannelPluginManifest({
        schemaVersion: 999,
        pluginId: 'custom.im',
        apiVersion: CHANNEL_PLUGIN_API_VERSION,
        entry: 'dist/index.js',
        types: 'dist/index.d.ts',
        channelType: 'custom-im'
      })
    ).toBe(false)
  })
})
