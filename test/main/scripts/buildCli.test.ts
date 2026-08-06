import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
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

async function provisionBundledRuntime(outputDirectory: string): Promise<void> {
  const runtimeNode = path.resolve(
    outputDirectory,
    '..',
    'runtime',
    'node',
    process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node')
  )
  await mkdir(path.dirname(runtimeNode), { recursive: true })
  if (process.platform === 'win32') {
    await copyFile(process.execPath, runtimeNode)
  } else {
    await symlink(process.execPath, runtimeNode)
  }
}

describe('CLI bundle', () => {
  it('builds a standalone Node entry and explicit bundled-runtime launchers', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-build-'))
    const outputDirectory = path.join(temporaryDirectory, 'cli')
    try {
      await buildCli({ outDir: outputDirectory, logLevel: 'silent' })
      await provisionBundledRuntime(outputDirectory)
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
      expect(POSIX_LAUNCHER).toContain('../runtime/node/bin/node')
      expect(POSIX_LAUNCHER).toContain('../../runtime/node/bin/node')
      expect(POSIX_LAUNCHER).not.toContain('command -v node')
      expect(WINDOWS_LAUNCHER).toContain('..\\runtime\\node\\node.exe')
      expect(WINDOWS_LAUNCHER).toContain('..\\..\\runtime\\node\\node.exe')
      expect(WINDOWS_LAUNCHER).not.toContain('where node')
      expect(WINDOWS_LAUNCHER).not.toContain('node "%~dp0deepchat.mjs"')
    } finally {
      await rm(temporaryDirectory, { recursive: true })
    }
  }, CLI_BUILD_TEST_TIMEOUT_MS)

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
