import { pathToFileURL } from 'node:url'
import type {
  ExternalToolConfig,
  NewDiscovery,
  ScanCache,
  ScanResult
} from '@shared/types/skillSync'
import { runInlineJsonWorker } from '@/lib/runInlineJsonWorker'
import workerPath from './scanWorkerEntry?modulePath'

export type SkillSyncWorkerInput = {
  tools: ExternalToolConfig[]
  projectRoot?: string
  cache?: ScanCache | null
  existingSkillNames?: string[]
}

type SkillSyncWorkerOutput = {
  scanResults: ScanResult[]
  discoveries: NewDiscovery[]
}

// Only module loading belongs in the inline bootstrap. The bundled entry shares
// all scanning rules with the fallback and uses structured clone (including Date).
const SCAN_WORKER_SOURCE = `
void import(${JSON.stringify(pathToFileURL(workerPath).href)}).catch((error) => {
  const requireFromBundle = globalThis.__inlineWorkerRequire || require
  requireFromBundle('node:worker_threads').parentPort.postMessage({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }
  })
})
`

export async function scanExternalToolsInWorker(
  input: Pick<SkillSyncWorkerInput, 'tools' | 'projectRoot'>,
  signal?: AbortSignal
): Promise<ScanResult[]> {
  const output = await runInlineJsonWorker<SkillSyncWorkerInput, SkillSyncWorkerOutput>({
    name: 'skill-sync-scan',
    source: SCAN_WORKER_SOURCE,
    input,
    signal
  })
  return output.scanResults
}

export async function scanAndDetectDiscoveriesInWorker(
  input: SkillSyncWorkerInput,
  signal?: AbortSignal
): Promise<SkillSyncWorkerOutput> {
  return runInlineJsonWorker<SkillSyncWorkerInput, SkillSyncWorkerOutput>({
    name: 'skill-sync-discovery',
    source: SCAN_WORKER_SOURCE,
    input,
    signal
  })
}
