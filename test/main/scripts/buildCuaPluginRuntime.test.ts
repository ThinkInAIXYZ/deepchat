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
    enforceDarwinLoadPathContract: (
      executable: string,
      options: {
        inspectExecutable: (targetPath: string) => {
          rpaths: string[]
          linkedLibraries: string[]
        }
        inspectArchitectures: (targetPath: string) => string[]
        ensureToolAvailable?: (command: string, args: string[]) => void
        runCommand: (command: string, args: string[]) => void
        enforceSlice?: (
          slicePath: string,
          initialInspection?: {
            rpaths: string[]
            linkedLibraries: string[]
          }
        ) => { removedRpaths: string[] }
        makeTemporaryDirectory?: (prefix: string) => string
        readMode?: (targetPath: string) => number
        applyMode?: (targetPath: string, mode: number) => void
        replaceFile?: (sourcePath: string, targetPath: string) => void
        removeTemporaryDirectory?: (targetPath: string) => void
      }
    ) => { removedRpaths: string[] }
    generateCuaToolCatalog: (
      executable: string,
      outputPath: string,
      expectedVersion: string,
      options: {
        readCommand: (
          command: string,
          args: string[],
          options: Record<string, unknown>
        ) => string
      }
    ) => Promise<{
      version: string
      tools: Array<{ name: string }>
    }>
    stageDarwinRuntime: (extractDir: string, runtimeDir: string) => Promise<void>
    stageWindowsRuntime: (extractDir: string, runtimeDir: string) => Promise<void>
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
    const sourceThemeAuthoringExecutable = path.join(
      sourceApp,
      'Contents',
      'MacOS',
      'cua-cursor-theme'
    )

    await mkdir(path.dirname(sourceExecutable), { recursive: true })
    await mkdir(path.join(sourceApp, 'Contents', '_CodeSignature'), { recursive: true })
    await writeFile(path.join(sourceApp, 'Contents', 'Info.plist'), infoPlist())
    await writeFile(path.join(sourceApp, 'Contents', 'CodeResources'), 'legacy')
    await writeFile(path.join(sourceApp, 'Contents', '_CodeSignature', 'CodeResources'), 'signed')
    await writeFile(sourceExecutable, 'driver')
    await writeFile(sourceThemeAuthoringExecutable, 'theme-authoring-tool')
    await chmod(sourceExecutable, 0o755)
    await chmod(sourceThemeAuthoringExecutable, 0o755)

    await stageDarwinRuntime(extractDir, runtimeDir)

    const targetApp = path.join(runtimeDir, darwinHelperAppDirName)
    const targetExecutable = path.join(targetApp, 'Contents', 'MacOS', darwinHelperBinaryName)
    const plist = await readFile(path.join(targetApp, 'Contents', 'Info.plist'), 'utf8')

    await expect(readFile(targetExecutable, 'utf8')).resolves.toBe('driver')
    await expect(
      readFile(path.join(targetApp, 'Contents', 'MacOS', 'cua-driver'), 'utf8')
    ).rejects.toThrow()
    await expect(
      readFile(path.join(targetApp, 'Contents', 'MacOS', 'cua-cursor-theme'), 'utf8')
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

  it('rejects an unreviewed executable in the macOS helper directory', async () => {
    const { stageDarwinRuntime } = await loadBuildRuntime()
    const extractDir = path.join(tempRoot, 'extract')
    const runtimeDir = path.join(tempRoot, 'runtime')
    const sourceApp = path.join(extractDir, 'nested', 'CuaDriver.app')
    const macOsDir = path.join(sourceApp, 'Contents', 'MacOS')

    await mkdir(macOsDir, { recursive: true })
    await writeFile(path.join(sourceApp, 'Contents', 'Info.plist'), infoPlist())
    await writeFile(path.join(macOsDir, 'cua-driver'), 'driver')
    await writeFile(path.join(macOsDir, 'cua-cursor-theme-v2'), 'unreviewed-tool')

    await expect(stageDarwinRuntime(extractDir, runtimeDir)).rejects.toThrow(
      /Contents\/MacOS must contain only the regular file deepchat-cua-driver; found: cua-cursor-theme-v2, deepchat-cua-driver/
    )
  })

  it('stages only the unsigned main Windows driver', async () => {
    const { stageWindowsRuntime } = await loadBuildRuntime()
    const extractDir = path.join(tempRoot, 'extract')
    const runtimeDir = path.join(tempRoot, 'runtime')

    await mkdir(path.join(extractDir, 'nested'), { recursive: true })
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(path.join(extractDir, 'nested', 'cua-driver.exe'), 'driver')
    await writeFile(path.join(extractDir, 'nested', 'cua-driver-uia.exe'), 'uia')
    await writeFile(path.join(runtimeDir, 'cua-driver-uia.exe'), 'stale-uia')

    await stageWindowsRuntime(extractDir, runtimeDir)

    await expect(readFile(path.join(runtimeDir, 'cua-driver.exe'), 'utf8')).resolves.toBe('driver')
    await expect(
      readFile(path.join(runtimeDir, 'cua-driver-uia.exe'), 'utf8')
    ).rejects.toThrow()
  })

  it('rejects Windows archives without the main driver', async () => {
    const { stageWindowsRuntime } = await loadBuildRuntime()
    const extractDir = path.join(tempRoot, 'extract')
    const runtimeDir = path.join(tempRoot, 'runtime')

    await mkdir(extractDir, { recursive: true })
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(path.join(extractDir, 'cua-driver-uia.exe'), 'uia')

    await expect(stageWindowsRuntime(extractDir, runtimeDir)).rejects.toThrow(
      /missing cua-driver\.exe/
    )
  })

  it('generates a strict target-local MCP tool catalog from the native binary', async () => {
    const { generateCuaToolCatalog } = await loadBuildRuntime()
    const outputPath = path.join(tempRoot, 'tool-catalog.json')
    const readCommand = vi.fn(() =>
      JSON.stringify({
        version: '0.19.2',
        tools: [
          {
            name: 'click',
            description: 'Click a target.',
            input_schema: {
              type: 'object',
              properties: {
                x: { type: 'number' }
              },
              required: ['x']
            },
            read_only: false,
            destructive: true,
            idempotent: false
          }
        ]
      })
    )

    await expect(
      generateCuaToolCatalog('/runtime/cua-driver', outputPath, '0.19.2', {
        readCommand
      })
    ).resolves.toMatchObject({
      version: '0.19.2',
      tools: [{ name: 'click' }]
    })
    expect(readCommand).toHaveBeenCalledWith(
      '/runtime/cua-driver',
      ['dump-docs', '--type', 'mcp', '--pretty'],
      {
        timeout: 30_000,
        windowsHide: true
      }
    )
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('"version": "0.19.2"')
  })

  it('rejects a generated catalog with a different driver version', async () => {
    const { generateCuaToolCatalog } = await loadBuildRuntime()

    await expect(
      generateCuaToolCatalog(
        '/runtime/cua-driver',
        path.join(tempRoot, 'tool-catalog.json'),
        '0.19.2',
        {
          readCommand: () =>
            JSON.stringify({
              version: '0.13.0',
              tools: [
                {
                  name: 'click',
                  description: 'Click.',
                  input_schema: { type: 'object', properties: {} },
                  read_only: false,
                  destructive: true,
                  idempotent: false
                }
              ]
            })
        }
      )
    ).rejects.toThrow(/Expected 0\.19\.2, got 0\.13\.0/)
  })

  it('rejects malformed safety annotations instead of emitting a partial catalog', async () => {
    const { generateCuaToolCatalog } = await loadBuildRuntime()
    const outputPath = path.join(tempRoot, 'tool-catalog.json')

    await expect(
      generateCuaToolCatalog('/runtime/cua-driver', outputPath, '0.19.2', {
        readCommand: () =>
          JSON.stringify({
            version: '0.19.2',
            tools: [
              {
                name: 'click',
                description: 'Click.',
                input_schema: { type: 'object', properties: {} },
                read_only: false,
                destructive: 'yes',
                idempotent: false
              }
            ]
          })
      })
    ).rejects.toThrow(/destructive must be a boolean/)
    await expect(readFile(outputPath, 'utf8')).rejects.toThrow()
  })

  it('removes duplicate build-machine RPATHs before signing', async () => {
    const { enforceDarwinLoadPathContract } = await loadBuildRuntime()
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
    const ensureToolAvailable = vi.fn()

    expect(
      enforceDarwinLoadPathContract(executable, {
        inspectExecutable,
        inspectArchitectures: () => ['arm64'],
        ensureToolAvailable,
        runCommand
      })
    ).toEqual({ removedRpaths: [xcodeRpath] })
    expect(ensureToolAvailable).toHaveBeenCalledWith('/usr/bin/install_name_tool', [
      '-help'
    ])
    expect(ensureToolAvailable).toHaveBeenCalledWith('/usr/bin/lipo', [
      '-info',
      process.execPath
    ])
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(runCommand).toHaveBeenCalledWith('/usr/bin/install_name_tool', [
      '-delete_rpath',
      xcodeRpath,
      executable
    ])
  })

  it('sanitizes asymmetric universal RPATHs one architecture at a time', async () => {
    const { enforceDarwinLoadPathContract } = await loadBuildRuntime()
    const executable = path.join(tempRoot, 'deepchat-cua-driver')
    const temporaryDirectory = path.join(tempRoot, 'load-path-slices')
    const x64Slice = path.join(temporaryDirectory, 'x86_64-deepchat-cua-driver')
    const arm64Slice = path.join(temporaryDirectory, 'arm64-deepchat-cua-driver')
    const rebuiltExecutable = path.join(temporaryDirectory, 'deepchat-cua-driver')
    const runCommand = vi.fn()
    const enforceSlice = vi.fn((slicePath: string) => ({
      removedRpaths: [
        slicePath === x64Slice
          ? '/Applications/Xcode-x64.app/usr/lib/swift'
          : '/Applications/Xcode-arm64.app/usr/lib/swift'
      ]
    }))
    const applyMode = vi.fn()
    const replaceFile = vi.fn()
    const removeTemporaryDirectory = vi.fn()

    expect(
      enforceDarwinLoadPathContract(executable, {
        inspectExecutable: (targetPath: string) => ({
          rpaths:
            targetPath === executable
              ? ['/Applications/Xcode.app/usr/lib/swift']
              : ['/usr/lib/swift'],
          linkedLibraries: ['/usr/lib/libSystem.B.dylib']
        }),
        inspectArchitectures: () => ['x86_64', 'arm64'],
        ensureToolAvailable: vi.fn(),
        runCommand,
        enforceSlice,
        makeTemporaryDirectory: () => temporaryDirectory,
        readMode: () => 0o100755,
        applyMode,
        replaceFile,
        removeTemporaryDirectory
      })
    ).toEqual({
      removedRpaths: [
        '/Applications/Xcode-x64.app/usr/lib/swift',
        '/Applications/Xcode-arm64.app/usr/lib/swift'
      ]
    })
    expect(runCommand).toHaveBeenNthCalledWith(1, '/usr/bin/lipo', [
      '-thin',
      'x86_64',
      executable,
      '-output',
      x64Slice
    ])
    expect(runCommand).toHaveBeenNthCalledWith(2, '/usr/bin/lipo', [
      '-thin',
      'arm64',
      executable,
      '-output',
      arm64Slice
    ])
    expect(runCommand).toHaveBeenNthCalledWith(3, '/usr/bin/lipo', [
      '-create',
      x64Slice,
      arm64Slice,
      '-output',
      rebuiltExecutable
    ])
    expect(enforceSlice).toHaveBeenCalledTimes(2)
    expect(applyMode).toHaveBeenCalledWith(rebuiltExecutable, 0o755)
    expect(replaceFile).toHaveBeenCalledWith(rebuiltExecutable, executable)
    expect(removeTemporaryDirectory).toHaveBeenCalledWith(temporaryDirectory)
  })

  it('rejects a universal rebuild that loses an architecture', async () => {
    const { enforceDarwinLoadPathContract } = await loadBuildRuntime()
    const executable = path.join(tempRoot, 'deepchat-cua-driver')
    const temporaryDirectory = path.join(tempRoot, 'load-path-slices')
    const rebuiltExecutable = path.join(temporaryDirectory, 'deepchat-cua-driver')
    const replaceFile = vi.fn()
    const removeTemporaryDirectory = vi.fn()

    expect(() =>
      enforceDarwinLoadPathContract(executable, {
        inspectExecutable: (targetPath: string) => ({
          rpaths:
            targetPath === executable
              ? ['/Applications/Xcode.app/usr/lib/swift']
              : ['/usr/lib/swift'],
          linkedLibraries: ['/usr/lib/libSystem.B.dylib']
        }),
        inspectArchitectures: (targetPath: string) =>
          targetPath === rebuiltExecutable ? ['arm64'] : ['x86_64', 'arm64'],
        ensureToolAvailable: vi.fn(),
        runCommand: vi.fn(),
        enforceSlice: () => ({ removedRpaths: [] }),
        makeTemporaryDirectory: () => temporaryDirectory,
        readMode: () => 0o100755,
        applyMode: vi.fn(),
        replaceFile,
        removeTemporaryDirectory
      })
    ).toThrow(/architecture set changed during sanitation/)
    expect(replaceFile).not.toHaveBeenCalled()
    expect(removeTemporaryDirectory).toHaveBeenCalledWith(temporaryDirectory)
  })

  it('does not rewrite a universal executable that already satisfies the contract', async () => {
    const { enforceDarwinLoadPathContract } = await loadBuildRuntime()
    const inspectArchitectures = vi.fn(() => ['x86_64', 'arm64'])
    const runCommand = vi.fn()

    expect(
      enforceDarwinLoadPathContract('/tmp/deepchat-cua-driver', {
        inspectExecutable: () => ({
          rpaths: ['/usr/lib/swift'],
          linkedLibraries: ['/usr/lib/libSystem.B.dylib']
        }),
        inspectArchitectures,
        runCommand
      })
    ).toEqual({ removedRpaths: [] })
    expect(inspectArchitectures).not.toHaveBeenCalled()
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('rejects non-system linked libraries instead of rewriting them', async () => {
    const { enforceDarwinLoadPathContract } = await loadBuildRuntime()
    const runCommand = vi.fn()

    expect(() =>
      enforceDarwinLoadPathContract('/tmp/deepchat-cua-driver', {
        inspectExecutable: () => ({
          rpaths: ['/usr/lib/swift'],
          linkedLibraries: ['/Users/runner/build/libInjected.dylib']
        }),
        inspectArchitectures: () => ['arm64'],
        runCommand
      })
    ).toThrow(/non-system linked libraries.*libInjected/)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('preserves sanitation and temporary-slice cleanup failures', async () => {
    const { enforceDarwinLoadPathContract } = await loadBuildRuntime()
    const sanitationError = new Error('slice sanitation failed')
    const cleanupError = new Error('slice cleanup failed')

    let error: unknown
    try {
      enforceDarwinLoadPathContract('/tmp/deepchat-cua-driver', {
        inspectExecutable: () => ({
          rpaths: ['/Applications/Xcode.app/usr/lib/swift'],
          linkedLibraries: []
        }),
        inspectArchitectures: () => ['x86_64', 'arm64'],
        ensureToolAvailable: vi.fn(),
        runCommand: vi.fn(),
        enforceSlice: () => {
          throw sanitationError
        },
        makeTemporaryDirectory: () => '/tmp/deepchat-cua-slices',
        readMode: () => 0o755,
        applyMode: vi.fn(),
        replaceFile: vi.fn(),
        removeTemporaryDirectory: () => {
          throw cleanupError
        }
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([sanitationError, cleanupError])
  })

  it('fails if a disallowed RPATH remains after sanitation', async () => {
    const { enforceDarwinLoadPathContract } = await loadBuildRuntime()
    const xcodeRpath = '/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx'
    const inspectExecutable = vi.fn(() => ({
      rpaths: [xcodeRpath],
      linkedLibraries: ['/usr/lib/libSystem.B.dylib']
    }))

    expect(() =>
      enforceDarwinLoadPathContract('/tmp/deepchat-cua-driver', {
        inspectExecutable,
        inspectArchitectures: () => ['arm64'],
        ensureToolAvailable: vi.fn(),
        runCommand: vi.fn()
      })
    ).toThrow(/still contains non-system RPATHs/)
  })
})
