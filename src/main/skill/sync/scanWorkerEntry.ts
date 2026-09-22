import { parentPort, workerData } from 'node:worker_threads'
import { ToolScanner } from './toolScanner'
import { compareWithCacheAndSkills } from './discoveries'
import type { SkillSyncWorkerInput } from './scanWorker'

async function main(): Promise<void> {
  const input: SkillSyncWorkerInput = workerData
  const scanResults = await new ToolScanner(input.tools).scanExternalTools(input.projectRoot)
  const discoveries = compareWithCacheAndSkills(
    scanResults,
    input.cache ?? null,
    new Set(input.existingSkillNames)
  )
  parentPort!.postMessage({ ok: true, data: { scanResults, discoveries } })
}

void main().catch((error: unknown) => {
  parentPort!.postMessage({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }
  })
})
