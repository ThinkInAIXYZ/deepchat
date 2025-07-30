import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ContentEnricher } from '@/presenter/threadPresenter/contentEnricher'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { nanoid } from 'nanoid'
import { Sandbox } from '@e2b/code-interpreter'

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

export class PowerpackServer {
  private server: Server
  private bunRuntimePath: string | null = null
  private nodeRuntimePath: string | null = null
  private useE2B: boolean = false
  private e2bApiKey: string = ''

  constructor(env?: Record<string, any>) {
    // 从环境变量中获取 E2B 配置
    this.parseE2BConfig(env)

    // 查找内置的运行时路径
    this.setupRuntimes()

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

  // 设置运行时路径
  private setupRuntimes(): void {
    const runtimeBasePath = path
      .join(app.getAppPath(), 'runtime')
      .replace('app.asar', 'app.asar.unpacked')

    // 设置 Bun 运行时路径
    const bunRuntimePath = path.join(runtimeBasePath, 'bun')
    if (process.platform === 'win32') {
      const bunExe = path.join(bunRuntimePath, 'bun.exe')
      if (fs.existsSync(bunExe)) {
        this.bunRuntimePath = bunRuntimePath
      }
    } else {
      const bunBin = path.join(bunRuntimePath, 'bun')
      if (fs.existsSync(bunBin)) {
        this.bunRuntimePath = bunRuntimePath
      }
    }

    // 设置 Node.js 运行时路径
    const nodeRuntimePath = path.join(runtimeBasePath, 'node')
    if (process.platform === 'win32') {
      const nodeExe = path.join(nodeRuntimePath, 'node.exe')
      if (fs.existsSync(nodeExe)) {
        this.nodeRuntimePath = nodeRuntimePath
      }
    } else {
      const nodeBin = path.join(nodeRuntimePath, 'bin', 'node')
      if (fs.existsSync(nodeBin)) {
        this.nodeRuntimePath = nodeRuntimePath
      }
    }

    if (!this.bunRuntimePath && !this.nodeRuntimePath && !this.useE2B) {
      console.warn('No runtime found (Bun, Node.js, or E2B), code execution will be unavailable')
    } else if (this.useE2B) {
      console.info('Using E2B for code execution')
    } else if (this.bunRuntimePath) {
      console.info('Using built-in Bun runtime')
    } else if (this.nodeRuntimePath) {
      console.info('Using built-in Node.js runtime')
    }
  }

  // 启动服务器
  public async startServer(transport: Transport): Promise<void> {
    this.server.connect(transport)
  }

  // 检查代码的安全性
  private checkCodeSafety(code: string): boolean {
    for (const pattern of CODE_EXECUTION_FORBIDDEN_PATTERNS) {
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
    // Windows平台只检查Node.js，其他平台检查Bun和Node.js
    const hasRuntime =
      process.platform === 'win32'
        ? this.nodeRuntimePath
        : this.bunRuntimePath || this.nodeRuntimePath

    if (!hasRuntime) {
      throw new Error('运行时未找到，无法执行代码')
    }

    // 检查代码安全性
    if (!this.checkCodeSafety(code)) {
      throw new Error('代码包含不安全的操作，已被拒绝执行')
    }

    // 创建临时文件
    const tempDir = app.getPath('temp')
    const tempFile = path.join(tempDir, `powerpack_${nanoid()}.js`)

    try {
      // 写入代码到临时文件
      fs.writeFileSync(tempFile, code)

      let executable: string
      let args: string[]

      // Windows平台使用Node.js，其他平台优先使用Bun
      if (process.platform === 'win32') {
        // Windows只使用Node.js
        executable = path.join(this.nodeRuntimePath!, 'node.exe')
        args = [tempFile]
      } else {
        // 其他平台优先使用Bun
        if (this.bunRuntimePath) {
          executable = path.join(this.bunRuntimePath, 'bun')
          args = [tempFile]
        } else {
          executable = path.join(this.nodeRuntimePath!, 'bin', 'node')
          args = [tempFile]
        }
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
        const hasLocalRuntime =
          process.platform === 'win32'
            ? this.nodeRuntimePath
            : this.bunRuntimePath || this.nodeRuntimePath

        if (hasLocalRuntime) {
          const runtimeDescription =
            process.platform === 'win32'
              ? 'Execute simple JavaScript/TypeScript code in a secure sandbox environment using Node.js runtime on Windows platform. '
              : 'Execute simple JavaScript/TypeScript code in a secure sandbox environment (Bun or Node.js). Non-Windows platforms prioritize Bun runtime. '

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
              throw new Error(`无效的时间参数: ${parsed.error}`)
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
              throw new Error(`无效的URL参数: ${parsed.error}`)
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

          case 'run_code': {
            // E2B 代码执行
            if (!this.useE2B) {
              throw new Error('E2B is not enabled')
            }

            const parsed = E2BRunCodeArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`无效的代码参数: ${parsed.error}`)
            }

            const { code } = parsed.data
            const result = await this.executeE2BCode(code)

            return {
              content: [
                {
                  type: 'text',
                  text: `代码执行结果 (E2B Sandbox):\n\n${result}`
                }
              ]
            }
          }

          case 'run_node_code': {
            // 本地 JavaScript 代码执行
            if (this.useE2B) {
              throw new Error('Local code execution is disabled when E2B is enabled')
            }

            if (!this.bunRuntimePath && !this.nodeRuntimePath) {
              throw new Error('JavaScript runtime is not available, cannot execute code')
            }

            const parsed = RunNodeCodeArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`无效的代码参数: ${parsed.error}`)
            }

            const { code, timeout } = parsed.data
            const result = await this.executeJavaScriptCode(code, timeout)

            return {
              content: [
                {
                  type: 'text',
                  text: `代码执行结果:\n\n${result}`
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
          content: [{ type: 'text', text: `错误: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }
}
