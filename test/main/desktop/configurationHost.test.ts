import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shell } from 'electron'
import fontList from 'font-list'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopConfigurationHost } from '@/desktop/configurationHost'
import { reportNativeMainError } from '@/logging'

vi.unmock('fs')
vi.mock('font-list', () => ({ default: { getFonts: vi.fn() } }))
vi.mock('@/logging', () => ({ reportNativeMainError: vi.fn() }))

describe('DesktopConfigurationHost', () => {
  let directory: string
  const hosts: DesktopConfigurationHost[] = []
  const setup = () => {
    const persistence = vi.fn()
    const restart = vi.fn(async (): Promise<void> => undefined)
    const host = new DesktopConfigurationHost(directory, persistence, restart)
    hosts.push(host)
    return { host, persistence, restart }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    directory = mkdtempSync(join(tmpdir(), 'deepchat-desktop-configuration-'))
    vi.mocked(shell.openPath).mockResolvedValue('')
  })

  afterEach(() => {
    for (const host of hosts.splice(0)) host.close()
    vi.useRealTimers()
    rmSync(directory, { recursive: true, force: true })
  })

  it('opens only the private profile logging directory and propagates native failures', async () => {
    const { host } = setup()
    await host.openLoggingFolder()
    expect(existsSync(join(directory, 'logs'))).toBe(true)
    expect(shell.openPath).toHaveBeenCalledWith(join(directory, 'logs'))
    vi.mocked(shell.openPath).mockResolvedValueOnce('permission denied')
    await expect(host.openLoggingFolder()).rejects.toThrow('permission denied')
  })

  it('delegates font enumeration to the existing native implementation', async () => {
    const { host } = setup()
    vi.mocked(fontList.getFonts).mockResolvedValueOnce(['Inter Regular', 'Menlo'])
    await expect(host.listSystemFonts()).resolves.toEqual(['Inter Regular', 'Menlo'])
    expect(fontList.getFonts).toHaveBeenCalledTimes(1)
  })

  it('does not launch a folder after close while its directory creation is pending', async () => {
    const { host } = setup()
    const opening = host.openLoggingFolder()
    host.close()
    await expect(opening).rejects.toThrow('host is closed')
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('retains one logging/content-protection restart across startup and maintenance pauses', async () => {
    const { host, restart, persistence } = setup()
    await host.applyLogging(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(restart).not.toHaveBeenCalled()
    host.resume()
    await vi.advanceTimersByTimeAsync(800)
    await host.applyLogging(false)
    host.requestRestart()
    host.pause()
    await vi.advanceTimersByTimeAsync(2000)
    expect(restart).not.toHaveBeenCalled()
    host.resume()
    await vi.advanceTimersByTimeAsync(999)
    expect(restart).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(restart).toHaveBeenCalledTimes(1)
    expect(persistence.mock.calls).toEqual([[true], [false]])
  })

  it('cancels a pending restart and fences native requests when closed', async () => {
    const { host, restart } = setup()
    host.resume()
    await host.applyLogging(true)
    host.close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(restart).not.toHaveBeenCalled()
    await expect(host.applyLogging(false)).rejects.toThrow('host is closed')
    await expect(host.listSystemFonts()).rejects.toThrow('host is closed')
    await expect(host.openLoggingFolder()).rejects.toThrow('host is closed')
    expect(() => host.requestRestart()).toThrow('host is closed')
    expect(() => host.resume()).toThrow('host is closed')
  })

  it('transfers a fired restart to the shutdown coordinator without waiting on itself', async () => {
    const { host, restart } = setup()
    let finish!: () => void
    restart.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    host.resume()
    await host.applyLogging(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(restart).toHaveBeenCalledTimes(1)
    host.close()
    finish()
    await Promise.resolve()
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('reports failed restart authority without replaying it', async () => {
    const { host, restart } = setup()
    const failure = new Error('shutdown did not drain')
    restart.mockRejectedValueOnce(failure)
    host.resume()
    await host.applyLogging(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(reportNativeMainError).toHaveBeenCalledWith('Application restart failed:', failure)
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('requires an absolute private profile directory', () => {
    expect(() => new DesktopConfigurationHost('relative', vi.fn(), vi.fn())).toThrow('absolute')
  })
})
