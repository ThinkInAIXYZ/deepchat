import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DetectedApp } from '@/workspace/openInApp/detectors'

const { spawnMock, execFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileMock: vi.fn()
}))

vi.mock('child_process', () => ({
  spawn: spawnMock,
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

import { launchApp } from '@/workspace/openInApp/launchers'

class FakeChild extends EventEmitter {
  unref = vi.fn()
}

const vscodeLinux: DetectedApp = {
  definition: {
    id: 'vscode',
    name: 'VS Code',
    kind: 'editor',
    detect: { linux: { type: 'linuxApp', binary: 'code' } },
    launch: { linux: { type: 'exec' } }
  },
  launchTarget: '/usr/bin/code'
}

const fleetDesktop: DetectedApp = {
  definition: {
    id: 'fleet',
    name: 'Fleet',
    kind: 'editor',
    detect: { linux: { type: 'linuxApp', desktopIds: ['fleet.desktop'] } },
    launch: { linux: { type: 'exec' } }
  },
  launchTarget: '/usr/share/applications/fleet.desktop',
  launchOverride: { type: 'desktopEntry' }
}

describe('launchApp', () => {
  afterEach(() => {
    spawnMock.mockReset()
    execFileMock.mockReset()
  })

  it('rejects when the process cannot be spawned', async () => {
    const child = new FakeChild()
    spawnMock.mockReturnValue(child)

    const pending = launchApp(vscodeLinux, '/tmp/file.ts', 'linux')
    child.emit('error', new Error('spawn failed'))

    await expect(pending).rejects.toThrow('spawn failed')
    expect(child.unref).not.toHaveBeenCalled()
  })

  it('resolves when the process is spawned', async () => {
    const child = new FakeChild()
    spawnMock.mockReturnValue(child)

    const pending = launchApp(vscodeLinux, '/tmp/file.ts', 'linux')
    child.emit('spawn')

    await expect(pending).resolves.toBeUndefined()
    expect(child.unref).toHaveBeenCalled()
  })

  it('waits for gio launch to exit instead of detaching', async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, result?: unknown) => void
      callback(null, { stdout: '', stderr: '' })
    })

    await expect(launchApp(fleetDesktop, '/tmp/file.ts', 'linux')).resolves.toBeUndefined()
    expect(execFileMock).toHaveBeenCalledWith(
      'gio',
      ['launch', '/usr/share/applications/fleet.desktop', '/tmp/file.ts'],
      expect.objectContaining({ timeout: 10_000 }),
      expect.any(Function)
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects when gio launch fails after spawn', async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, result?: unknown) => void
      callback(new Error('gio: unable to find desktop file'))
    })

    await expect(launchApp(fleetDesktop, '/tmp/file.ts', 'linux')).rejects.toThrow(
      'gio: unable to find desktop file'
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
