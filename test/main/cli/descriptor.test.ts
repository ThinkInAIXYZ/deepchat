import { createServer, type Server } from 'node:net'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalControlDescriptorSchema } from '@shared/contracts/localControl'
import {
  cleanupLocalControlLayout,
  createLocalControlLayout,
  prepareLocalControlLayout,
  writeLocalControlDescriptor
} from '@/cli/descriptor'

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-descriptor-'))
  temporaryDirectories.push(directory)
  return directory
}

async function listenOnUnixSocket(socketPath: string): Promise<Server> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  return server
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe.skipIf(process.platform === 'win32')('CLI discovery descriptor', () => {
  it('writes a private validated descriptor and cleans matching state', async () => {
    const userDataPath = await createTemporaryDirectory()
    const layout = createLocalControlLayout(userDataPath, 'darwin')
    await prepareLocalControlLayout(layout, 'darwin')

    const descriptor = await writeLocalControlDescriptor(
      layout,
      {
        appVersion: '1.2.3',
        endpoint: layout.endpoint,
        pid: 42,
        token: 'a'.repeat(43),
        startedAt: 1
      },
      'darwin'
    )

    expect(
      LocalControlDescriptorSchema.parse(JSON.parse(await readFile(layout.descriptorPath, 'utf8')))
    ).toEqual(descriptor)
    expect((await stat(layout.controlDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(layout.descriptorPath)).mode & 0o777).toBe(0o600)

    await cleanupLocalControlLayout(layout, descriptor.token)
    await expect(stat(layout.descriptorPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes only owned request-body remnants from the private temp directory', async () => {
    const userDataPath = await createTemporaryDirectory()
    const layout = createLocalControlLayout(userDataPath, 'darwin')
    await prepareLocalControlLayout(layout, 'darwin')
    await writeFile(
      path.join(layout.tempDirectory, 'body-123e4567-e89b-42d3-a456-426614174000.tmp'),
      'partial'
    )
    await writeFile(path.join(layout.tempDirectory, 'keep.tmp'), 'foreign')

    await prepareLocalControlLayout(layout, 'darwin')

    expect(await readdir(layout.tempDirectory)).toEqual(['keep.tmp'])
  })

  it('refuses a non-socket endpoint without deleting discovery state', async () => {
    const userDataPath = await createTemporaryDirectory()
    const layout = createLocalControlLayout(userDataPath, 'darwin')
    if (layout.endpoint.kind !== 'unix') throw new Error('Expected a Unix endpoint')
    await mkdir(layout.controlDirectory, { recursive: true })
    await mkdir(layout.endpointDirectory, { recursive: true })
    await writeFile(layout.descriptorPath, 'keep-me')
    await writeFile(layout.endpoint.path, 'not-a-socket')

    await expect(prepareLocalControlLayout(layout, 'darwin')).rejects.toThrow(
      'Refusing to replace a non-socket'
    )
    expect(await readFile(layout.descriptorPath, 'utf8')).toBe('keep-me')
  })

  it('cleans its socket when the descriptor is malformed', async () => {
    const userDataPath = await createTemporaryDirectory()
    const layout = createLocalControlLayout(userDataPath, 'darwin')
    if (layout.endpoint.kind !== 'unix') throw new Error('Expected a Unix endpoint')
    await prepareLocalControlLayout(layout, 'darwin')
    const server = await listenOnUnixSocket(layout.endpoint.path)
    await writeFile(layout.descriptorPath, '{broken-json')

    try {
      await cleanupLocalControlLayout(layout, 'a'.repeat(43))
      await expect(lstat(layout.endpoint.path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(layout.descriptorPath, 'utf8')).toBe('{broken-json')
    } finally {
      await closeServer(server)
    }
  })

  it('does not remove an endpoint claimed by a different valid descriptor', async () => {
    const userDataPath = await createTemporaryDirectory()
    const layout = createLocalControlLayout(userDataPath, 'darwin')
    if (layout.endpoint.kind !== 'unix') throw new Error('Expected a Unix endpoint')
    await prepareLocalControlLayout(layout, 'darwin')
    const server = await listenOnUnixSocket(layout.endpoint.path)
    await writeLocalControlDescriptor(
      layout,
      {
        appVersion: '1.2.3',
        endpoint: layout.endpoint,
        pid: 42,
        token: 'b'.repeat(43),
        startedAt: 1
      },
      'darwin'
    )

    try {
      await cleanupLocalControlLayout(layout, 'a'.repeat(43))
      expect((await lstat(layout.endpoint.path)).isSocket()).toBe(true)
      expect((await stat(layout.descriptorPath)).isFile()).toBe(true)
    } finally {
      await closeServer(server)
    }
  })
})
