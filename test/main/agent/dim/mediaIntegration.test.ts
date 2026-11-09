import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { ModelType } from '@shared/model'
import type { ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import { DimProductGateway } from '@/agent/dim/productGateway'
import { DimModality, type DimMediaTask } from '@/agent/dim/modality'
import { dimDatabase } from './fixtures/database'

interface TaskReply {
  task: DimMediaTask
}
it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'runs UUID provider image, speech and transcription tasks through native dim media owners',
  async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    const wave = Buffer.from('RIFF\u0004\u0000\u0000\u0000WAVE')
    const requests: Array<{ url: string; authorization?: string }> = []
    let held = false
    let cancelled = false
    let credential = 'native-media-first'
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      requests.push({ url: request.url!, authorization: request.headers.authorization })
      if (request.url === '/v1/images/generations') {
        expect(JSON.parse(body.toString()).prompt).toContain('native image')
        if (JSON.parse(body.toString()).prompt === 'native image hold') {
          held = true
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.flushHeaders()
          response.once('close', () => {
            cancelled = true
          })
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ created: 0, data: [{ b64_json: png.toString('base64') }] }))
      } else if (request.url === '/v1/audio/speech') {
        expect(JSON.parse(body.toString()).input).toBe('native speech')
        response.writeHead(200, { 'Content-Type': 'audio/wav' })
        response.end(wave)
      } else if (request.url === '/v1/audio/transcriptions') {
        expect(body.toString()).toContain('whisper-1')
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ text: 'native transcription' }))
      } else {
        response.writeHead(404)
        response.end()
      }
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-media-'))
    const database = dimDatabase()
    let catalog!: DimModelCatalog
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'empty',
        tools: [],
        execute: async () => {
          throw new Error('No desktop tool execution is allowed')
        }
      }),
      credential: (id, reference, signal) => catalog.credential(id, reference, signal)
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true,
      gatewayAddress: await gateway.start()
    })
    const provider = {
      id: 'desktop-media',
      name: 'Media fixture',
      apiType: 'openai',
      enable: true,
      baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
      apiKey: 'protected-by-product'
    }
    catalog = new DimModelCatalog({
      settings: {
        getProviderById: () => provider,
        getModelStatus: () => true,
        getModelConfig: (id) =>
          ({
            type:
              id === 'gpt-image-1'
                ? ModelType.ImageGeneration
                : id === 'tts-1'
                  ? ModelType.TTS
                  : ModelType.Chat,
            speechRecognition: id === 'whisper-1',
            contextLength: 8192,
            maxTokens: 1024,
            functionCall: false,
            vision: false,
            reasoning: false
          }) as ModelConfig,
        getProviderModelRouteMetadata: () => undefined,
        getCapabilitySnapshot: () =>
          ({
            supportsReasoning: false,
            supportsAudioInput: false,
            reasoningPortrait: null
          }) as ReturnType<ProviderSettingsPort['getCapabilitySnapshot']>
      },
      models: new DimModelBridge(host),
      grants: database.data.dimProviderGrantsTable,
      credential: async () => credential
    })
    const media = new DimModality(host)
    const wait = async (id: string) => {
      const done = await media.wait(id)
      expect(done.state, JSON.stringify(done.error)).toBe('succeeded')
      expect(JSON.stringify(done)).not.toContain(credential)
      return done
    }
    try {
      let client = await host.start()
      const imageModel = await catalog.admit(provider.id, 'gpt-image-1')
      const speechModel = await catalog.admit(provider.id, 'tts-1')
      const transcriptionModel = await catalog.admit(provider.id, 'whisper-1')
      expect(imageModel.providerId).not.toBe('openai')
      await expect(
        client.call('deepchat.host.launch', { cwd: profile, model: { ...imageModel } })
      ).rejects.toThrow()
      expect(requests).toHaveLength(0)
      const submission = {
        category: 'image',
        operation: 'generate',
        model: { ...imageModel },
        params: { prompt: 'native image first', outputFormat: 'png' },
        client_task_id: randomUUID()
      }
      const image = await client.call<TaskReply>('modality.task.submit', submission)
      const imageResult = await wait(image.task.task_id)
      expect((await client.call<TaskReply>('modality.task.submit', submission)).task.task_id).toBe(
        image.task.task_id
      )
      expect(requests.filter((request) => request.url === '/v1/images/generations')).toHaveLength(1)
      const file = imageResult.result!.files[0]
      expect(await media.readResult(imageResult, file.name, 1024 * 1024)).toEqual(png)
      const speech = await client.call<TaskReply>('modality.task.submit', {
        category: 'speech',
        operation: 'synthesize',
        model: { ...speechModel },
        params: { text: 'native speech', voice: 'alloy', outputFormat: 'wav' }
      })
      await wait(speech.task.task_id)
      const transcription = await client.call<TaskReply>('modality.task.submit', {
        category: 'speech',
        operation: 'transcribe',
        model: { ...transcriptionModel },
        files: [
          { name: 'sample.wav', media_type: 'audio/wav', data_base64: wave.toString('base64') }
        ]
      })
      const transcribed = await wait(transcription.task.task_id)
      expect(transcribed.result?.data).toMatchObject({ text: 'native transcription' })
      expect(
        requests.every((request) => request.authorization === 'Bearer native-media-first')
      ).toBe(true)
      const heldTask = await media.submit({
        ...submission,
        client_task_id: randomUUID(),
        params: { prompt: 'native image hold' }
      })
      const abort = new AbortController()
      const waiting = media.wait(heldTask.task_id, abort.signal).catch((error: unknown) => error)
      await expect.poll(() => held).toBe(true)
      abort.abort(new Error('stop native media'))
      expect(await waiting).toMatchObject({ message: 'stop native media' })
      await expect.poll(() => cancelled).toBe(true)
      expect(
        (await client.call<TaskReply>('modality.task.status', { task_id: heldTask.task_id })).task
          .state
      ).toBe('cancelled')
      await host.stop()
      credential = 'native-media-rotated'
      client = await host.start()
      expect(
        (await client.call<TaskReply>('modality.task.status', { task_id: image.task.task_id })).task
          .state
      ).toBe('succeeded')
      // No configure/alias refresh call after restart: reconstruct through the native public owner.
      const restored = await client.call<TaskReply>('modality.task.submit', {
        ...submission,
        client_task_id: randomUUID(),
        params: { prompt: 'native image restored' }
      })
      await wait(restored.task.task_id)
      expect(requests.at(-1)?.authorization).toBe('Bearer native-media-rotated')
    } finally {
      await host.stop()
      await gateway.stop()
      database.sqlite.close()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  90_000
)
