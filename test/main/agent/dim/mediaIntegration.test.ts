import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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
import { DimConnectionError } from '@/agent/dim/pluginClient'
import { DimEmbeddingModels } from '@/agent/dim/embeddingModels'
import { DimMediaModels } from '@/agent/dim/mediaModels'
import { dimDatabase } from './fixtures/database'

interface TaskReply {
  task: DimMediaTask
}
it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'runs UUID provider image, speech, video, transcription and embedding requests through native dim owners',
  async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    const video = Buffer.from('native-video-bytes')
    let videoPollHeld = false
    let resumeVideo = false
    const wave = Buffer.from('RIFF\u0004\u0000\u0000\u0000WAVE')
    const largeWave = Buffer.alloc(18 * 1024 * 1024 + 17, 0x61)
    wave.copy(largeWave)
    let largeTranscriptions = 0
    let heldTranscriptions = 0
    let cancelledTranscriptions = 0
    const requests: Array<{
      url: string
      authorization?: string
      productHeader?: string
      body?: Record<string, unknown>
    }> = []
    let embeddingHeld = false
    let embeddingCancelled = false
    let held = false
    let cancelled = false
    let credential = 'native-media-first'
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      requests.push({
        url: request.url!,
        authorization: request.headers.authorization,
        productHeader: request.headers['x-product-secret'] as string | undefined,
        ...(request.headers['content-type']?.includes('application/json')
          ? { body: JSON.parse(body.toString()) }
          : {})
      })
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
      } else if (request.url === '/v1/videos') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            id: JSON.parse(body.toString()).prompt.includes('resume')
              ? 'native-resume-video'
              : JSON.parse(body.toString()).prompt.includes('cancel')
                ? 'native-cancel-video'
                : 'native-video',
            status: 'queued'
          })
        )
      } else if (
        request.url === '/v1/videos/native-video' ||
        request.url === '/v1/videos/native-resume-video' ||
        request.url === '/v1/videos/native-cancel-video'
      ) {
        videoPollHeld = true
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            status:
              request.url.includes('cancel') || (request.url.includes('resume') && !resumeVideo)
                ? 'in_progress'
                : 'completed'
          })
        )
      } else if (request.url?.endsWith('/content')) {
        response.writeHead(200, { 'Content-Type': 'video/mp4' })
        response.end(video)
      } else if (request.url === '/v1/embeddings') {
        const values = JSON.parse(body.toString()).input as string[]
        if (values[0] === 'native embedding hold') {
          embeddingHeld = true
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.flushHeaders()
          response.once('close', () => {
            embeddingCancelled = true
          })
          return
        }
        if (values.length > 2 || values[0] === 'input-too-long') {
          response.writeHead(400, { 'Content-Type': 'application/json' })
          response.end(
            JSON.stringify({
              error: {
                message:
                  values[0] === 'input-too-long'
                    ? 'Input text is too long'
                    : 'Too many inputs. Maximum batch size is 2.'
              }
            })
          )
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            object: 'list',
            data: values.map((value, index) => ({
              object: 'embedding',
              index,
              embedding: [1, value.startsWith('vector-') ? Number(value.slice(7)) : 0]
            })),
            usage: { prompt_tokens: values.length, total_tokens: values.length }
          })
        )
      } else if (request.url === '/v1/audio/speech') {
        expect(JSON.parse(body.toString()).input).toBe('native speech')
        response.writeHead(200, { 'Content-Type': 'audio/wav' })
        response.end(wave)
      } else if (request.url === '/v1/audio/transcriptions') {
        expect(body.toString()).toContain('whisper-1')
        if (body.length > 8 * 1024 * 1024) {
          expect(body.includes(largeWave)).toBe(true)
          if (!body.includes(Buffer.from('hold-native-audio'))) largeTranscriptions++
        }
        if (body.includes(Buffer.from('hold-native-audio'))) {
          expect(body.includes(largeWave)).toBe(true)
          heldTranscriptions++
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.flushHeaders()
          response.once('close', () => {
            cancelledTranscriptions++
          })
          return
        }
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
      apiKey: 'protected-by-product',
      customHeaders: { 'x-product-secret': 'native-media-header-secret' }
    }
    const getModelConfig = (id: string) =>
      ({
        type:
          id === 'gpt-image-1'
            ? ModelType.ImageGeneration
            : id === 'sora-2' || id.startsWith('doubao-seedance-')
              ? ModelType.VideoGeneration
              : id === 'tts-1'
                ? ModelType.TTS
                : id === 'text-embedding-3-small'
                  ? ModelType.Embedding
                  : ModelType.Chat,
        speechRecognition: id === 'whisper-1',
        contextLength: 8192,
        maxTokens: 1024,
        functionCall: false,
        vision: false,
        reasoning: false
      }) as ModelConfig
    catalog = new DimModelCatalog({
      settings: {
        getProviderById: () => provider,
        getModelStatus: () => true,
        getModelConfig,
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
    const embedding = new DimEmbeddingModels({ models: catalog, bridge: new DimModelBridge(host) })
    const media = new DimModality(host)
    const desktopMedia = new DimMediaModels({
      settings: { getModelConfig },
      models: catalog,
      media
    })
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
      const inputRoot = path.join(profile, 'dim/deepchat-media-inputs')
      const retainedInputs = async () =>
        (await readdir(inputRoot)).filter((name) => /^[0-9a-f-]{36}$/.test(name))
      expect(
        await desktopMedia.transcribeAudioStandalone(
          provider.id,
          'whisper-1',
          largeWave.toString('base64'),
          'audio/wav',
          'large.wav'
        )
      ).toBe('native transcription')
      expect(largeTranscriptions).toBe(1)
      await expect.poll(retainedInputs, { timeout: 10_000 }).toEqual([])
      expect(await readdir(host.payloadRoot)).toEqual([])
      const heldAudio = {
        category: 'speech',
        operation: 'transcribe',
        params: { prompt: 'hold-native-audio' },
        model: transcriptionModel,
        client_task_id: randomUUID(),
        files: [
          { name: 'hold.wav', media_type: 'audio/wav', data_base64: largeWave.toString('base64') }
        ]
      }
      const heldAudioTask = await media.submit(heldAudio)
      await expect.poll(() => heldTranscriptions, { timeout: 10_000 }).toBe(1)
      expect((await media.submit(heldAudio)).task_id).toBe(heldAudioTask.task_id)
      expect(heldTranscriptions).toBe(1)
      expect(await retainedInputs()).toHaveLength(1)
      await media.cancel(heldAudioTask.task_id)
      await expect.poll(() => cancelledTranscriptions, { timeout: 10_000 }).toBe(1)
      await expect.poll(retainedInputs, { timeout: 10_000 }).toEqual([])
      expect(
        requests.every((request) => request.authorization === 'Bearer native-media-first')
      ).toBe(true)
      const generated = await desktopMedia.generateImageStandalone(
        provider.id,
        'native image desktop facade',
        'gpt-image-1',
        {
          quality: 'high',
          background: 'opaque',
          moderation: 'low',
          outputFormat: 'png',
          size: '1024x1024'
        }
      )
      expect(generated).toMatchObject({
        providerId: provider.id,
        modelId: 'gpt-image-1',
        images: [{ data: png.toString('base64'), mimeType: 'image/png' }]
      })
      expect(
        requests.findLast((request) => request.url === '/v1/images/generations')?.body
      ).toMatchObject({
        prompt: 'native image desktop facade',
        quality: 'high',
        background: 'opaque',
        moderation: 'low',
        output_format: 'png'
      })
      const spoken = await desktopMedia.generateSpeechStandalone(
        provider.id,
        'native speech',
        'tts-1',
        {
          voice: 'alloy',
          responseFormat: 'wav',
          speed: 1.25
        }
      )
      expect(spoken.audio).toEqual({ data: wave.toString('base64'), mimeType: 'audio/wav' })
      expect(
        requests.findLast((request) => request.url === '/v1/audio/speech')?.body
      ).toMatchObject({
        input: 'native speech',
        voice: 'alloy',
        response_format: 'wav',
        speed: 1.25
      })
      expect(
        await desktopMedia.transcribeAudioStandalone(
          provider.id,
          'whisper-1',
          wave.toString('base64'),
          'Audio/WAV',
          'C:\\recordings\\sample.wav'
        )
      ).toBe('native transcription')
      const generatedVideo = await desktopMedia.generateVideoStandalone(
        provider.id,
        'native video facade',
        'sora-2',
        {
          seconds: '8',
          size: '1280x720',
          ratio: '16:9',
          resolution: '720p',
          watermark: false,
          generateAudio: true,
          inputReference: { data: 'AQID', mimeType: 'image/png' },
          references: [{ type: 'image', url: 'https://example.com/reference.png' }]
        }
      )
      expect(generatedVideo.videos).toEqual([
        { data: video.toString('base64'), mimeType: 'video/mp4' }
      ])
      expect(requests.findLast((request) => request.url === '/v1/videos')?.body).toMatchObject({
        model: 'sora-2',
        prompt: 'native video facade',
        seconds: '8',
        size: '1280x720',
        input_reference: { data: 'AQID', mime_type: 'image/png' },
        extra_body: {
          ratio: '16:9',
          resolution: '720p',
          watermark: false,
          generate_audio: true,
          content: [
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/reference.png' },
              role: 'reference_image'
            }
          ]
        }
      })
      await desktopMedia.generateVideoStandalone(
        provider.id,
        'native video flat',
        'doubao-seedance-2',
        { seconds: '5', ratio: '16:9', generateAudio: false }
      )
      const flatVideo = requests.findLast((request) => request.url === '/v1/videos')?.body
      expect(flatVideo).toMatchObject({
        model: 'doubao-seedance-2',
        duration: 5,
        ratio: '16:9',
        generate_audio: false
      })
      expect(flatVideo).not.toHaveProperty('extra_body')
      const cancelledVideo = await media.submit({
        category: 'video',
        operation: 'generate',
        model: await catalog.admit(provider.id, 'sora-2'),
        params: { prompt: 'native video cancel' }
      })
      await expect
        .poll(
          async () =>
            (
              await client.call<TaskReply>('modality.task.status', {
                task_id: cancelledVideo.task_id
              })
            ).task.remote_handle,
          { timeout: 10_000 }
        )
        .toBeTruthy()
      expect(await client.call('deepchat.storage.readiness')).toMatchObject({
        idle: false,
        media: true
      })
      let accessedProfile = false
      await expect(
        host.withStopped(
          async () => {
            accessedProfile = true
          },
          { ifIdle: true }
        )
      ).rejects.toMatchObject({ data: { appError: 'daemon_busy' } })
      expect(accessedProfile).toBe(false)
      expect((await media.cancel(cancelledVideo.task_id)).state).toBe('cancelled')
      videoPollHeld = false
      const videoModel = await catalog.admit(provider.id, 'sora-2')
      const resumable = await media.submit({
        category: 'video',
        operation: 'generate',
        model: videoModel,
        params: { prompt: 'native video resume' }
      })
      await expect.poll(() => videoPollHeld, { timeout: 10_000 }).toBe(true)
      await expect
        .poll(
          async () =>
            (await client.call<TaskReply>('modality.task.status', { task_id: resumable.task_id }))
              .task.remote_handle,
          { timeout: 10_000 }
        )
        .toBeTruthy()
      await host.stop()
      resumeVideo = true
      client = await host.start()
      const resumed = await wait(resumable.task_id)
      expect(await media.readResult(resumed, resumed.result!.files[0].name, 1024)).toEqual(video)
      expect(
        requests.filter(
          (request) =>
            request.url === '/v1/videos' && request.body?.prompt === 'native video resume'
        )
      ).toHaveLength(1)
      const values = Array.from({ length: 35 }, (_, index) => `vector-${index}`)
      expect(await embedding.getEmbeddings(provider.id, 'text-embedding-3-small', values)).toEqual(
        values.map((_, index) => [1, index])
      )
      expect(await embedding.getDimensions(provider.id, 'text-embedding-3-small')).toEqual({
        data: { dimensions: 2, normalized: true }
      })
      const beforeLongInput = requests.filter((request) => request.url === '/v1/embeddings').length
      await expect(
        embedding.getEmbeddings(provider.id, 'text-embedding-3-small', ['input-too-long'])
      ).rejects.toThrow('Native embedding request failed')
      expect(requests.filter((request) => request.url === '/v1/embeddings').length).toBe(
        beforeLongInput + 1
      )
      const embeddingAbort = new AbortController()
      const embeddingWait = embedding
        .getEmbeddings(
          provider.id,
          'text-embedding-3-small',
          ['native embedding hold'],
          embeddingAbort.signal
        )
        .catch((error: unknown) => error)
      await expect.poll(() => embeddingHeld, { timeout: 10_000 }).toBe(true)
      embeddingAbort.abort(new Error('cancel native embedding'))
      expect(await embeddingWait).toMatchObject({ message: 'cancel native embedding' })
      await expect.poll(() => embeddingCancelled, { timeout: 10_000 }).toBe(true)
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
      // Lose only the product receipt after native admission. Never replay the task.
      const uncertain = new DimModality({
        payloadRoot: host.payloadRoot,
        openConnection: async () => {
          const connection = await host.openConnection()
          return {
            call: async (method: string, params: never, timeout: number) => {
              await connection.call(method, params, timeout)
              throw new DimConnectionError('lost media receipt', 'unknown')
            },
            close: () => connection.close()
          }
        }
      } as unknown as DimRuntimeSupervisor)
      const clientTaskId = randomUUID()
      await expect(
        uncertain.submit({ ...heldAudio, client_task_id: clientTaskId })
      ).rejects.toMatchObject({ clientTaskId })
      await expect.poll(() => heldTranscriptions, { timeout: 10_000 }).toBe(2)
      expect(await retainedInputs()).toHaveLength(1)
      expect(await readdir(host.payloadRoot)).toEqual([])
      const orphan = path.join(inputRoot, randomUUID())
      await mkdir(orphan)
      await writeFile(path.join(orphan, 'input-0'), 'uncommitted input')
      await host.stop()
      credential = 'native-media-rotated'
      client = await host.start()
      await expect.poll(retainedInputs, { timeout: 10_000 }).toEqual([])
      expect(heldTranscriptions).toBe(2)
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
      expect(
        requests.every((request) => request.productHeader === 'native-media-header-secret')
      ).toBe(true)
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
