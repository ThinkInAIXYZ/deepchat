import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import logger from '@shared/logger'
import type { IConfigPresenter } from '@shared/presenter'
import type {
  ISkillPresenter,
  SkillExtensionConfig,
  SkillRuntimePreference,
  SkillScriptDescriptor
} from '@shared/types/skill'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import { resolveSessionDir } from '../sessionPresenter/sessionPaths'
import { backgroundExecSessionManager } from '../agentPresenter/acp/backgroundExecSessionManager'
import { getShellEnvironment, getUserShell } from '../agentPresenter/acp/shellEnvHelper'

const DEFAULT_TIMEOUT_MS = 120000
const FOREGROUND_OFFLOAD_THRESHOLD = 10000
const FOREGROUND_PREVIEW_CHARS = 12000

export interface SkillRunRequest {
  skill: string
  script: string
  args?: string[]
  stdin?: string
  background?: boolean
  timeoutMs?: number
}

export interface SkillRunOptions {
  conversationId: string
}

interface RuntimeCommand {
  command: string
  argsPrefix?: string[]
  mode: 'uv' | 'python' | 'node' | 'shell'
}

interface SpawnPlan {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  shellCommand: string
  outputPrefix: string
}

function toStringEnv(input: NodeJS.ProcessEnv | Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

export class SkillExecutionService {
  private readonly runtimeHelper = RuntimeHelper.getInstance()

  constructor(
    private readonly skillPresenter: ISkillPresenter,
    _configPresenter: IConfigPresenter
  ) {
    this.runtimeHelper.initializeRuntimes()
  }

  async execute(
    input: SkillRunRequest,
    options: SkillRunOptions
  ): Promise<string | { status: 'running'; sessionId: string }> {
    const plan = await this.buildSpawnPlan(input, options.conversationId)
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

    if (input.background) {
      const result = await backgroundExecSessionManager.start(
        options.conversationId,
        plan.shellCommand,
        plan.cwd,
        {
          timeout: timeoutMs,
          env: plan.env
        }
      )

      if (input.stdin) {
        backgroundExecSessionManager.write(
          options.conversationId,
          result.sessionId,
          input.stdin,
          true
        )
      }

      return { status: 'running', sessionId: result.sessionId }
    }

    return await this.runForeground(plan, timeoutMs, options.conversationId, input.stdin)
  }

  private async buildSpawnPlan(input: SkillRunRequest, conversationId: string): Promise<SpawnPlan> {
    const activeSkills = await this.skillPresenter.getActiveSkills(conversationId)
    if (!activeSkills.includes(input.skill)) {
      throw new Error(`Skill "${input.skill}" is not active in this conversation`)
    }

    const metadata = (await this.skillPresenter.getMetadataList()).find(
      (item) => item.name === input.skill
    )
    if (!metadata) {
      throw new Error(`Skill "${input.skill}" not found`)
    }

    const scripts = await this.skillPresenter.listSkillScripts(input.skill)
    const script = this.resolveRequestedScript(input.script, scripts)
    if (!script.enabled) {
      throw new Error(`Skill script "${script.relativePath}" is disabled`)
    }

    const extension = await this.skillPresenter.getSkillExtension(input.skill)
    const shellEnv = await getShellEnvironment()
    const mergedEnv = {
      ...toStringEnv(process.env),
      ...shellEnv,
      ...extension.env
    }

    const runtime = await this.resolveRuntimeCommand(
      script,
      extension,
      metadata.skillRoot,
      mergedEnv
    )
    const args = this.buildRuntimeArgs(runtime, script, metadata.skillRoot, input.args ?? [])

    return {
      command: runtime.command,
      args,
      cwd: metadata.skillRoot,
      env: mergedEnv,
      shellCommand: this.buildShellCommand(runtime.command, args),
      outputPrefix: `skillrun_${input.skill.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    }
  }

  private resolveRequestedScript(
    requestedScript: string,
    scripts: SkillScriptDescriptor[]
  ): SkillScriptDescriptor {
    const normalized = requestedScript.trim().replace(/\\/g, '/')
    if (!normalized) {
      throw new Error('script is required')
    }

    const exact = scripts.find((script) => script.relativePath.replace(/\\/g, '/') === normalized)
    if (exact) {
      return exact
    }

    const prefixed = scripts.find(
      (script) => script.relativePath.replace(/\\/g, '/') === `scripts/${normalized}`
    )
    if (prefixed) {
      return prefixed
    }

    const byName = scripts.filter((script) => script.name === path.basename(normalized))
    if (byName.length === 1) {
      return byName[0]
    }
    if (byName.length > 1) {
      throw new Error(`Multiple scripts match "${requestedScript}". Use the full relative path.`)
    }

    throw new Error(`Skill script "${requestedScript}" not found`)
  }

  private async resolveRuntimeCommand(
    script: SkillScriptDescriptor,
    extension: SkillExtensionConfig,
    skillRoot: string,
    env: Record<string, string>
  ): Promise<RuntimeCommand> {
    if (script.runtime === 'shell') {
      if (process.platform === 'win32') {
        throw new Error('Shell skill scripts are not supported on Windows')
      }
      const { shell } = getUserShell()
      return { command: shell, mode: 'shell' }
    }

    if (script.runtime === 'node') {
      return await this.resolveNodeRuntime(extension.runtimePolicy.node, env)
    }

    return await this.resolvePythonRuntime(extension.runtimePolicy.python, env, skillRoot)
  }

  private async resolvePythonRuntime(
    preference: SkillRuntimePreference,
    env: Record<string, string>,
    _skillRoot: string
  ): Promise<RuntimeCommand> {
    if (preference === 'builtin') {
      const bundledUv = this.getBundledRuntimeCommand('uv')
      if (!bundledUv) {
        throw new Error('Bundled uv runtime is not available')
      }
      return { command: bundledUv, mode: 'uv' }
    }

    if (preference === 'system') {
      const system = await this.findSystemPythonRuntime(env)
      if (!system) {
        throw new Error('No compatible system Python runtime found for this skill')
      }
      return system
    }

    if (await this.hasCommand('uv', ['--version'], env)) {
      return { command: 'uv', mode: 'uv' }
    }

    const bundledUv = this.getBundledRuntimeCommand('uv')
    if (bundledUv) {
      return { command: bundledUv, mode: 'uv' }
    }

    const fallback = await this.findSystemPythonRuntime(env)
    if (!fallback) {
      throw new Error('No compatible Python runtime found for this skill')
    }
    return fallback
  }

  private async resolveNodeRuntime(
    preference: SkillRuntimePreference,
    env: Record<string, string>
  ): Promise<RuntimeCommand> {
    if (preference === 'builtin') {
      const bundledNode = this.getBundledRuntimeCommand('node')
      if (!bundledNode) {
        throw new Error('Bundled node runtime is not available')
      }
      return { command: bundledNode, mode: 'node' }
    }

    if (preference === 'system') {
      if (!(await this.hasCommand('node', ['--version'], env))) {
        throw new Error('System node runtime is not available')
      }
      return { command: 'node', mode: 'node' }
    }

    if (await this.hasCommand('node', ['--version'], env)) {
      return { command: 'node', mode: 'node' }
    }

    const bundledNode = this.getBundledRuntimeCommand('node')
    if (!bundledNode) {
      throw new Error('No compatible node runtime found for this skill')
    }
    return { command: bundledNode, mode: 'node' }
  }

  private async findSystemPythonRuntime(
    env: Record<string, string>
  ): Promise<RuntimeCommand | null> {
    const candidates: Array<{ command: string; probeArgs: string[]; argsPrefix?: string[] }> =
      process.platform === 'win32'
        ? [
            { command: 'python', probeArgs: ['--version'] },
            { command: 'py', probeArgs: ['-3', '--version'], argsPrefix: ['-3'] }
          ]
        : [
            { command: 'python3', probeArgs: ['--version'] },
            { command: 'python', probeArgs: ['--version'] }
          ]

    for (const candidate of candidates) {
      if (await this.hasCommand(candidate.command, candidate.probeArgs, env)) {
        return {
          command: candidate.command,
          argsPrefix: candidate.argsPrefix,
          mode: 'python'
        }
      }
    }

    return null
  }

  private buildRuntimeArgs(
    runtime: RuntimeCommand,
    script: SkillScriptDescriptor,
    skillRoot: string,
    args: string[]
  ): string[] {
    if (runtime.mode === 'uv') {
      const commandArgs = ['run']
      if (fs.existsSync(path.join(skillRoot, 'pyproject.toml'))) {
        commandArgs.push('--project', skillRoot)
      }
      commandArgs.push(script.absolutePath, ...args)
      return commandArgs
    }

    if (runtime.mode === 'python') {
      return [...(runtime.argsPrefix ?? []), script.absolutePath, ...args]
    }

    if (runtime.mode === 'node') {
      return [script.absolutePath, ...args]
    }

    return [script.absolutePath, ...args]
  }

  private async runForeground(
    plan: SpawnPlan,
    timeoutMs: number,
    conversationId: string,
    stdin?: string
  ): Promise<string> {
    const outputFilePath = this.createForegroundOutputPath(conversationId, plan.outputPrefix)

    return await new Promise((resolve, reject) => {
      const child = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env: plan.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      })

      let outputBuffer = ''
      let totalOutputLength = 0
      let offloaded = false
      let timedOut = false
      let outputWriteQueue = Promise.resolve()
      let timeoutId: NodeJS.Timeout | null = null

      const queueOutputWrite = (data: string) => {
        if (!outputFilePath || !data) {
          outputBuffer += data
          return
        }

        outputWriteQueue = outputWriteQueue
          .then(async () => {
            await fs.promises.appendFile(outputFilePath, data, 'utf-8')
          })
          .catch((error) => {
            logger.warn('[SkillExecutionService] Failed to flush foreground output', {
              outputFilePath,
              error
            })
            outputBuffer += data
          })
      }

      const appendOutput = (data: string) => {
        totalOutputLength += data.length
        const shouldOffload =
          outputFilePath !== null && (offloaded || totalOutputLength > FOREGROUND_OFFLOAD_THRESHOLD)

        if (!shouldOffload) {
          outputBuffer += data
          return
        }

        offloaded = true
        const chunk = outputBuffer + data
        outputBuffer = ''
        queueOutputWrite(chunk)
      }

      child.stdout?.setEncoding('utf-8')
      child.stderr?.setEncoding('utf-8')
      child.stdout?.on('data', (data: string) => appendOutput(data))
      child.stderr?.on('data', (data: string) => appendOutput(data))

      if (stdin !== undefined) {
        child.stdin?.write(stdin)
      }
      child.stdin?.end()

      timeoutId = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore kill errors
        }
      }, timeoutMs)

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId)
        reject(error)
      })

      child.on('close', async (code) => {
        if (timeoutId) clearTimeout(timeoutId)

        try {
          await outputWriteQueue
        } catch {
          // Already logged when the queue failed.
        }

        const preview =
          offloaded && outputFilePath
            ? this.readLastCharsFromFile(outputFilePath, FOREGROUND_PREVIEW_CHARS)
            : outputBuffer

        const lines: string[] = []
        if (preview.trim()) {
          lines.push(preview.trimEnd())
        }
        lines.push(`Exit Code: ${code ?? 'null'}`)
        if (timedOut) {
          lines.push('Timed out')
        }
        if (offloaded && outputFilePath) {
          lines.push(`Output offloaded: ${outputFilePath}`)
        }
        resolve(lines.join('\n'))
      })
    })
  }

  private buildShellCommand(command: string, args: string[]): string {
    return [command, ...args].map((token) => this.quoteForShell(token)).join(' ')
  }

  private quoteForShell(token: string): string {
    if (process.platform === 'win32') {
      return `"${token.replace(/%/g, '%%').replace(/"/g, '\\"')}"`
    }
    return `'${token.replace(/'/g, `'\\''`)}'`
  }

  private getBundledRuntimeCommand(command: 'uv' | 'node'): string | null {
    this.runtimeHelper.initializeRuntimes()

    if (command === 'uv' && !this.runtimeHelper.getUvRuntimePath()) {
      return null
    }
    if (command === 'node' && !this.runtimeHelper.getNodeRuntimePath()) {
      return null
    }

    const resolved = this.runtimeHelper.replaceWithRuntimeCommand(command, true, true)
    return resolved === command ? null : resolved
  }

  private async hasCommand(
    command: string,
    args: string[],
    env: Record<string, string>
  ): Promise<boolean> {
    return await new Promise((resolve) => {
      const child = spawn(command, args, {
        env,
        stdio: 'ignore',
        shell: false
      })

      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
    })
  }

  private createForegroundOutputPath(conversationId: string, prefix: string): string | null {
    const sessionDir = resolveSessionDir(conversationId)
    if (!sessionDir) {
      return null
    }

    try {
      fs.mkdirSync(sessionDir, { recursive: true })
      return path.join(sessionDir, `${prefix}_${Date.now()}.log`)
    } catch (error) {
      logger.warn('[SkillExecutionService] Failed to create session directory for output offload', {
        conversationId,
        error
      })
      return null
    }
  }

  private readLastCharsFromFile(filePath: string, maxChars: number): string {
    try {
      const stats = fs.statSync(filePath)
      const fileSize = stats.size
      const bytesToRead = Math.min(maxChars * 4, fileSize)
      const startPosition = Math.max(0, fileSize - bytesToRead)
      const fd = fs.openSync(filePath, 'r')

      try {
        const buffer = Buffer.alloc(bytesToRead)
        fs.readSync(fd, buffer, 0, bytesToRead, startPosition)
        const content = buffer.toString('utf-8')
        if (startPosition > 0) {
          const firstNewline = content.indexOf('\n')
          if (firstNewline > 0) {
            return content.slice(firstNewline + 1)
          }
        }
        return content
      } finally {
        fs.closeSync(fd)
      }
    } catch (error) {
      logger.warn('[SkillExecutionService] Failed to read preview from offloaded output', {
        filePath,
        error
      })
      return ''
    }
  }
}
