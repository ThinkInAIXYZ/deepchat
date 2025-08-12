import { BaseAgentProvider } from '../baseAgentProvider'
import type { AGENT_CONFIG } from '../index'
import type {
  ChatMessage,
  LLMCoreStreamEvent,
  MCPToolDefinition,
  ModelConfig,
  MODEL_META
} from '@shared/presenter'
import { spawn } from 'node:child_process'

export class ClaudeCliProvider extends BaseAgentProvider {
  private workingDir: string
  private extraArgs: string

  constructor(agent: AGENT_CONFIG, configPresenter: any) {
    super(agent, configPresenter)
    const cfg = (agent.config || {}) as { workingDir?: string; extraArgs?: string }
    this.workingDir = cfg.workingDir || process.cwd()
    this.extraArgs = cfg.extraArgs || ''
    console.log(
      `Claude CLI Provider initialized with workingDir: ${this.workingDir}, extraArgs: ${this.extraArgs}`
    )
  }

  protected async init(): Promise<void> {
    this.models = [
      {
        id: 'claude-cli',
        name: 'Claude Code CLI',
        group: 'Agent',
        providerId: this.agent.id,
        isCustom: true,
        contextLength: 0,
        maxTokens: 0,
        description: 'Interactive Claude Code terminal session',
        vision: false,
        functionCall: false,
        reasoning: false,
        type: 'rag' as any
      }
    ]
    this.isInitialized = true
  }

  public onProxyResolved(): void {
    // no-op
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['-h'], { cwd: this.workingDir, shell: true })
      let ok = false
      child.on('spawn', () => {
        ok = true
      })
      child.on('error', (e) => resolve({ isOk: false, errorMsg: e.message }))
      child.on('close', () => resolve({ isOk: ok, errorMsg: ok ? null : 'claude not found' }))
    })
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    return this.models
  }

  public async *coreStream(
    _messages: ChatMessage[],
    _modelId: string,
    _modelConfig: ModelConfig,
    _temperature: number,
    _maxTokens: number,
    _tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    // 该 Provider 不直接流式输出，由 TerminalPresenter 负责真正的终端 I/O
    yield { type: 'error', error_message: 'ClaudeCliProvider does not stream directly' }
  }
}
