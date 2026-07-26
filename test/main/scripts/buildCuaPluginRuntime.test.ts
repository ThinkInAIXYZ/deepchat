import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 }))
}))

vi.mock('node:child_process', () => ({
  execFile: childProcessMocks.execFile,
  execFileSync: childProcessMocks.execFileSync,
  spawnSync: childProcessMocks.spawnSync
}))

async function loadBuildRuntime() {
  return (await import('../../../scripts/build-cua-plugin-runtime.mjs')) as {
    darwinHelperAppDirName: string
    darwinHelperBinaryName: string
    darwinHelperBundleIdentifier: string
    sanitizeDarwinExecutable: (
      executable: string,
      options: {
        inspectExecutable: () => {
          rpaths: string[]
          linkedLibraries: string[]
        }
        runCommand: (command: string, args: string[]) => void
      }
    ) => { removedRpaths: string[] }
    stageDarwinRuntime: (extractDir: string, runtimeDir: string) => Promise<void>
  }
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleIdentifier</key>
    <string>com.trycua.driver</string>
    <key>CFBundleName</key>
    <string>CuaDriver</string>
    <key>CFBundleExecutable</key>
    <string>cua-driver</string>
  </dict>
</plist>
`
}

describe('build-cua-plugin-runtime', () => {
  let tempRoot: string

  beforeEach(async () => {
    vi.resetModules()
    childProcessMocks.execFileSync.mockReset()
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-build-test-'))
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('rebrands the upstream macOS CUA app bundle before signing', async () => {
    const {
      darwinHelperAppDirName,
      darwinHelperBinaryName,
      darwinHelperBundleIdentifier,
      stageDarwinRuntime
    } = await loadBuildRuntime()
    const extractDir = path.join(tempRoot, 'extract')
    const runtimeDir = path.join(tempRoot, 'runtime')
    const sourceApp = path.join(extractDir, 'nested', 'CuaDriver.app')
    const sourceExecutable = path.join(sourceApp, 'Contents', 'MacOS', 'cua-driver')

    await mkdir(path.dirname(sourceExecutable), { recursive: true })
    await mkdir(path.join(sourceApp, 'Contents', '_CodeSignature'), { recursive: true })
    await writeFile(path.join(sourceApp, 'Contents', 'Info.plist'), infoPlist())
    await writeFile(path.join(sourceApp, 'Contents', 'CodeResources'), 'legacy')
    await writeFile(path.join(sourceApp, 'Contents', '_CodeSignature', 'CodeResources'), 'signed')
    await writeFile(sourceExecutable, 'driver')
    await chmod(sourceExecutable, 0o755)

    await stageDarwinRuntime(extractDir, runtimeDir)

    const targetApp = path.join(runtimeDir, darwinHelperAppDirName)
    const targetExecutable = path.join(targetApp, 'Contents', 'MacOS', darwinHelperBinaryName)
    const plist = await readFile(path.join(targetApp, 'Contents', 'Info.plist'), 'utf8')

    await expect(readFile(targetExecutable, 'utf8')).resolves.toBe('driver')
    await expect(
      readFile(path.join(targetApp, 'Contents', 'MacOS', 'cua-driver'), 'utf8')
    ).rejects.toThrow()
    await expect(
      readFile(path.join(targetApp, 'Contents', '_CodeSignature', 'CodeResources'), 'utf8')
    ).rejects.toThrow()
    await expect(readFile(path.join(targetApp, 'Contents', 'CodeResources'), 'utf8')).rejects.toThrow()
    expect(plist).toContain(`<string>${darwinHelperBundleIdentifier}</string>`)
    expect(plist).toContain('<key>CFBundleName</key>\n    <string>DeepChat Computer Use</string>')
    expect(plist).toContain('<key>CFBundleDisplayName</key>')
    expect(plist).toContain(`<string>${darwinHelperBinaryName}</string>`)
  })

  it('removes duplicate build-machine RPATHs before signing', async () => {
    const { sanitizeDarwinExecutable } = await loadBuildRuntime()
    const executable = path.join(tempRoot, 'deepchat-cua-driver')
    const xcodeRpath =
      '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx'
    const inspectExecutable = vi
      .fn()
      .mockReturnValueOnce({
        rpaths: ['/usr/lib/swift', xcodeRpath, xcodeRpath],
        linkedLibraries: [
          '/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit',
          '@rpath/libswiftCore.dylib'
        ]
      })
      .mockReturnValueOnce({
        rpaths: ['/usr/lib/swift'],
        linkedLibraries: [
          '/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit',
          '@rpath/libswiftCore.dylib'
        ]
      })
    const runCommand = vi.fn()

    expect(
      sanitizeDarwinExecutable(executable, {
        inspectExecutable,
        runCommand
      })
    ).toEqual({ removedRpaths: [xcodeRpath] })
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(runCommand).toHaveBeenCalledWith('/usr/bin/install_name_tool', [
      '-delete_rpath',
      xcodeRpath,
      executable
    ])
  })

  it('rejects non-system linked libraries instead of rewriting them', async () => {
    const { sanitizeDarwinExecutable } = await loadBuildRuntime()
    const runCommand = vi.fn()

    expect(() =>
      sanitizeDarwinExecutable('/tmp/deepchat-cua-driver', {
        inspectExecutable: () => ({
          rpaths: ['/usr/lib/swift'],
          linkedLibraries: ['/Users/runner/build/libInjected.dylib']
        }),
        runCommand
      })
    ).toThrow(/non-system linked libraries.*libInjected/)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('fails if a disallowed RPATH remains after sanitation', async () => {
    const { sanitizeDarwinExecutable } = await loadBuildRuntime()
    const xcodeRpath = '/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx'
    const inspectExecutable = vi.fn(() => ({
      rpaths: [xcodeRpath],
      linkedLibraries: ['/usr/lib/libSystem.B.dylib']
    }))

    expect(() =>
      sanitizeDarwinExecutable('/tmp/deepchat-cua-driver', {
        inspectExecutable,
        runCommand: vi.fn()
      })
    ).toThrow(/still contains non-system RPATHs/)
  })
})
