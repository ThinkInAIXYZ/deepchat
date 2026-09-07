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

async function sendFragmented(message) {
  const serialized = `${JSON.stringify(message)}\n`
  for (let offset = 0; offset < serialized.length; offset += 7) {
    process.stdout.write(serialized.slice(offset, offset + 7))
    await new Promise((resolve) => setImmediate(resolve))
  }
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

function documentPage(index, text) {
  return {
    index,
    width: 100,
    height: 200,
    lines: text ? [text] : [],
    modelBundleId: expectedBundleId,
    timingUs: {
      total: 3,
      decode: 1,
      ocr: 2
    }
  }
}

let configured = null

if (process.env.FAKE_OCR_START_COUNTER) {
  await appendFile(process.env.FAKE_OCR_START_COUNTER, `${process.pid}\n`)
}

send({
  type: 'hello',
  protocolVersion: Number(process.env.FAKE_OCR_PROTOCOL_VERSION ?? 2),
  nodeVersion: process.env.FAKE_OCR_NODE_VERSION ?? 'v24.18.0',
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
      active.set(request.id, { kind: 'image', cancelled: false, stopped: false })
      return
    }

    const text = await readFile(request.filePath, 'utf8')
    send({ type: 'result', id: request.id, data: recognitionResult(text, configured) })
    return
  }

  if (request.type === 'recognize_document') {
    if (behavior === 'document-crash-before-page') process.exit(18)
    if (behavior === 'invalid-protocol') {
      process.stdout.write('not-json\n')
      return
    }
    if (behavior === 'hang') return

    const text = await readFile(request.filePath, 'utf8')
    const pages = text.split('\f')
    const state = { kind: 'document', cancelled: false, stopped: false }
    active.set(request.id, state)
    let emittedPages = 0

    if (behavior === 'document-resource-before-page') {
      active.delete(request.id)
      send({
        type: 'error',
        id: request.id,
        error: {
          code: 'resource_limit_exceeded',
          message: 'fake document resource limit'
        }
      })
      return
    }

    for (let index = 0; index < pages.length; index += 1) {
      if (state.cancelled || state.stopped) break
      const pageIndex = behavior === 'document-invalid-sequence' && index === 1 ? index + 1 : index
      const page = documentPage(pageIndex, pages[index])
      if (behavior === 'document-invalid-model') page.modelBundleId = 'unexpected-bundle'
      const pageMessage = { type: 'document_page', id: request.id, page }
      if (behavior === 'document-fragmented-page') await sendFragmented(pageMessage)
      else send(pageMessage)
      emittedPages += 1

      if (behavior === 'document-crash-after-page') process.exit(19)
      if (behavior === 'document-resource-after-page') {
        active.delete(request.id)
        send({
          type: 'error',
          id: request.id,
          error: {
            code: 'resource_limit_exceeded',
            message: 'fake document resource limit'
          }
        })
        return
      }
      if (behavior === 'document-error-after-page') {
        active.delete(request.id)
        send({
          type: 'error',
          id: request.id,
          error: {
            code: 'runtime_failure',
            message: 'fake document failure'
          }
        })
        return
      }
      if (behavior === 'document-hang-after-page') return
      if (behavior !== 'document-stop-race') {
        const delay = Number(process.env.FAKE_OCR_DOCUMENT_PAGE_DELAY_MS ?? 10)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    active.delete(request.id)
    send({
      type: 'request_complete',
      id: request.id,
      emittedPages: behavior === 'document-invalid-completion' ? emittedPages + 1 : emittedPages
    })
    if (behavior === 'document-page-after-completion') {
      send({
        type: 'document_page',
        id: request.id,
        page: documentPage(emittedPages, 'late page')
      })
    }
    return
  }

  if (request.type === 'document_stop') {
    const target = active.get(request.targetId)
    const stopped = target?.kind === 'document'
    if (stopped) target.stopped = true
    const response = {
      type: 'result',
      id: request.id,
      data: behavior === 'document-invalid-stop-result' ? { stopped: 'invalid' } : { stopped }
    }
    const responseDelay = Number(
      process.env.FAKE_OCR_DOCUMENT_STOP_DELAY_MS ??
        (behavior === 'document-page-after-completion' ? 30 : 0)
    )
    if (responseDelay > 0) setTimeout(() => send(response), responseDelay)
    else send(response)
    return
  }

  if (request.type === 'cancel') {
    const target = active.get(request.targetId)
    const cancelled = Boolean(target)
    if (target) target.cancelled = true
    active.delete(request.targetId)
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
