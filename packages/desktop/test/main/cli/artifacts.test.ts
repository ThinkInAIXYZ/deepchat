import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeepchatRouteName } from '@shared/contracts/routes'
import {
  LOCAL_CONTROL_AGENT_TOKEN_ENV,
  LocalControlRpcResponseSchema
} from '@shared/contracts/localControl'
import { ArtifactSpool } from '@/cli/artifactSpool'
import { createArtifactRoutes } from '@/cli/artifactRoutes'
import { CliServer } from '@/cli/server'
import type { CliRouteCaller, HumanCliRouteCaller } from '@/routes/routeRegistry'
import { publishArtifactDownload } from '../../../src/cli/artifacts'
import { runCli } from '../../../src/cli/run'

const servers: CliServer[] = []
const spools: ArtifactSpool[] = []
const temporaryDirectories: string[] = []

const originCaller: HumanCliRouteCaller = {
  kind: 'cli',
  principal: 'human',
  connectionId: 'origin',
  scopes: ['artifacts:read', 'artifacts:manage']
}

function captureOutput(): { stream: NodeJS.WriteStream; read(): string } {
  let value = ''
  return {
    stream: {
      write: (chunk: string | Uint8Array) => {
        value += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        return true
      }
    } as NodeJS.WriteStream,
    read: () => value
  }
}

async function createHarness(): Promise<{
  userDataPath: string
  spool: ArtifactSpool
}> {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-artifacts-'))
  temporaryDirectories.push(userDataPath)
  const spool = new ArtifactSpool({
    directory: path.join(userDataPath, 'local-control', 'artifacts')
  })
  spools.push(spool)
  await spool.initialize()
  const routes = createArtifactRoutes(spool)
  const server = new CliServer({
    userDataPath,
    appVersion: '1.2.3',
    artifactSpool: spool,
    dispatch: async (method: string, input: unknown, caller: CliRouteCaller) => {
      const route = routes.get(method as DeepchatRouteName)
      if (!route) throw new Error(`Unknown artifact test route: ${method}`)
      return await route(input, { caller })
    },
    log: { warn: vi.fn(), error: vi.fn() }
  })
  servers.push(server)
  await server.start()
  return { userDataPath, spool }
}

function invoke(argv: readonly string[], env: NodeJS.ProcessEnv) {
  const stdout = captureOutput()
  const stderr = captureOutput()
  return {
    result: runCli(argv, {
      env,
      stdout: stdout.stream,
      stderr: stderr.stream,
      signalHost: new EventEmitter() as unknown as NodeJS.Process,
      randomId: () => 'request-1',
      forceExit: vi.fn()
    }),
    stdout,
    stderr
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  await Promise.allSettled(spools.splice(0).map((spool) => spool.close()))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('artifact CLI', () => {
  it('publishes without overwrite when the destination filesystem rejects hardlinks', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-artifact-output-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, '.source.tmp')
    const outputPath = path.join(directory, 'output.bin')
    const portableOutput = Buffer.from(
      Array.from({ length: 128 * 1024 + 17 }, (_, index) => index % 251)
    )
    await writeFile(sourcePath, portableOutput)
    const unsupportedLink = vi.fn(async () => {
      throw Object.assign(new Error('hardlinks are unavailable'), { code: 'EPERM' })
    })

    await publishArtifactDownload(sourcePath, outputPath, false, unsupportedLink)
    expect(await readFile(outputPath)).toEqual(portableOutput)

    const replacementPath = path.join(directory, '.replacement.tmp')
    await writeFile(replacementPath, 'replacement')
    await expect(
      publishArtifactDownload(replacementPath, outputPath, false, unsupportedLink)
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(outputPath)).toEqual(portableOutput)
  })

  it('downloads verified bytes and emits the canonical machine envelope', async () => {
    const { userDataPath, spool } = await createHarness()
    const artifact = await spool.write({
      caller: originCaller,
      requestId: 'generation-1',
      mimeType: 'image/png',
      suggestedFilename: 'generated.png',
      data: Buffer.from('generated-image')
    })
    const outputPath = path.join(userDataPath, 'result.png')
    const invocation = invoke(
      ['artifact', 'get', '--id', artifact.id, '--out', outputPath, '--json'],
      { DEEPCHAT_E2E_USER_DATA_DIR: userDataPath }
    )

    await expect(invocation.result).resolves.toBe(0)
    expect(await readFile(outputPath, 'utf8')).toBe('generated-image')
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(invocation.stdout.read()))).toMatchObject(
      {
        ok: true,
        result: { artifact: { id: artifact.id, sha256: artifact.sha256 } }
      }
    )
    expect(invocation.stderr.read()).toBe('')
  })

  it('preserves an existing file unless overwrite is explicit', async () => {
    const { userDataPath, spool } = await createHarness()
    const artifact = await spool.write({
      caller: originCaller,
      requestId: 'generation-1',
      mimeType: 'application/octet-stream',
      data: Buffer.from('replacement')
    })
    const outputPath = path.join(userDataPath, 'existing.bin')
    await writeFile(outputPath, 'original')

    const refused = invoke(['artifact', 'get', '--id', artifact.id, '--out', outputPath], {
      DEEPCHAT_E2E_USER_DATA_DIR: userDataPath
    })
    await expect(refused.result).resolves.toBe(6)
    expect(await readFile(outputPath, 'utf8')).toBe('original')

    const replaced = invoke(
      ['artifact', 'get', '--id', artifact.id, '--out', outputPath, '--overwrite'],
      { DEEPCHAT_E2E_USER_DATA_DIR: userDataPath }
    )
    await expect(replaced.result).resolves.toBe(0)
    expect(await readFile(outputPath, 'utf8')).toBe('replacement')
  })

  it('rejects changed bytes and removes partial output', async () => {
    const { userDataPath, spool } = await createHarness()
    const artifact = await spool.write({
      caller: originCaller,
      requestId: 'generation-1',
      mimeType: 'application/octet-stream',
      data: Buffer.from('expected')
    })
    await writeFile(
      path.join(userDataPath, 'local-control', 'artifacts', `${artifact.id}.artifact`),
      'tampered'
    )
    const outputPath = path.join(userDataPath, 'changed.bin')
    const invocation = invoke(['artifact', 'get', '--id', artifact.id, '--out', outputPath], {
      DEEPCHAT_E2E_USER_DATA_DIR: userDataPath
    })

    await expect(invocation.result).resolves.toBe(8)
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(userDataPath)).filter((entry) => entry.startsWith('.deepchat-'))).toEqual(
      []
    )
  })

  it('rejects Agent byte downloads before route dispatch', async () => {
    const { userDataPath, spool } = await createHarness()
    const artifact = await spool.write({
      caller: originCaller,
      requestId: 'generation-1',
      mimeType: 'image/png',
      data: Buffer.from('private')
    })
    const outputPath = path.join(userDataPath, 'agent-output.png')
    const invocation = invoke(
      ['artifact', 'get', '--id', artifact.id, '--out', outputPath, '--json'],
      {
        DEEPCHAT_E2E_USER_DATA_DIR: userDataPath,
        [LOCAL_CONTROL_AGENT_TOKEN_ENV]: 'a'.repeat(43)
      }
    )

    await expect(invocation.result).resolves.toBe(4)
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(invocation.stdout.read()))).toMatchObject(
      {
        ok: false,
        error: { code: 'permission_denied' }
      }
    )
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('describes and deletes artifacts through typed RPC routes', async () => {
    const { userDataPath, spool } = await createHarness()
    const artifact = await spool.write({
      caller: originCaller,
      requestId: 'generation-1',
      mimeType: 'text/plain',
      data: Buffer.from('result')
    })
    const env = { DEEPCHAT_E2E_USER_DATA_DIR: userDataPath }

    const described = invoke(['artifact', 'describe', '--id', artifact.id, '--json'], env)
    await expect(described.result).resolves.toBe(0)
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(described.stdout.read()))).toMatchObject({
      ok: true,
      result: { artifact: { id: artifact.id } }
    })

    const deleted = invoke(['artifact', 'delete', '--id', artifact.id], env)
    await expect(deleted.result).resolves.toBe(0)
    await expect(spool.describe(artifact.id, originCaller)).rejects.toMatchObject({
      code: 'not_found'
    })
  })
})
