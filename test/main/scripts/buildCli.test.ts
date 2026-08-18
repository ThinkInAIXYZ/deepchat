import { execFile } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  POSIX_LAUNCHER,
  WINDOWS_LAUNCHER,
  buildCli
} from '../../../scripts/build-cli.mjs'

const execFileAsync = promisify(execFile)
const CLI_BUILD_TEST_TIMEOUT_MS = 30_000

async function runGeneratedLauncher(outputDirectory: string) {
  if (process.platform === 'win32') {
    const launcherPath = path.join(outputDirectory, 'deepchat.cmd')
    return await execFileAsync(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', `"${launcherPath}" help`],
      { env: { ...process.env, PATH: '' } }
    )
  }
  return await execFileAsync(path.join(outputDirectory, 'deepchat'), ['help'], {
    env: { ...process.env, PATH: '' }
  })
}

async function provisionElectronHost(outputDirectory: string): Promise<void> {
  const appRoot = path.resolve(outputDirectory, '..', '..', '..')
  const hostName = process.platform === 'win32' ? 'DeepChat.exe' : 'DeepChat'
  const hosts = [
    path.join(appRoot, hostName),
    path.join(appRoot, 'MacOS', 'DeepChat'),
    path.join(appRoot, 'deepchat')
  ]
  for (const host of hosts) {
    await mkdir(path.dirname(host), { recursive: true })
    try {
      await symlink(process.execPath, host)
    } catch {
      await copyFile(process.execPath, host)
      if (process.platform !== 'win32') {
        await chmod(host, 0o755)
      }
    }
  }
}

describe('CLI bundle', () => {
  it('builds a standalone Node entry and Electron-hosted launchers', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-build-'))
    const outputDirectory = path.join(
      temporaryDirectory,
      'resources',
      'app.asar.unpacked',
      'cli'
    )
    try {
      await buildCli({ outDir: outputDirectory, logLevel: 'silent' })
      await provisionElectronHost(outputDirectory)
      const entryPath = path.join(outputDirectory, 'deepchat.mjs')
      const source = await readFile(entryPath, 'utf8')
      const result = await execFileAsync(process.execPath, [entryPath, 'help'])
      const launcherResult = await runGeneratedLauncher(outputDirectory)

      expect(source.startsWith('#!/usr/bin/env node')).toBe(true)
      expect(source).not.toMatch(/from\s+["']zod["']/)
      expect(result.stdout).toContain('deepchat <domain> <verb>')
      expect(launcherResult.stdout).toContain('deepchat <domain> <verb>')
      if (process.platform !== 'win32') {
        expect((await stat(path.join(outputDirectory, 'deepchat'))).mode & 0o111).toBe(0o111)
      }
      expect(await readFile(path.join(outputDirectory, 'deepchat'), 'utf8')).toBe(POSIX_LAUNCHER)
      expect(await readFile(path.join(outputDirectory, 'deepchat.cmd'), 'utf8')).toBe(
        WINDOWS_LAUNCHER
      )
      expect(POSIX_LAUNCHER).toContain('ELECTRON_RUN_AS_NODE=1')
      expect(POSIX_LAUNCHER).toContain('../../../MacOS/DeepChat')
      expect(POSIX_LAUNCHER).toContain('../../../deepchat.bin')
      expect(POSIX_LAUNCHER).toContain('../../../DeepChat')
      expect(POSIX_LAUNCHER).toContain('[ -f "$candidate" ] && [ -x "$candidate" ]')
      expect(POSIX_LAUNCHER).toContain(
        'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
      )
      expect(POSIX_LAUNCHER).not.toContain('command -v node')
      expect(POSIX_LAUNCHER).not.toContain('runtime/node')
      expect(WINDOWS_LAUNCHER).toContain('setlocal')
      expect(WINDOWS_LAUNCHER).toContain('ELECTRON_RUN_AS_NODE=1')
      expect(WINDOWS_LAUNCHER).toContain('node_modules\\electron\\dist\\electron.exe')
      expect(WINDOWS_LAUNCHER).toContain('..\\..\\..\\DeepChat.exe')
      expect(WINDOWS_LAUNCHER).toContain('if exist "%electron_host%\\" goto missing_runtime')
      expect(WINDOWS_LAUNCHER).not.toContain('where node')
      expect(WINDOWS_LAUNCHER).not.toContain('runtime\\node')
      expect(WINDOWS_LAUNCHER).not.toContain('node "%~dp0deepchat.mjs"')
    } finally {
      await rm(temporaryDirectory, { recursive: true })
    }
  }, CLI_BUILD_TEST_TIMEOUT_MS)

  it.skipIf(process.platform === 'win32')(
    'skips a directory candidate and uses the dest Electron binary',
    async () => {
      const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-dir-host-'))
      const outputDirectory = path.join(temporaryDirectory, 'workspace', 'out', 'cli')
      const decoy = path.resolve(outputDirectory, '../../../DeepChat')
      const electronHost = path.resolve(
        outputDirectory,
        '../../node_modules/electron/dist/electron'
      )
      try {
        expect(decoy.startsWith(temporaryDirectory + path.sep)).toBe(true)
        await mkdir(outputDirectory, { recursive: true })
        await mkdir(decoy, { recursive: true })
        await mkdir(path.dirname(electronHost), { recursive: true })
        await symlink(process.execPath, electronHost)
        await writeFile(path.join(outputDirectory, 'deepchat'), POSIX_LAUNCHER, { mode: 0o755 })
        await chmod(path.join(outputDirectory, 'deepchat'), 0o755)
        await writeFile(
          path.join(outputDirectory, 'deepchat.mjs'),
          "console.log(process.argv.slice(2).join(','))\n",
          'utf8'
        )

        const result = await execFileAsync(path.join(outputDirectory, 'deepchat'), ['status'])
        expect(result.stdout.trim()).toBe('status')
      } finally {
        await rm(temporaryDirectory, { recursive: true })
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'prefers the Linux deepchat.bin host over the --no-sandbox wrapper',
    async () => {
      const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-linux-host-'))
      const outputDirectory = path.join(
        temporaryDirectory,
        'resources',
        'app.asar.unpacked',
        'cli'
      )
      const wrapper = path.join(temporaryDirectory, 'deepchat')
      const electronHost = path.join(temporaryDirectory, 'deepchat.bin')
      try {
        await mkdir(outputDirectory, { recursive: true })
        await writeFile(
          wrapper,
          '#!/bin/sh\necho bad option: --no-sandbox >&2\nexit 9\n',
          { mode: 0o755 }
        )
        await chmod(wrapper, 0o755)
        await symlink(process.execPath, electronHost)
        await writeFile(path.join(outputDirectory, 'deepchat'), POSIX_LAUNCHER, { mode: 0o755 })
        await chmod(path.join(outputDirectory, 'deepchat'), 0o755)
        await writeFile(
          path.join(outputDirectory, 'deepchat.mjs'),
          "console.log(process.argv.slice(2).join(','))\n",
          'utf8'
        )

        const result = await execFileAsync(path.join(outputDirectory, 'deepchat'), ['status'])

        expect(result.stdout.trim()).toBe('status')
      } finally {
        await rm(temporaryDirectory, { recursive: true })
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'runs the POSIX launcher against the packaged Electron host',
    async () => {
      const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-msys-'))
      const outputDirectory = path.join(
        temporaryDirectory,
        'resources',
        'app.asar.unpacked',
        'cli'
      )
      const electronHost = path.join(temporaryDirectory, 'DeepChat')
      try {
        await mkdir(outputDirectory, { recursive: true })
        await mkdir(path.dirname(electronHost), { recursive: true })
        await symlink(process.execPath, electronHost)
        await writeFile(path.join(outputDirectory, 'deepchat'), POSIX_LAUNCHER, { mode: 0o755 })
        await chmod(path.join(outputDirectory, 'deepchat'), 0o755)
        await writeFile(
          path.join(outputDirectory, 'deepchat.mjs'),
          "console.log(process.argv.slice(2).join(','))\n",
          'utf8'
        )

        const result = await execFileAsync(path.join(outputDirectory, 'deepchat'), ['status'])

        expect(result.stdout.trim()).toBe('status')
      } finally {
        await rm(temporaryDirectory, { recursive: true })
      }
    }
  )

  it('packages only generated CLI resources outside app.asar', async () => {
    const config = parse(await readFile(path.resolve('electron-builder.yml'), 'utf8')) as {
      files: string[]
      extraResources: Array<{ from: string; to: string; filter?: string[] }>
    }

    expect(config.files).toContain('!out/cli/**')
    expect(config.extraResources).toContainEqual({
      from: './out/cli/',
      to: 'app.asar.unpacked/cli',
      filter: ['deepchat', 'deepchat.cmd', 'deepchat.mjs']
    })
  })
})
