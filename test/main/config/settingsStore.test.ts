import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { createSettingsStore } from '@/config/settingsStore'
import { SettingsDatabase } from '@/settings/data/database'

vi.unmock('fs')

describe('application settings file owner', () => {
  let profile: string
  let db: InstanceType<typeof Database> | undefined
  const options = () => ({
    userDataDirectory: profile,
    homeDirectory: path.join(profile, 'home-fact'),
    currentAppVersion: '1.2.3-beta.4'
  })
  const readFile = () => JSON.parse(readFileSync(path.join(profile, 'app-settings.json'), 'utf8'))

  beforeEach(() => {
    profile = mkdtempSync(path.join(tmpdir(), 'deepchat-settings-owner-'))
  })
  afterEach(() => {
    db?.close()
    db = undefined
    rmSync(profile, { recursive: true, force: true })
  })

  it('uses the legacy filename and bootstrap defaults without native directory lookup', () => {
    const store = createSettingsStore(options())

    expect(store.path).toBe(path.join(profile, 'app-settings.json'))
    expect(store.get('language')).toBe('system')
    expect(store.get('appVersion')).toBe('1.2.3-beta.4')
    expect(store.get('skillsPath')).toBe(path.join(profile, 'home-fact', '.deepchat', 'skills'))
    expect(store.get('syncFolderPath')).toBe(path.join(profile, 'sync'))
    expect(store.get('privacyModeEnabled')).toBe(false)
    expect(existsSync(options().homeDirectory)).toBe(false)
  })

  it('preserves existing values and extension data through dot-path mutations and reopen', () => {
    writeFileSync(
      path.join(profile, 'app-settings.json'),
      JSON.stringify({
        appVersion: '0.9.0',
        language: 'en-US',
        extension: { enabled: true, retained: ['legacy'] }
      })
    )
    const store = createSettingsStore(options())
    expect(store.get('appVersion')).toBe('0.9.0')
    expect(store.get('language')).toBe('en-US')
    store.set({ language: 'zh-CN', 'extension.nested.mode': 'custom' })
    expect(store.has('extension.nested.mode')).toBe(true)
    expect(readFile().extension).toEqual({
      enabled: true,
      retained: ['legacy'],
      nested: { mode: 'custom' }
    })
    store.delete('extension.nested.mode')
    const reopened = createSettingsStore(options())
    expect(reopened.has('extension.nested.mode')).toBe(false)
    expect(reopened.get('extension.retained')).toEqual(['legacy'])
    expect(reopened.get('language')).toBe('zh-CN')
  })

  it('rejects corrupt legacy data without replacing it with defaults', () => {
    const file = path.join(profile, 'app-settings.json')
    writeFileSync(file, '{broken legacy data')
    expect(() => createSettingsStore(options())).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('{broken legacy data')
  })

  it.each(['userDataDirectory', 'homeDirectory'] as const)('rejects a relative %s', (key) => {
    expect(() => createSettingsStore({ ...options(), [key]: 'relative' })).toThrow(
      'Settings directories must be absolute'
    )
    expect(existsSync(path.join(profile, 'app-settings.json'))).toBe(false)
  })

  it('retains one file adapter while portable and sensitive settings use the attached database', () => {
    const store = createSettingsStore(options())
    store.set('defaultModel', { providerId: 'legacy', modelId: 'old' })
    db = new Database(':memory:')
    const database = new SettingsDatabase({ getDatabase: () => db! })
    database.appSettingsTable.createTable()
    store.attachDatabase(database)
    expect(store.get('defaultModel')).toEqual({ providerId: 'legacy', modelId: 'old' })
    store.set('defaultModel', { providerId: 'current', modelId: 'new' })
    store.set('hooksNotifications', { hooks: [{ id: 'database-only' }] })
    store.set('language', 'en-US')

    expect(database.appSettingsTable.getAppSetting('defaultModel')).toEqual({
      providerId: 'current',
      modelId: 'new'
    })
    expect(database.appSettingsTable.getAppSetting('hooksNotifications')).toEqual({
      hooks: [{ id: 'database-only' }]
    })
    expect(readFile().hooksNotifications).toEqual({ hooks: [] })
    expect(readFile().defaultModel).toEqual({ providerId: 'legacy', modelId: 'old' })
    expect(readFile().language).toBe('en-US')
    expect(() => store.attachDatabase(database)).toThrow('Settings database is already attached')
  })
})
