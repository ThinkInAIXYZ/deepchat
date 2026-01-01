import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ContentEnricher } from '@/presenter/content/contentEnricher'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { nanoid } from 'nanoid'
import { Sandbox } from '@e2b/code-interpreter'
import { RuntimeHelper } from '@/lib/runtimeHelper'

type ShellEnvironment = {
  platform: 'windows' | 'mac' | 'linux'
  shellName: 'powershell' | 'bash'
  shellExecutable: string
  buildArgs: (command: string) => string[]
  promptHint: string
}

// Schema 定义
const GetTimeArgsSchema = z.object({
  offset: z
    .number()
    .optional()
    .default(0)
    .describe('Millisecond offset relative to current time, positive for future, negative for past')
})

const GetWebInfoArgsSchema = z.object({
  url: z.string().url().describe('URL of the webpage to retrieve detailed information')
})

const RunNodeCodeArgsSchema = z.object({
  code: z
    .string()
    .describe(
      'Node.js code to execute, should not contain file operations, system settings modification, or external code execution'
    ),
  timeout: z
    .number()
    .optional()
    .default(5000)
    .describe('Code execution timeout in milliseconds, default 5 seconds')
})

const RunShellCommandArgsSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      'Shell command to execute. Provide the full command string including arguments and flags.'
    ),
  timeout: z
    .number()
    .optional()
    .default(60000)
    .describe('Command execution timeout in milliseconds, defaults to 60 seconds.'),
  workdir: z
    .string()
    .optional()
    .describe(
      'Optional working directory within the sandboxed temp area. If omitted, uses an isolated temporary directory under the application temp path.'
    )
})

// E2B 代码执行 Schema
const E2BRunCodeArgsSchema = z.object({
  code: z
    .string()
    .describe(
      'Python code to execute in E2B secure sandbox. Supports Jupyter Notebook syntax and has access to common Python libraries.'
    ),
  language: z
    .string()
    .optional()
    .default('python')
    .describe('Programming language for code execution, currently supports python')
})

// 限制和安全配置
const CODE_EXECUTION_FORBIDDEN_PATTERNS = [
  // 允许os模块用于系统信息读取，但仍然禁止其他危险模块
  /require\s*\(\s*['"](fs|child_process|path|dgram|cluster|v8|vm|module|worker_threads|repl|tls)['"]\s*\)/gi,
  // 允许安全的只读操作，禁止危险的修改操作
  /process\.(exit|kill|abort|chdir|cwd|binding|dlopen|abort)/gi,
  // 禁止动态代码执行
  /eval\s*\(/gi,
  /Function\s*\(/gi,
  /new\s+Function/gi,
  /require\s*\(\s*[^'"]/gi,
  /import\s*\(/gi,
  /globalThis/gi,
  /global\./gi,
  /__dirname/gi,
  /__filename/gi,
  /process\.env/gi
]

const SHELL_COMMAND_FORBIDDEN_PATTERNS = [
  /\b(sudo|su)\b/gi,
  /\brm\s+-[^\n]*\brf\b/gi,
  /\b(del|erase|rmdir|rd)\b\s+\/[^\n]*\b(s|q)\b/gi,
  /\b(shutdown|reboot|halt|poweroff)\b/gi,
  /\b(mkfs|diskpart|format)\b/gi,
  /:\s*\(\s*\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;\s*:/g
]

export class PowerpackServer {
  private server: Server
  private useE2B: boolean = false
  private e2bApiKey: string = ''
  private readonly runtimeHelper = RuntimeHelper.getInstance()
  private readonly shellEnvironment: ShellEnvironment
  private readonly shellWorkdir: string

  constructor(env?: Record<string, any>) {
    // 从环境变量中获取 E2B 配置
    this.parseE2BConfig(env)

    // 查找内置的运行时路径
    this.runtimeHelper.initializeRuntimes()

    // 检测当前系统的 Shell 环境
    this.shellEnvironment = this.detectShellEnvironment()

    // 确保 Shell 使用的工作目录
    this.shellWorkdir = this.ensureShellWorkdir()

    // 创建服务器实例
    this.server = new Server(
      {
        name: 'deepchat-inmemory/powerpack-server',
        version: '0.2.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    // 设置请求处理器
    this.setupRequestHandlers()
  }

  // 解析 E2B 配置
  private parseE2BConfig(env?: Record<string, any>): void {
    if (env) {
      this.useE2B = env.USE_E2B === true || env.USE_E2B === 'true'
      this.e2bApiKey = env.E2B_API_KEY || ''

      // 如果启用了 E2B 但没有提供 API Key，记录警告
      if (this.useE2B && !this.e2bApiKey) {
        console.warn('E2B is enabled but no API key provided. E2B functionality will be disabled.')
        this.useE2B = false
      }
    }
  }

  private detectShellEnvironment(): ShellEnvironment {
    if (process.platform === 'win32') {
      return {
        platform: 'windows',
        shellName: 'powershell',
        shellExecutable: 'powershell.exe',
        buildArgs: (command) => ['-NoProfile', '-NonInteractive', '-Command', command],
        promptHint:
          'Windows environment detected. Commands run with PowerShell, you can use built-in cmdlets and scripts.'
      }
    }

    const isMac = process.platform === 'darwin'

    return {
      platform: isMac ? 'mac' : 'linux',
      shellName: 'bash',
      shellExecutable: process.env.SHELL || '/bin/bash',
      buildArgs: (command) => ['-c', command],
      promptHint: isMac
        ? 'macOS environment detected. Commands run with bash; macOS utilities like osascript, open, defaults are available.'
        : 'Linux environment detected. Commands run with bash and typical GNU utilities are available.'
    }
  }

  // 启动服务器
  public async startServer(transport: Transport): Promise<void> {
    this.server.connect(transport)
  }

  // 检查代码的安全性
  private checkCodeSafety(code: string): boolean {
    for (const pattern of CODE_EXECUTION_FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(code)) {
        return false
      }
    }
    return true
  }

  // 格式化相对时间
  private formatRelativeTime(userQuery: string, actualTime: string): string {
    return `${userQuery} ${actualTime}`
  }

  // 执行JavaScript代码
  private async executeJavaScriptCode(code: string, timeout: number): Promise<string> {
    // 所有平台都使用 Node.js
    const nodeRuntimePath = this.runtimeHelper.getNodeRuntimePath()
    if (!nodeRuntimePath) {
      throw new Error('Runtime not found; cannot execute code')
    }

    // 检查代码安全性
    if (!this.checkCodeSafety(code)) {
      throw new Error('Code contains disallowed operations and was rejected')
    }

    // 创建临时文件
    const tempDir = app.getPath('temp')
    const tempFile = path.join(tempDir, `powerpack_${nanoid()}.js`)

    try {
      // 写入代码到临时文件
      fs.writeFileSync(tempFile, code)

      let executable: string
      let args: string[]

      // 所有平台都使用 Node.js
      if (process.platform === 'win32') {
        executable = path.join(nodeRuntimePath, 'node.exe')
        args = [tempFile]
      } else {
        executable = path.join(nodeRuntimePath, 'bin', 'node')
        args = [tempFile]
      }

      // 执行代码并添加超时控制
      const execPromise = promisify(execFile)(executable, args, {
        timeout,
        windowsHide: true
      })

      const { stdout, stderr } = await execPromise

      if (stderr && stderr.length > 0) {
        return `Execution error: ${stderr}`
      }

      return stdout
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Code execution failed: ${errorMessage}`)
    } finally {
      // 清理临时文件
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile)
        }
      } catch (cleanupError) {
        console.error('Failed to clean up temporary file:', cleanupError)
      }
    }
  }

  private checkShellCommandSafety(command: string): void {
    for (const pattern of SHELL_COMMAND_FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(command)) {
        throw new Error('Shell command contains disallowed operations and was rejected')
      }
    }
  }

  private getRealPath(candidate: string): string {
    try {
      return fs.realpathSync(candidate)
    } catch {
      return path.resolve(candidate)
    }
  }

  private resolveShellCwd(workdir?: string): string {
    const requestedCwd = workdir || this.shellWorkdir
    const resolvedCwd = this.getRealPath(path.resolve(requestedCwd))
    const shellRoot = this.getRealPath(this.shellWorkdir)
    const tempRoot = this.getRealPath(app.getPath('temp'))

    const isWithin = (child: string, parent: string) =>
      child === parent || child.startsWith(parent + path.sep)

    if (!isWithin(resolvedCwd, shellRoot) && !isWithin(resolvedCwd, tempRoot)) {
      throw new Error(`workdir must be within sandboxed temp directories: ${shellRoot}`)
    }

    if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
      throw new Error(`workdir does not exist or is not a directory: ${resolvedCwd}`)
    }

    return resolvedCwd
  }

  private formatShellOutput(stdout?: string, stderr?: string, errorMessage?: string): string {
    const outputParts: string[] = []
    const trimmedStdout = stdout?.trim()
    const trimmedStderr = stderr?.trim()

    if (trimmedStdout) {
      outputParts.push(`STDOUT:\n${trimmedStdout}`)
    }

    if (trimmedStderr) {
      outputParts.push(`STDERR:\n${trimmedStderr}`)
    }

    if (errorMessage) {
      const trimmedError = errorMessage.trim()
      if (trimmedError) {
        outputParts.push(`ERROR:\n${trimmedError}`)
      }
    }

    return outputParts.join('\n\n') || 'Command executed with no output'
  }

  private async executeShellCommand(
    command: string,
    timeout: number,
    workdir?: string
  ): Promise<string> {
    this.checkShellCommandSafety(command)
    const { shellExecutable, buildArgs } = this.shellEnvironment
    const cwd = this.resolveShellCwd(workdir)

    try {
      const { stdout, stderr } = await promisify(execFile)(shellExecutable, buildArgs(command), {
        timeout,
        cwd,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      })

      return this.formatShellOutput(stdout, stderr)
    } catch (error) {
      const stdout = typeof (error as any)?.stdout === 'string' ? (error as any).stdout : ''
      const stderr = typeof (error as any)?.stderr === 'string' ? (error as any).stderr : ''
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(this.formatShellOutput(stdout, stderr, errorMessage))
    }
  }

  private ensureShellWorkdir(): string {
    const baseTempDir = app.getPath('temp')
    const shellDirPrefix = path.join(baseTempDir, 'powerpack_shell_')

    try {
      return fs.mkdtempSync(shellDirPrefix)
    } catch (error) {
      console.error('Failed to ensure shell workdir, falling back to temp path:', error)
      return baseTempDir
    }
  }

  // 使用 E2B 执行代码
  private async executeE2BCode(code: string): Promise<string> {
    if (!this.useE2B) {
      throw new Error('E2B is not enabled')
    }

    let sandbox: Sandbox | null = null
    try {
      sandbox = await Sandbox.create({
        apiKey: this.e2bApiKey
      })
      const result = await sandbox.runCode(code)

      // 格式化结果
      const output: string[] = []

      // 添加执行结果
      if (result.results && result.results.length > 0) {
        for (const res of result.results) {
          if ((res as any).isError) {
            const error = (res as any).error
            output.push(`Error: ${error?.name || 'Unknown'}: ${error?.value || 'Unknown error'}`)
            if (error?.traceback) {
              output.push(error.traceback.join('\n'))
            }
          } else if (res.text) {
            output.push(res.text)
          } else if ((res as any).data) {
            output.push(JSON.stringify((res as any).data, null, 2))
          }
        }
      }

      // 添加日志输出
      if (result.logs) {
        if (result.logs.stdout.length > 0) {
          output.push('STDOUT:')
          output.push(...result.logs.stdout)
        }
        if (result.logs.stderr.length > 0) {
          output.push('STDERR:')
          output.push(...result.logs.stderr)
        }
      }

      return output.join('\n') || 'Code executed successfully (no output)'
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`E2B execution failed: ${errorMessage}`)
    } finally {
      // 清理沙箱
      if (sandbox) {
        try {
          await sandbox.kill()
        } catch (error) {
          console.error('Failed to close E2B sandbox:', error)
        }
      }
    }
  }

  // 设置请求处理器
  private setupRequestHandlers(): void {
    // 设置工具列表处理器
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // 准备基本工具列表
      const tools = [
        {
          name: 'get_time',
          description:
            'Get formatted time with specified offset from current time. Calculate any time point relative to the current time. ' +
            "For example, get current time, yesterday's time, tomorrow's time, etc. " +
            'Use the offset parameter (milliseconds) to specify the offset relative to the current time, positive for future, negative for past.',
          inputSchema: zodToJsonSchema(GetTimeArgsSchema)
        },
        {
          name: 'get_web_info',
          description:
            'Get detailed content information from a specified webpage. Extract title, description, main content, and other information. ' +
            'This tool is useful for analyzing webpage content, obtaining article summaries or details. ' +
            'Just provide a valid HTTP or HTTPS URL to get complete webpage content analysis.',
          inputSchema: zodToJsonSchema(GetWebInfoArgsSchema)
        },
        {
          name: 'run_shell_command',
          description:
            `${this.shellEnvironment.promptHint} ` +
            'Use this tool for day-to-day automation, file inspection, networking, and scripting. ' +
            'Provide a full shell command string; output includes stdout and stderr. ',
          inputSchema: zodToJsonSchema(RunShellCommandArgsSchema)
        }
      ]

      // 根据配置添加代码执行工具
      if (this.useE2B) {
        // 使用 E2B 执行代码
        tools.push({
          name: 'run_code',
          description:
            'Execute Python code in a secure E2B sandbox environment. Supports Jupyter Notebook syntax and has access to common Python libraries. ' +
            'The code will be executed in an isolated environment with full Python ecosystem support. ' +
            'This is safer than local execution as it runs in a controlled cloud sandbox. ' +
            'Perfect for data analysis, calculations, visualizations, and any Python programming tasks.',
          inputSchema: zodToJsonSchema(E2BRunCodeArgsSchema)
        })
      } else {
        // 使用本地运行时执行代码
        const nodeRuntimePath = this.runtimeHelper.getNodeRuntimePath()
        if (nodeRuntimePath) {
          const runtimeDescription =
            'Execute simple JavaScript/TypeScript code in a secure sandbox environment using Node.js runtime. '

          tools.push({
            name: 'run_node_code',
            description:
              runtimeDescription +
              'Suitable for calculations, data transformations, encryption/decryption, and network operations. ' +
              'The code needs to be output to the console, and the output content needs to be formatted as a string. ' +
              'For security reasons, the code cannot perform file operations, modify system settings, spawn child processes, or execute external code from network. ' +
              'Code execution has a timeout limit, default is 5 seconds, you can adjust it based on the estimated time of the code, generally not recommended to exceed 2 minutes. ' +
              'When a problem can be solved by a simple and secure JavaScript/TypeScript code or you have generated a simple code for the user and want to execute it, please use this tool, providing more reliable information to the user.',
            inputSchema: zodToJsonSchema(RunNodeCodeArgsSchema)
          })
        }
      }

      return { tools }
    })

    // 设置工具调用处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        switch (name) {
          case 'get_time': {
            const parsed = GetTimeArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid time arguments: ${parsed.error}`)
            }

            const { offset } = parsed.data
            const targetTime = new Date(Date.now() + offset)
            const formattedTime = targetTime.toLocaleString()

            // 根据偏移量判断是什么时间
            const timeDescription = 'The requested time is:'

            return {
              content: [
                {
                  type: 'text',
                  text: this.formatRelativeTime(timeDescription, formattedTime)
                }
              ]
            }
          }

          case 'get_web_info': {
            const parsed = GetWebInfoArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid URL arguments: ${parsed.error}`)
            }

            const { url } = parsed.data
            const enrichedData = await ContentEnricher.enrichUrl(url)

            // 格式化网页内容为易读的格式
            let formattedContent = `## Webpage Details\n\n`
            formattedContent += `### Title\n${enrichedData.title || 'No Title'}\n\n`
            formattedContent += `### URL\n${enrichedData.url}\n\n`

            if (enrichedData.description) {
              formattedContent += `### Description\n${enrichedData.description}\n\n`
            }

            if (enrichedData.content) {
              const truncatedContent =
                enrichedData.content.length > 1000
                  ? enrichedData.content.substring(0, 1000) + '...(Content truncated)'
                  : enrichedData.content
              formattedContent += `### Main Content\n${truncatedContent}\n\n`
            }

            return {
              content: [
                {
                  type: 'text',
                  text: formattedContent
                }
              ]
            }
          }

          case 'run_shell_command': {
            const parsed = RunShellCommandArgsSchema.safeParse(args)

            if (!parsed.success) {
              throw new Error(`Invalid command arguments: ${parsed.error}`)
            }

            const { command, timeout, workdir } = parsed.data
            const result = await this.executeShellCommand(command, timeout, workdir)

            return {
              content: [
                {
                  type: 'text',
                  text: `Current shell environment: ${this.shellEnvironment.shellName}\n\nExecution result:\n${result}`
                }
              ]
            }
          }

          case 'run_code': {
            // E2B 代码执行
            if (!this.useE2B) {
              throw new Error('E2B is not enabled')
            }

            const parsed = E2BRunCodeArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid code arguments: ${parsed.error}`)
            }

            const { code } = parsed.data
            const result = await this.executeE2BCode(code)

            return {
              content: [
                {
                  type: 'text',
                  text: `Code execution result (E2B Sandbox):\n\n${result}`
                }
              ]
            }
          }

          case 'run_node_code': {
            // 本地 JavaScript 代码执行
            if (this.useE2B) {
              throw new Error('Local code execution is disabled when E2B is enabled')
            }

            const nodeRuntimePath = this.runtimeHelper.getNodeRuntimePath()
            if (!nodeRuntimePath) {
              throw new Error('JavaScript runtime is not available, cannot execute code')
            }

            const parsed = RunNodeCodeArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid code arguments: ${parsed.error}`)
            }

            const { code, timeout } = parsed.data
            const result = await this.executeJavaScriptCode(code, timeout)

            return {
              content: [
                {
                  type: 'text',
                  text: `Code execution result:\n\n${result}`
                }
              ]
            }
          }

          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }
}
