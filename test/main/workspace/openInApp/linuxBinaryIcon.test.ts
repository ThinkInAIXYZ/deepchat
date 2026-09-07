import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  execFileMock,
  getFileIconMock,
  findDesktopEntryMock,
  readDesktopEntryMock,
  readDesktopEntryIconMock
} = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  getFileIconMock: vi.fn(),
  findDesktopEntryMock: vi.fn(),
  readDesktopEntryMock: vi.fn(),
  readDesktopEntryIconMock: vi.fn()
}))

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

vi.mock('electron', () => ({
  app: {
    getFileIcon: getFileIconMock
  }
}))

vi.mock('@/workspace/openInApp/linuxDesktopEntries', () => ({
  findDesktopEntry: findDesktopEntryMock,
  readDesktopEntry: readDesktopEntryMock,
  readDesktopEntryIcon: readDesktopEntryIconMock,
  desktopEntryAcceptsFiles: vi.fn()
}))

import { detectInstalledApps } from '@/workspace/openInApp/detectors'

function resolveBinary(binary: string, path: string | null) {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, result?: unknown) => void
    const commandArgs = args[1] as string[] | undefined
    const command = commandArgs?.[1] ?? ''
    if (path && command.includes(`"${binary}"`)) {
      callback(null, { stdout: `${path}\n`, stderr: '' })
      return
    }
    callback(new Error('not found'))
  })
}

describe('Linux binary icon detection', () => {
  afterEach(() => {
    execFileMock.mockReset()
    getFileIconMock.mockReset()
    findDesktopEntryMock.mockReset()
    readDesktopEntryMock.mockReset()
    readDesktopEntryIconMock.mockReset()
  })

  it('prefers a desktop-entry icon over the binary', async () => {
    resolveBinary('code', '/usr/bin/code')
    findDesktopEntryMock.mockReturnValue('/usr/share/applications/code.desktop')
    readDesktopEntryMock.mockReturnValue('[Desktop Entry]\nIcon=/usr/share/pixmaps/code.png')
    readDesktopEntryIconMock.mockReturnValue('data:image/png;base64,desktop')

    const apps = await detectInstalledApps('linux')
    const vscode = apps.find((entry) => entry.definition.id === 'vscode')

    expect(vscode?.iconDataUrl).toBe('data:image/png;base64,desktop')
    expect(getFileIconMock).not.toHaveBeenCalled()
  })

  it('falls back to the binary icon when the desktop entry has none', async () => {
    resolveBinary('code', '/usr/bin/code')
    findDesktopEntryMock.mockReturnValue('/usr/share/applications/code.desktop')
    readDesktopEntryMock.mockReturnValue('[Desktop Entry]\nIcon=code')
    readDesktopEntryIconMock.mockReturnValue(undefined)
    getFileIconMock.mockResolvedValue({
      isEmpty: () => false,
      toDataURL: () => 'data:image/png;base64,binary'
    })

    const apps = await detectInstalledApps('linux')
    const vscode = apps.find((entry) => entry.definition.id === 'vscode')

    expect(vscode?.iconDataUrl).toBe('data:image/png;base64,binary')
  })

  it('omits the icon when getFileIcon returns empty', async () => {
    resolveBinary('code', '/usr/bin/code')
    findDesktopEntryMock.mockReturnValue(null)
    getFileIconMock.mockResolvedValue({
      isEmpty: () => true,
      toDataURL: () => 'data:image/png;base64,unused'
    })

    const apps = await detectInstalledApps('linux')
    const vscode = apps.find((entry) => entry.definition.id === 'vscode')

    expect(vscode?.iconDataUrl).toBeUndefined()
  })

  it('omits the icon when getFileIcon fails', async () => {
    resolveBinary('code', '/usr/bin/code')
    findDesktopEntryMock.mockReturnValue(null)
    getFileIconMock.mockRejectedValue(new Error('no icon'))

    const apps = await detectInstalledApps('linux')
    const vscode = apps.find((entry) => entry.definition.id === 'vscode')

    expect(vscode?.iconDataUrl).toBeUndefined()
  })
})
