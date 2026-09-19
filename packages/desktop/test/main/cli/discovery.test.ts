import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LOCAL_CONTROL_AGENT_TOKEN_ENV,
  LOCAL_CONTROL_DESCRIPTOR_FILENAME,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SURFACE_VERSION,
  type LocalControlDescriptor
} from '@shared/contracts/localControl'
import {
  loadLocalControlDescriptor,
  resolveCliUserDataPath,
  selectLocalControlToken
} from '../../../src/cli/discovery'

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-discovery-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('CLI descriptor discovery', () => {
  it('mirrors Electron default and explicit profile paths', () => {
    expect(
      resolveCliUserDataPath({ platform: 'darwin', homeDirectory: '/Users/test', env: {} })
    ).toBe('/Users/test/Library/Application Support/DeepChat')
    expect(
      resolveCliUserDataPath({ platform: 'linux', homeDirectory: '/home/test', env: {} })
    ).toBe('/home/test/.config/DeepChat')
    expect(
      resolveCliUserDataPath({
        platform: 'win32',
        homeDirectory: 'C:\\Users\\test',
        env: { APPDATA: 'D:\\Profiles' }
      })
    ).toBe(path.join('D:\\Profiles', 'DeepChat'))
    expect(
      resolveCliUserDataPath({
        env: { DEEPCHAT_E2E_USER_DATA_DIR: '  ./profile  ' },
        homeDirectory: '/unused'
      })
    ).toBe(path.resolve('./profile'))
  })

  it('fails closed when an Agent token variable is present but invalid', () => {
    const descriptor = { token: 'h'.repeat(43) } as LocalControlDescriptor

    expect(selectLocalControlToken(descriptor, {})).toBe('h'.repeat(43))
    expect(
      selectLocalControlToken(descriptor, { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: 'a'.repeat(43) })
    ).toBe('a'.repeat(43))
    expect(() =>
      selectLocalControlToken(descriptor, { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' })
    ).toThrow('refusing human-token fallback')
  })

  it('reports incompatible descriptor versions before connecting', async () => {
    const userDataPath = await createTemporaryDirectory()
    const controlDirectory = path.join(userDataPath, 'local-control')
    const descriptorPath = path.join(controlDirectory, LOCAL_CONTROL_DESCRIPTOR_FILENAME)
    await mkdir(controlDirectory, { recursive: true })
    await writeFile(
      descriptorPath,
      JSON.stringify({
        protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION + 1,
        surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
        appVersion: '2.0.0',
        endpoint: { kind: 'unix', path: '/tmp/deepchat.sock' },
        pid: process.pid,
        token: 't'.repeat(43),
        startedAt: Date.now()
      }),
      { mode: 0o600 }
    )
    if (process.platform !== 'win32') await chmod(descriptorPath, 0o600)

    await expect(
      loadLocalControlDescriptor({
        env: { DEEPCHAT_E2E_USER_DATA_DIR: userDataPath },
        processAlive: () => true
      })
    ).rejects.toMatchObject({ code: 'unsupported_version', exitCode: 3 })
  })
})
