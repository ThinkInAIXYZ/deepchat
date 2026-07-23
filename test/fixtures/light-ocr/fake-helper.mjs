import { existsSync } from 'node:fs'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1])
}

const tempRoot = args.get('--temp-root')
const expectedBundleId = args.get('--expected-bundle-id')
const behavior = process.env.FAKE_OCR_BEHAVIOR ?? 'success'
const active = new Map()

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function engineStatus(strategy, backend) {
  return {
    coreVersion: 'fake-core',
    modelBundleId: expectedBundleId,
    requestedProvider: backend,
    strategy,
    detection: {
      actualProviderChain: [backend === 'cpu' ? 'cpu' : 'fake-auto'],
      precision: backend === 'cpu' ? 'fp32' : 'fp16',
      qualificationId: 'fake-detection'
    },
    recognition: {
      actualProviderChain: [backend === 'cpu' ? 'cpu' : 'fake-auto'],
      precision: backend === 'cpu' ? 'fp32' : 'fp16',
      qualificationId: 'fake-recognition'
    }
  }
}

function recognitionResult(text, engine) {
  return {
    lines: [
      {
        text,
        confidence: 0.99,
        box: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 }
        ]
      }
    ],
    imageWidth: 1,
    imageHeight: 1,
    modelBundleId: expectedBundleId,
    timingUs: {
      total: 1,
      decode: 0,
      inputValidation: 0,
      detectionPreprocess: 0,
      detectionInference: 0,
      detectionPostprocess: 0,
      detectionMerge: 0,
      cropAndSort: 0,
      recognitionPreprocess: 0,
      recognitionInference: 0,
      recognitionPostprocess: 0
    },
    engine
  }
}

let configured = null

if (process.env.FAKE_OCR_START_COUNTER) {
  await appendFile(process.env.FAKE_OCR_START_COUNTER, `${process.pid}\n`)
}

send({
  type: 'hello',
  protocolVersion: Number(process.env.FAKE_OCR_PROTOCOL_VERSION ?? 1),
  nodeVersion: process.env.FAKE_OCR_NODE_VERSION ?? 'v24.14.1',
  pid: process.pid
})

const lines = readline.createInterface({ input: process.stdin })
lines.on('line', async (line) => {
  const request = JSON.parse(line)

  if (request.type === 'configure') {
    configured = engineStatus(request.strategy, request.backend)
    send({ type: 'result', id: request.id, data: configured })
    return
  }

  if (request.type === 'recognize') {
    if (behavior === 'crash-once') {
      const marker = process.env.FAKE_OCR_CRASH_MARKER ?? path.join(tempRoot, '.fake-crashed-once')
      if (!existsSync(marker)) {
        await writeFile(marker, '1')
        process.exit(17)
      }
    }
    if (behavior === 'invalid-protocol') {
      process.stdout.write('not-json\n')
      return
    }
    if (behavior === 'hang') return
    if (behavior === 'cancellable') {
      active.set(request.id, true)
      return
    }

    const text = await readFile(request.filePath, 'utf8')
    send({ type: 'result', id: request.id, data: recognitionResult(text, configured) })
    return
  }

  if (request.type === 'cancel') {
    const cancelled = active.delete(request.targetId)
    send({ type: 'result', id: request.id, data: { cancelled } })
    if (cancelled) {
      send({
        type: 'error',
        id: request.targetId,
        error: { code: 'cancelled', message: 'cancelled' }
      })
    }
    return
  }

  if (request.type === 'shutdown') {
    const finish = () => {
      send({ type: 'result', id: request.id, data: { closed: true } })
      setImmediate(() => process.exit(0))
    }
    const delay = Number(process.env.FAKE_OCR_SHUTDOWN_DELAY_MS ?? 0)
    if (delay > 0) setTimeout(finish, delay)
    else finish()
  }
})
