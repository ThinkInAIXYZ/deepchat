import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  LOCAL_CONTROL_AGENT_TOKEN_ENV,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SCOPES,
  LOCAL_CONTROL_SURFACE_VERSION,
  LocalControlRpcResponseSchema,
  LocalControlStreamRecordSchema
} from '@shared/contracts/localControl'
import {
  artifactsDescribeRoute,
  cliVersionRoute,
  modelsInvokeRoute,
  ocrExtractUploadRoute
} from '@shared/contracts/routes'
import { ArtifactSpool } from '@/cli/artifactSpool'
import { CliServer, type CliServerDependencies } from '@/cli/server'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import { buildCli } from '../../../scripts/build-cli.mjs'

const execFileAsync = promisify(execFile)
const CLI_PROCESS_TIMEOUT_MS = 5_000
const PACKAGED_SMOKE_TIMEOUT_MS = 30_000

function cliEnvironment(
  userDataPath: string,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const environment = {
    ...process.env,
    DEEPCHAT_E2E_USER_DATA_DIR: userDataPath,
    ...overrides
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, LOCAL_CONTROL_AGENT_TOKEN_ENV)) {
    delete environment[LOCAL_CONTROL_AGENT_TOKEN_ENV]
  }
  return environment
}

describe('packaged CLI smoke', () => {
  async function runPackagedCliSmoke(): Promise<void> {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-smoke-'))
    const outputDirectory = path.join(temporaryDirectory, 'cli')
    const entryPath = path.join(outputDirectory, 'deepchat.mjs')
    const userDataPath = path.join(temporaryDirectory, 'profile')
    const spool = new ArtifactSpool({
      directory: path.join(temporaryDirectory, 'artifacts'),
      cleanupIntervalMs: 60_000
    })
    let server: CliServer | undefined

    try {
      await buildCli({ outDir: outputDirectory, logLevel: 'silent' })
      const seedCaller: CliRouteCaller = {
        kind: 'cli',
        principal: 'human',
        connectionId: 'smoke-seed',
        scopes: LOCAL_CONTROL_SCOPES
      }
      const artifactBytes = Buffer.from('packaged artifact smoke\n')
      const artifact = await spool.write({
        caller: seedCaller,
        requestId: 'packaged-smoke-artifact',
        mimeType: 'text/plain',
        suggestedFilename: 'smoke.txt',
        data: artifactBytes
      })
      const ocrInput = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const ocrInputPath = path.join(temporaryDirectory, 'smoke.png')
      const artifactOutputPath = path.join(temporaryDirectory, 'artifact-output.txt')
      await writeFile(ocrInputPath, ocrInput)

      let resolveShutdownDispatch!: () => void
      const shutdownDispatchStarted = new Promise<void>((resolve) => {
        resolveShutdownDispatch = resolve
      })
      const dispatchStream: NonNullable<CliServerDependencies['dispatchStream']> = async (
        method,
        input,
        _caller,
        _requestId,
        _signal,
        emit
      ) => {
        if (method !== modelsInvokeRoute.name) throw new Error(`Unexpected stream route: ${method}`)
        const parsedInput = modelsInvokeRoute.input.parse(input)
        if (parsedInput.messages.at(-1)?.content === 'wait-for-shutdown') {
          resolveShutdownDispatch()
          return await new Promise<never>(() => undefined)
        }
        await emit(method, { type: 'text_delta', text: 'fixture reply' })
        await emit(method, { type: 'stop', reason: 'complete' })
        return {
          providerId: parsedInput.providerId,
          modelId: parsedInput.modelId,
          text: 'fixture reply',
          finishReason: 'complete',
          latency: { queueMs: 0, firstEventMs: 1, firstTextMs: 1, totalMs: 5 }
        }
      }
      server = new CliServer({
        userDataPath,
        appVersion: 'packaged-smoke',
        artifactSpool: spool,
        dispatch: async (method, input, caller) => {
          if (method === cliVersionRoute.name) {
            return {
              appVersion: 'packaged-smoke',
              protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
              surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION
            }
          }
          if (method === artifactsDescribeRoute.name) {
            const parsedInput = artifactsDescribeRoute.input.parse(input)
            return { artifact: await spool.describe(parsedInput.id, caller) }
          }
          throw new Error(`Unexpected RPC route: ${method}`)
        },
        dispatchStream,
        dispatchUpload: async (method, input, upload) => {
          if (method !== ocrExtractUploadRoute.name) {
            throw new Error(`Unexpected upload route: ${method}`)
          }
          expect(ocrExtractUploadRoute.input.parse(input)).toMatchObject({
            mimeType: 'image/png',
            backend: 'auto'
          })
          expect(await readFile(upload.path)).toEqual(ocrInput)
          return {
            kind: 'image',
            mimeType: 'image/png',
            text: 'fixture OCR text',
            tokenCount: 3,
            truncated: false,
            engine: {
              coreVersion: 'smoke',
              modelBundleId: 'smoke-bundle',
              requestedBackend: 'auto',
              strategy: 'bounded-960',
              detection: { providerChain: ['cpu'], precision: 'fp32' },
              recognition: { providerChain: ['cpu'], precision: 'fp32' }
            },
            cacheHit: false,
            benchmark: {
              state: 'miss-warm',
              runtimeStateBefore: 'ready',
              runtimeWasReady: true,
              inputBytes: ocrInput.length,
              durationMs: 4,
              appVersion: 'packaged-smoke',
              protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
              surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION
            },
            imageWidth: 1,
            imageHeight: 1,
            strategy: 'bounded-960',
            timingMs: { snapshot: 1, preprocessing: 1, recognition: 2, total: 4 }
          }
        }
      })
      const environment = cliEnvironment(userDataPath)
      const runPackagedCli = async (args: readonly string[], env = environment) =>
        await execFileAsync(process.execPath, [entryPath, ...args], {
          env,
          timeout: CLI_PROCESS_TIMEOUT_MS
        })

      await server.start()

      const version = await runPackagedCli(['system', 'version', '--json'])
      expect(LocalControlRpcResponseSchema.parse(JSON.parse(version.stdout))).toMatchObject({
        ok: true,
        result: { appVersion: 'packaged-smoke' }
      })

      const model = await runPackagedCli([
        'model',
        'invoke',
        '--provider',
        'fixture-provider',
        '--model',
        'fixture-model',
        '--prompt',
        'hello',
        '--jsonl'
      ])
      const modelRecords = model.stdout
        .trimEnd()
        .split('\n')
        .map((line) => LocalControlStreamRecordSchema.parse(JSON.parse(line)))
      expect(modelRecords).toHaveLength(3)
      expect(modelRecords[0]).toMatchObject({
        event: modelsInvokeRoute.name,
        data: { type: 'text_delta', text: 'fixture reply' }
      })
      expect(modelRecords.at(-1)).toMatchObject({
        ok: true,
        result: { text: 'fixture reply' }
      })

      const artifactResult = await runPackagedCli([
        'artifact',
        'get',
        '--id',
        artifact.id,
        '--out',
        artifactOutputPath,
        '--json'
      ])
      expect(LocalControlRpcResponseSchema.parse(JSON.parse(artifactResult.stdout))).toMatchObject({
        ok: true,
        result: { artifact: { id: artifact.id } }
      })
      expect(await readFile(artifactOutputPath)).toEqual(artifactBytes)

      const ocr = await runPackagedCli(['ocr', 'extract', '--file', ocrInputPath, '--json'])
      expect(LocalControlRpcResponseSchema.parse(JSON.parse(ocr.stdout))).toMatchObject({
        ok: true,
        result: {
          text: 'fixture OCR text',
          benchmark: { state: 'miss-warm', runtimeWasReady: true }
        }
      })

      const agentEnvironment = cliEnvironment(userDataPath, {
        [LOCAL_CONTROL_AGENT_TOKEN_ENV]: 'a'.repeat(43)
      })
      await expect(
        runPackagedCli(['ocr', 'extract', '--file', ocrInputPath, '--json'], agentEnvironment)
      ).rejects.toMatchObject({
        code: 4,
        stdout: expect.stringContaining('"code":"permission_denied"')
      })

      const activeCli = runPackagedCli([
        'model',
        'invoke',
        '--provider',
        'fixture-provider',
        '--model',
        'fixture-model',
        '--prompt',
        'wait-for-shutdown',
        '--jsonl'
      ])
      await shutdownDispatchStarted
      await server.stop()
      await expect(activeCli).rejects.toMatchObject({
        code: 3,
        stdout: expect.stringContaining('"code":"unavailable"')
      })
    } finally {
      await server?.stop()
      await spool.close()
      await rm(temporaryDirectory, { recursive: true })
    }
  }

  it(
    'covers diagnostics, compute, artifacts, OCR, Agent policy, and desktop shutdown',
    runPackagedCliSmoke,
    PACKAGED_SMOKE_TIMEOUT_MS
  )
})
