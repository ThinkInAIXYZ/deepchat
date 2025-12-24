import { spawn } from 'child_process'
import os from 'os'
import path from 'path'
import readline from 'readline'
import { RuntimeHelper } from '@/lib/runtimeHelper'

export interface RipgrepSearchOptions {
  maxResults?: number
  excludePatterns?: string[]
  timeoutMs?: number
}

const DEFAULT_EXCLUDES = [
  '.git',
  'node_modules',
  '.DS_Store',
  'dist',
  'build',
  'out',
  '.turbo',
  '.next',
  '.nuxt',
  '.cache',
  'coverage'
]

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_COLUMNS = 2_000
const DEFAULT_MAX_FILESIZE = '5M'

export class RipgrepSearcher {
  static async *files(
    pattern: string,
    workspacePath: string,
    options: RipgrepSearchOptions = {}
  ): AsyncGenerator<string> {
    const runtimeHelper = RuntimeHelper.getInstance()
    runtimeHelper.initializeRuntimes()
    const ripgrepPath = runtimeHelper.getRipgrepRuntimePath()

    const rgExecutable = ripgrepPath
      ? path.join(ripgrepPath, process.platform === 'win32' ? 'rg.exe' : 'rg')
      : 'rg'

    const excludePatterns = [...new Set([...(options.excludePatterns ?? []), ...DEFAULT_EXCLUDES])]
    const maxResults = options.maxResults
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const threads = Math.max(1, Math.min(os.cpus().length, 4))

    const args: string[] = [
      '--files',
      '--json',
      '--threads',
      String(threads),
      '--max-filesize',
      DEFAULT_MAX_FILESIZE,
      '--max-columns',
      String(DEFAULT_MAX_COLUMNS),
      '--binary-files=without-match',
      '--glob',
      pattern || '**'
    ]

    for (const exclude of excludePatterns) {
      args.push('--glob', `!${exclude}`)
    }

    args.push(workspacePath)

    const proc = spawn(rgExecutable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const rl = readline.createInterface({ input: proc.stdout })

    let count = 0
    let terminatedEarly = false
    let timeoutHandle: NodeJS.Timeout | null = null

    const exitPromise = new Promise<{ code: number | null }>((resolve, reject) => {
      proc.once('close', (code) => resolve({ code }))
      proc.once('error', (error) => reject(error))
    })

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        terminatedEarly = true
        proc.kill()
      }, timeoutMs)
    }

    try {
      for await (const line of rl) {
        if (!line.trim()) continue

        let parsed: { type?: string; data?: { path?: { text?: string } | string } }
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }

        const pathValue =
          typeof parsed.data?.path === 'string' ? parsed.data.path : parsed.data?.path?.text

        if ((parsed.type === 'begin' || parsed.type === 'match') && pathValue) {
          yield pathValue
          count += 1
          if (maxResults && count >= maxResults) {
            terminatedEarly = true
            proc.kill()
            break
          }
        }
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      rl.close()
      if (!proc.killed && proc.exitCode === null) {
        proc.kill()
      }
      try {
        const { code } = await exitPromise
        if (!terminatedEarly && code && code > 1) {
          throw new Error(`Ripgrep exited with code ${code}`)
        }
      } catch (error) {
        if (!terminatedEarly) {
          throw error
        }
      }
    }
  }
}
