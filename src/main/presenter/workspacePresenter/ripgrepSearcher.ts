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
      '--binary' // Skip binary files (equivalent to --binary-files=without-match)
    ]

    // Handle glob pattern
    // For "**/*" or "**", we want to match all files, so we don't need --glob
    // For other patterns, use --glob
    // Note: ripgrep uses gitignore-style globs
    // Patterns like "*query*" work better than "**/*query*" for filename matching
    if (pattern && pattern !== '**/*' && pattern !== '**' && pattern !== '*') {
      // If pattern starts with "**/*", simplify it to just "*" + rest
      // e.g., "**/*src*" -> "*src*" (matches files with "src" in name anywhere)
      let simplifiedPattern = pattern
      if (pattern.startsWith('**/*')) {
        simplifiedPattern = '*' + pattern.slice(4) // Remove "**/" prefix
      } else if (pattern.startsWith('**/')) {
        simplifiedPattern = pattern.slice(3) // Remove "**/" prefix
      }
      args.push('--glob', simplifiedPattern)
    }

    for (const exclude of excludePatterns) {
      args.push('--glob', `!${exclude}`)
    }

    // For --files mode, we need a search pattern (even if it's just '.')
    // The pattern is used to match file contents, but with --files we only care about file paths
    args.push('.') // Search pattern: match any character (will match all files)
    args.push(workspacePath)

    const proc = spawn(rgExecutable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const rl = readline.createInterface({ input: proc.stdout })

    let count = 0
    let terminatedEarly = false
    let timeoutHandle: NodeJS.Timeout | null = null
    let stderrOutput = '' // Move stderrOutput to outer scope

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

    // Capture stderr for debugging
    proc.stderr?.on('data', (chunk) => {
      stderrOutput += chunk.toString()
    })

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

        // ripgrep with --files returns 'begin' type for each file
        if (parsed.type === 'begin' && pathValue) {
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
        // Exit code 0: matches found
        // Exit code 1: no matches found (not an error)
        // Exit code 2: error (e.g., "no files were searched" due to glob filter)
        // For code 2, we've already logged stderr, and count is 0, so just return empty
        // Only throw for unexpected errors (code > 2)
        if (!terminatedEarly && code && code > 2) {
          throw new Error(`Ripgrep exited with code ${code}: ${stderrOutput.substring(0, 200)}`)
        }
      } catch (error) {
        if (!terminatedEarly) {
          throw error
        }
      }
    }
  }
}
