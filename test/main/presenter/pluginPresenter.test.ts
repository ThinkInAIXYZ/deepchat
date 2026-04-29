import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('PluginPresenter', () => {
  it('loads the electron-vite plugin settings preload output', async () => {
    const presenterSource = await readFile('src/main/presenter/pluginPresenter/index.ts', 'utf8')
    const viteConfigSource = await readFile('electron.vite.config.ts', 'utf8')

    expect(viteConfigSource).toContain('pluginSettings: resolve')
    expect(presenterSource).toContain('../preload/pluginSettings.mjs')
    expect(presenterSource).not.toContain('../preload/plugin-settings-preload.mjs')
  })
})
