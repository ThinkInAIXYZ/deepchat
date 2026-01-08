import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import readline from 'readline'
import type { ContextToolDefinition } from './types'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import { validateRegexPattern } from '@shared/regexValidator'

const GrepArgsSchema = z.object({
  id: z.string().min(1),
  pattern: z.string().max(1000),
  maxResults: z.number().int().min(1).max(200).default(50),
  contextLines: z.number().int().min(0).max(200).default(0),
  caseSensitive: z.boolean().default(false)
})

type GrepMatch = {
  line: number
  content: string
  before?: string[]
  after?: string[]
}

type GrepResult = {
  totalMatches: number
  matches: GrepMatch[]
}

async function grepFile(
  filePath: string,
  pattern: string,
  options: {
    maxResults: number
    contextLines: number
    caseSensitive: boolean
  }
): Promise<GrepResult> {
  const runtimeHelper = RuntimeHelper.getInstance()
  runtimeHelper.initializeRuntimes()
  const ripgrepPath = runtimeHelper.getRipgrepRuntimePath()

  if (ripgrepPath) {
    try {
      return await runRipgrep(filePath, pattern, options)
    } catch {
      return await runJavaScriptGrep(filePath, pattern, options)
    }
  }

  return await runJavaScriptGrep(filePath, pattern, options)
}

async function runRipgrep(
  filePath: string,
  pattern: string,
  options: {
    maxResults: number
    contextLines: number
    caseSensitive: boolean
  }
): Promise<GrepResult> {
  const runtimeHelper = RuntimeHelper.getInstance()
  const ripgrepPath = runtimeHelper.getRipgrepRuntimePath()
  if (!ripgrepPath) {
    throw new Error('Ripgrep runtime not available')
  }

  const rgExecutable =
    process.platform === 'win32' ? path.join(ripgrepPath, 'rg.exe') : path.join(ripgrepPath, 'rg')

  const args: string[] = ['--json', '-n', '-m', String(options.maxResults)]
  if (!options.caseSensitive) {
    args.push('-i')
  }
  if (options.contextLines > 0) {
    args.push('-C', String(options.contextLines))
  }
  args.push('-e', pattern, filePath)

  const result: GrepResult = { totalMatches: 0, matches: [] }
  const contextMap = new Map<number, string>()

  await new Promise<void>((resolve, reject) => {
    const ripgrep = spawn(rgExecutable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const rl = readline.createInterface({ input: ripgrep.stdout })
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      ripgrep.kill('SIGKILL')
      reject(new Error('Ripgrep search timed out after 30000ms'))
    }, 30_000)

    ripgrep.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const parsed = JSON.parse(line) as {
          type: string
          data?: {
            line_number?: number
            lines?: { text?: string }
          }
        }
        const lineNumber = parsed.data?.line_number
        const text = parsed.data?.lines?.text?.replace(/\n$/, '') ?? ''
        if (parsed.type === 'context' && lineNumber) {
          contextMap.set(lineNumber, text)
        }
        if (parsed.type === 'match' && lineNumber) {
          result.matches.push({ line: lineNumber, content: text })
          result.totalMatches += 1
        }
      } catch {
        return
      }
    })

    ripgrep.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rl.close()
      if (code === 0 || code === 1) {
        resolve()
      } else {
        reject(new Error(`Ripgrep failed with code ${code}: ${stderr}`))
      }
    })

    ripgrep.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rl.close()
      reject(error)
    })
  })

  if (options.contextLines > 0 && result.matches.length > 0) {
    result.matches = result.matches.map((match) => {
      const before: string[] = []
      const after: string[] = []
      for (let i = match.line - options.contextLines; i < match.line; i += 1) {
        const text = contextMap.get(i)
        if (text !== undefined) before.push(text)
      }
      for (let i = match.line + 1; i <= match.line + options.contextLines; i += 1) {
        const text = contextMap.get(i)
        if (text !== undefined) after.push(text)
      }
      return {
        ...match,
        before: before.length > 0 ? before : undefined,
        after: after.length > 0 ? after : undefined
      }
    })
  }

  return result
}

async function runJavaScriptGrep(
  filePath: string,
  pattern: string,
  options: {
    maxResults: number
    contextLines: number
    caseSensitive: boolean
  }
): Promise<GrepResult> {
  const content = await fs.readFile(filePath, 'utf-8')
  const lines = content.split('\n')
  const flags = options.caseSensitive ? '' : 'i'
  const regex = new RegExp(pattern, flags)
  const result: GrepResult = { totalMatches: 0, matches: [] }

  for (let i = 0; i < lines.length; i += 1) {
    if (result.totalMatches >= options.maxResults) break
    if (!regex.test(lines[i])) continue
    const match: GrepMatch = {
      line: i + 1,
      content: lines[i]
    }

    if (options.contextLines > 0) {
      const start = Math.max(0, i - options.contextLines)
      const end = Math.min(lines.length, i + options.contextLines + 1)
      if (start < i) {
        match.before = lines.slice(start, i)
      }
      if (end > i + 1) {
        match.after = lines.slice(i + 1, end)
      }
    }

    result.matches.push(match)
    result.totalMatches += 1
  }

  return result
}

export function createGrepTools(): ContextToolDefinition[] {
  return [
    {
      name: 'context_grep',
      description: 'Search a context file with a regex pattern',
      schema: GrepArgsSchema,
      handler: async (args, context) => {
        const { id, pattern, maxResults, contextLines, caseSensitive } = GrepArgsSchema.parse(
          args ?? {}
        )

        validateRegexPattern(pattern)

        const { entry } = await context.getEntry(id)
        const filePath = await context.ensureMaterialized(entry)

        const result = await grepFile(filePath, pattern, {
          maxResults,
          contextLines,
          caseSensitive
        })

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }
    }
  ]
}
