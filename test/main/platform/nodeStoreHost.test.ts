import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The shared main-process setup mocks `fs`. This suite stores real files, so it
// restores the actual module before loading the host under test.
vi.unmock('fs')
vi.unmock('node:fs')

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const { nodeStoreHost } = await import('@/platform/node/storeHost')

describe('node store host', () => {
  beforeAll(() => {
    expect(fs.mkdtempSync).toBeTypeOf('function')
  })

  const directories: string[] = []

  const createDirectory = (): string => {
    const directory = fs.mkdtempSync(path.join(tmpdir(), 'deepchat-node-store-'))
    directories.push(directory)
    return directory
  }

  afterEach(() => {
    while (directories.length > 0) {
      fs.rmSync(directories.pop()!, { recursive: true, force: true })
    }
  })

  it('merges defaults under stored values so older settings files keep loading', () => {
    const cwd = createDirectory()
    fs.writeFileSync(path.join(cwd, 'app-settings.json'), JSON.stringify({ language: 'zh-CN' }))

    const store = nodeStoreHost.create<{ language: string; closeToQuit: boolean }>({
      name: 'app-settings',
      defaults: { language: 'system', closeToQuit: false },
      cwd
    })

    expect(store.get('language')).toBe('zh-CN')
    expect(store.get('closeToQuit')).toBe(false)
  })

  it('persists writes as JSON with defaults kept, and deletes keys on request', () => {
    const cwd = createDirectory()
    const store = nodeStoreHost.create<{ language: string; closeToQuit: boolean }>({
      name: 'app-settings',
      defaults: { language: 'system', closeToQuit: false },
      cwd
    })

    store.set('language', 'en-US')
    store.set({ closeToQuit: true })

    const written = JSON.parse(fs.readFileSync(path.join(cwd, 'app-settings.json'), 'utf-8'))
    expect(written).toEqual({ language: 'en-US', closeToQuit: true })

    const reopened = nodeStoreHost.create<{ language: string; closeToQuit: boolean }>({
      name: 'app-settings',
      defaults: { language: 'system', closeToQuit: false },
      cwd
    })
    expect(reopened.get('language')).toBe('en-US')

    // Same-process semantics match electron-store: a deleted key reads as undefined,
    // and defaults come back the next time the store is constructed.
    reopened.delete('closeToQuit')
    expect(reopened.get('closeToQuit')).toBeUndefined()
    expect(reopened.has('closeToQuit')).toBe(false)

    const afterRestart = nodeStoreHost.create<{ language: string; closeToQuit: boolean }>({
      name: 'app-settings',
      defaults: { language: 'system', closeToQuit: false },
      cwd
    })
    expect(afterRestart.get('closeToQuit')).toBe(false)
    expect(afterRestart.get('language')).toBe('en-US')
  })

  it('falls back to defaults instead of throwing on a corrupt file', () => {
    const cwd = createDirectory()
    fs.writeFileSync(path.join(cwd, 'broken.json'), '{ not json')

    const store = nodeStoreHost.create<{ enabled: boolean }>({
      name: 'broken',
      defaults: { enabled: true },
      cwd
    })

    expect(store.get('enabled')).toBe(true)
  })
})
