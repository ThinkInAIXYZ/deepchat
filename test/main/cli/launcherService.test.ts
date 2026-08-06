import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CliLauncherService } from '@/cli/launcherService'

const temporaryDirectories: string[] = []
const supportsPosixFilesystemSemantics = process.platform !== 'win32'
const posixIt = it.skipIf(!supportsPosixFilesystemSemantics)

async function createFixture(platform: NodeJS.Platform = 'darwin') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-launcher-'))
  temporaryDirectories.push(root)
  const homeDirectory = path.join(root, 'home')
  const userDataDirectory = path.join(root, 'user-data')
  const localAppDataDirectory = path.join(root, 'local-app-data')
  const cliDirectory = path.join(root, 'cli-v1')
  await mkdir(homeDirectory, { recursive: true })
  await mkdir(userDataDirectory, { recursive: true })
  await mkdir(cliDirectory, { recursive: true })
  await writeFile(path.join(cliDirectory, 'deepchat'), '#!/bin/sh\n', { mode: 0o755 })
  await writeFile(path.join(cliDirectory, 'deepchat.cmd'), '@echo off\r\n')
  await writeFile(path.join(cliDirectory, 'deepchat.mjs'), 'console.log("deepchat")\n')
  const runtimeNode = path.join(
    root,
    'runtime',
    'node',
    platform === 'win32' ? 'node.exe' : path.join('bin', 'node')
  )
  await mkdir(path.dirname(runtimeNode), { recursive: true })
  await writeFile(runtimeNode, 'fixture runtime\n', { mode: 0o755 })
  let currentCliDirectory: string | null = cliDirectory
  const service = new CliLauncherService({
    platform,
    homeDirectory,
    userDataDirectory,
    localAppDataDirectory,
    environmentPath:
      platform === 'win32'
        ? `${path.join(localAppDataDirectory, 'Microsoft', 'WindowsApps')};C:\\Windows\\System32`
        : '/usr/bin:/bin',
    shell: '/bin/zsh',
    resolveCliDirectory: () => currentCliDirectory
  })
  return {
    root,
    homeDirectory,
    userDataDirectory,
    localAppDataDirectory,
    cliDirectory,
    runtimeNode,
    service,
    setCliDirectory: (directory: string | null) => {
      currentCliDirectory = directory
    }
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('CliLauncherService', () => {
  it('installs and reverses a POSIX launcher without changing existing shell content', async () => {
    const fixture = await createFixture()
    const profilePath = path.join(fixture.homeDirectory, '.zprofile')
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    await writeFile(profilePath, 'export EDITOR=vim\n')

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'not-installed',
      commandPath,
      shellConfigPath: null
    })
    await expect(fixture.service.ensureInstalled()).resolves.toMatchObject({
      state: 'installed',
      commandPath,
      shellConfigPath: profilePath
    })
    const commandStats = await lstat(commandPath)
    const command = await readFile(commandPath, 'utf8')
    expect(commandStats.isFile()).toBe(true)
    expect(commandStats.isSymbolicLink()).toBe(false)
    if (supportsPosixFilesystemSemantics) expect(commandStats.mode & 0o111).not.toBe(0)
    expect(command).toContain(`runtime_node='${fixture.runtimeNode}'`)
    expect(command).toContain(`cli_module='${path.join(fixture.cliDirectory, 'deepchat.mjs')}'`)
    expect(command).not.toContain('command -v node')
    expect(await readFile(profilePath, 'utf8')).toBe(
      [
        'export EDITOR=vim',
        '',
        '# >>> DeepChat CLI >>>',
        'case ":$PATH:" in',
        '  *":$HOME/.local/bin:"*) ;;',
        '  *) export PATH="$HOME/.local/bin:$PATH" ;;',
        'esac',
        '# <<< DeepChat CLI <<<',
        ''
      ].join('\n')
    )
    const markerStats = await lstat(
      path.join(fixture.userDataDirectory, 'local-control', 'launcher.json')
    )
    expect(markerStats.isFile()).toBe(true)
    if (supportsPosixFilesystemSemantics) expect(markerStats.mode & 0o777).toBe(0o600)

    await expect(fixture.service.removeOwnedLauncher()).resolves.toMatchObject({
      state: 'not-installed'
    })
    await expect(lstat(commandPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(profilePath, 'utf8')).toBe('export EDITOR=vim\n')
    await expect(
      lstat(path.join(fixture.userDataDirectory, 'local-control', 'launcher.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not edit a shell profile when the user command directory is already on PATH', async () => {
    const fixture = await createFixture()
    const binDirectory = path.join(fixture.homeDirectory, '.local', 'bin')
    const service = new CliLauncherService({
      platform: 'linux',
      homeDirectory: fixture.homeDirectory,
      userDataDirectory: fixture.userDataDirectory,
      environmentPath: `/usr/bin:${binDirectory}`,
      shell: '/bin/bash',
      resolveCliDirectory: () => fixture.cliDirectory
    })

    await expect(service.ensureInstalled()).resolves.toMatchObject({
      state: 'installed',
      shellConfigPath: null
    })
    await expect(lstat(path.join(fixture.homeDirectory, '.bashrc'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('uses platform defaults when GUI startup has no shell environment', async () => {
    const macFixture = await createFixture()
    const macService = new CliLauncherService({
      platform: 'darwin',
      homeDirectory: macFixture.homeDirectory,
      userDataDirectory: macFixture.userDataDirectory,
      environmentPath: '/usr/bin:/bin',
      resolveCliDirectory: () => macFixture.cliDirectory
    })
    await expect(macService.ensureInstalled()).resolves.toMatchObject({
      shellConfigPath: path.join(macFixture.homeDirectory, '.zprofile')
    })

    const linuxFixture = await createFixture('linux')
    const linuxService = new CliLauncherService({
      platform: 'linux',
      homeDirectory: linuxFixture.homeDirectory,
      userDataDirectory: linuxFixture.userDataDirectory,
      environmentPath: '/usr/bin:/bin',
      resolveCliDirectory: () => linuxFixture.cliDirectory
    })
    await expect(linuxService.ensureInstalled()).resolves.toMatchObject({
      shellConfigPath: path.join(linuxFixture.homeDirectory, '.bashrc')
    })
  })

  it('restores a profile byte-for-byte and removes a profile it created', async () => {
    const fixture = await createFixture()
    const profilePath = path.join(fixture.homeDirectory, '.zprofile')
    await writeFile(profilePath, 'export EDITOR=vim')

    await fixture.service.ensureInstalled()
    await fixture.service.removeOwnedLauncher()
    expect(await readFile(profilePath, 'utf8')).toBe('export EDITOR=vim')

    await rm(profilePath)
    await fixture.service.ensureInstalled()
    expect((await lstat(profilePath)).isFile()).toBe(true)
    await fixture.service.removeOwnedLauncher()
    await expect(lstat(profilePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves user shell changes across repeated startup reconciliation', async () => {
    const fixture = await createFixture()
    const profilePath = path.join(fixture.homeDirectory, '.zprofile')
    await writeFile(profilePath, 'export BEFORE=1\n')
    await fixture.service.ensureInstalled()
    const changedContent = `${await readFile(profilePath, 'utf8')}export AFTER=1\n`
    await writeFile(profilePath, changedContent)

    await expect(fixture.service.ensureInstalled()).resolves.toMatchObject({
      state: 'installed'
    })

    expect(await readFile(profilePath, 'utf8')).toBe(changedContent)
  })

  it('refuses to overwrite an unowned command or an orphaned managed block', async () => {
    const fixture = await createFixture()
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    await mkdir(path.dirname(commandPath), { recursive: true })
    await writeFile(commandPath, 'foreign')

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'conflict',
      reason: 'unowned-command'
    })
    await expect(fixture.service.ensureInstalled()).rejects.toThrow('without an ownership marker')
    expect(await readFile(commandPath, 'utf8')).toBe('foreign')

    await rm(commandPath)
    await writeFile(
      path.join(fixture.homeDirectory, '.zprofile'),
      '# >>> DeepChat CLI >>>\ncustom\n# <<< DeepChat CLI <<<\n'
    )
    await expect(fixture.service.ensureInstalled()).rejects.toThrow('without an ownership marker')
  })

  posixIt('fails closed when an owned command or shell block is modified', async () => {
    const fixture = await createFixture()
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    const profilePath = path.join(fixture.homeDirectory, '.zprofile')
    await fixture.service.ensureInstalled()
    const installedCommand = await readFile(commandPath, 'utf8')
    await rm(commandPath)
    await symlink('/tmp/not-deepchat', commandPath)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'conflict',
      reason: 'command-modified'
    })
    await expect(fixture.service.removeOwnedLauncher()).rejects.toThrow('unowned')
    expect(await readlink(commandPath)).toBe('/tmp/not-deepchat')

    await rm(commandPath)
    await writeFile(commandPath, installedCommand, { mode: 0o755 })
    await writeFile(
      profilePath,
      (await readFile(profilePath, 'utf8'))
        .replace('fish_add_path', 'changed')
        .replace('export PATH=', 'export CHANGED=')
    )
    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'conflict',
      reason: 'shell-config-modified'
    })
    await expect(fixture.service.removeOwnedLauncher()).rejects.toThrow('modified')
  })

  it('repairs missing owned files while ensuring launcher availability', async () => {
    const fixture = await createFixture()
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    await fixture.service.ensureInstalled()
    await rm(commandPath)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'needs-repair',
      reason: 'command-missing'
    })
    await expect(fixture.service.ensureInstalled()).resolves.toMatchObject({ state: 'installed' })
    const repairedCommand = await lstat(commandPath)
    expect(repairedCommand.isFile()).toBe(true)
    expect(repairedCommand.isSymbolicLink()).toBe(false)
    if (supportsPosixFilesystemSemantics) expect(repairedCommand.mode & 0o111).not.toBe(0)
  })

  it('refreshes only a stale launcher whose previous content is still owned', async () => {
    const fixture = await createFixture()
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    await fixture.service.ensureInstalled()
    const nextCliDirectory = path.join(fixture.root, 'cli-v2')
    await mkdir(nextCliDirectory)
    await writeFile(path.join(nextCliDirectory, 'deepchat'), '#!/bin/sh\n', { mode: 0o755 })
    await writeFile(path.join(nextCliDirectory, 'deepchat.mjs'), 'console.log("v2")\n')
    fixture.setCliDirectory(nextCliDirectory)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'stale',
      reason: 'upgrade-required'
    })
    await fixture.service.ensureInstalled()
    const refreshedCommand = await readFile(commandPath, 'utf8')
    expect(refreshedCommand).toContain(
      `cli_module='${path.join(nextCliDirectory, 'deepchat.mjs')}'`
    )
    expect(refreshedCommand).not.toContain(fixture.cliDirectory)
    await expect(fixture.service.getStatus()).resolves.toMatchObject({ state: 'installed' })
  })

  posixIt('migrates an owned legacy POSIX symlink to the stable command shim', async () => {
    const fixture = await createFixture()
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    const markerPath = path.join(fixture.userDataDirectory, 'local-control', 'launcher.json')
    await fixture.service.ensureInstalled()

    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
    delete marker.commandHash
    await writeFile(markerPath, `${JSON.stringify(marker)}\n`)
    await rm(commandPath)
    await symlink(path.join(fixture.cliDirectory, 'deepchat'), commandPath)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'stale',
      reason: 'upgrade-required'
    })
    await expect(fixture.service.ensureInstalled()).resolves.toMatchObject({ state: 'installed' })

    const migratedStats = await lstat(commandPath)
    const migratedMarker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
    expect(migratedStats.isFile()).toBe(true)
    expect(migratedStats.isSymbolicLink()).toBe(false)
    expect(migratedMarker.commandHash).toMatch(/^[0-9a-f]{64}$/)
  })

  posixIt('fails closed when an owned POSIX shim loses its executable mode', async () => {
    const fixture = await createFixture()
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    await fixture.service.ensureInstalled()
    await chmod(commandPath, 0o644)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'conflict',
      reason: 'command-modified'
    })
    await expect(fixture.service.ensureInstalled()).rejects.toThrow('unowned')
  })

  it('reports an oversized shell profile without classifying it as modified', async () => {
    const fixture = await createFixture()
    const profilePath = path.join(fixture.homeDirectory, '.zprofile')
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    const originalProfile = Buffer.alloc(1024 * 1024 + 1, 0x61)
    await writeFile(profilePath, originalProfile)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'shell-config-too-large',
      shellConfigPath: profilePath
    })
    await expect(fixture.service.ensureInstalled()).rejects.toThrow('exceeds the supported size')
    await expect(lstat(commandPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(profilePath)).toEqual(originalProfile)
  })

  it('ignores an oversized profile that is unrelated to the selected shell', async () => {
    const fixture = await createFixture()
    const unrelatedProfilePath = path.join(fixture.homeDirectory, '.bash_profile')
    await writeFile(unrelatedProfilePath, Buffer.alloc(1024 * 1024 + 1, 0x61))

    await expect(fixture.service.ensureInstalled()).resolves.toMatchObject({ state: 'installed' })
    expect((await lstat(unrelatedProfilePath)).size).toBe(1024 * 1024 + 1)
  })

  it('uses an owned Windows command shim and refreshes it across app paths', async () => {
    const fixture = await createFixture('win32')
    const commandPath = path.join(
      fixture.localAppDataDirectory,
      'Microsoft',
      'WindowsApps',
      'deepchat.cmd'
    )

    await expect(fixture.service.ensureInstalled()).resolves.toMatchObject({
      state: 'installed',
      commandPath,
      shellConfigPath: null
    })
    expect(await readFile(commandPath, 'utf8')).toContain(
      `set "cli_module=${path.join(fixture.cliDirectory, 'deepchat.mjs')}"`
    )
    expect(await readFile(commandPath, 'utf8')).toContain(
      `set "runtime_node=${fixture.runtimeNode}"`
    )
    expect(await readFile(commandPath, 'utf8')).not.toContain('where node')

    const nextCliDirectory = path.join(fixture.root, 'cli-win-v2')
    await mkdir(nextCliDirectory)
    await writeFile(path.join(nextCliDirectory, 'deepchat.mjs'), 'console.log("v2")\n')
    fixture.setCliDirectory(nextCliDirectory)
    await expect(fixture.service.getStatus()).resolves.toMatchObject({ state: 'stale' })
    await fixture.service.ensureInstalled()
    expect(await readFile(commandPath, 'utf8')).toContain(
      `set "cli_module=${path.join(nextCliDirectory, 'deepchat.mjs')}"`
    )

    await expect(fixture.service.removeOwnedLauncher()).resolves.toMatchObject({
      state: 'not-installed'
    })
    await expect(lstat(commandPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('matches an owned Windows marker path without case sensitivity', async () => {
    const fixture = await createFixture('win32')
    const markerPath = path.join(fixture.userDataDirectory, 'local-control', 'launcher.json')
    const commandPath = path.join(
      fixture.localAppDataDirectory,
      'Microsoft',
      'WindowsApps',
      'deepchat.cmd'
    )
    await fixture.service.ensureInstalled()
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
    marker.commandPath = String(marker.commandPath).toUpperCase()
    await writeFile(markerPath, `${JSON.stringify(marker)}\n`)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({ state: 'installed' })
    await expect(fixture.service.ensureInstalled()).resolves.toMatchObject({ state: 'installed' })
    await expect(fixture.service.removeOwnedLauncher()).resolves.toMatchObject({
      state: 'not-installed'
    })
    await expect(lstat(commandPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not claim Windows installation when its user command directory is off PATH', async () => {
    const fixture = await createFixture('win32')
    const service = new CliLauncherService({
      platform: 'win32',
      homeDirectory: fixture.homeDirectory,
      userDataDirectory: fixture.userDataDirectory,
      localAppDataDirectory: fixture.localAppDataDirectory,
      environmentPath: 'C:\\Windows\\System32',
      resolveCliDirectory: () => fixture.cliDirectory
    })

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'path-unavailable'
    })
    await expect(service.ensureInstalled()).rejects.toThrow('not available on PATH')
  })

  it('reports an unavailable source without creating installation state', async () => {
    const fixture = await createFixture()
    fixture.setCliDirectory(null)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'source-missing'
    })
    await expect(fixture.service.ensureInstalled()).rejects.toThrow('unavailable')
  })

  it('can remove owned integration after the packaged source disappears', async () => {
    const fixture = await createFixture()
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    const profilePath = path.join(fixture.homeDirectory, '.zprofile')
    await fixture.service.ensureInstalled()
    fixture.setCliDirectory(null)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'source-missing'
    })

    await expect(fixture.service.removeOwnedLauncher()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'source-missing'
    })
    await expect(lstat(commandPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(profilePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('prioritizes a missing packaged source over missing owned files', async () => {
    const fixture = await createFixture()
    const commandPath = path.join(fixture.homeDirectory, '.local', 'bin', 'deepchat')
    await fixture.service.ensureInstalled()
    await rm(commandPath)
    fixture.setCliDirectory(null)

    await expect(fixture.service.getStatus()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'source-missing'
    })
  })
})
