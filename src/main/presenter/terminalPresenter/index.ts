import { ITerminalPresenter, IThreadPresenter } from '@shared/presenter'
import { eventBus } from '@/eventbus'
// import { STREAM_EVENTS } from '@/events'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
// import os from 'node:os'

type Session = {
  id: string
  pty: IPty
  conversationId: string
  buffer: string
  inputBuffer: string
}

export class TerminalPresenter implements ITerminalPresenter {
  private sessions = new Map<string, Session>()
  private threadPresenter?: IThreadPresenter

  constructor(threadPresenter?: IThreadPresenter) {
    this.threadPresenter = threadPresenter
  }

  async startSession(
    conversationId: string,
    options: { workingDir: string; extraArgs?: string } = { workingDir: process.cwd() }
  ): Promise<string> {
    const cmd = 'claude'
    const args = (options.extraArgs || '').trim().length > 0 ? options.extraArgs!.split(' ') : []

    const pty = spawn(cmd, args, {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: options.workingDir || process.cwd(),
      env: process.env as NodeJS.ProcessEnv
    })

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: Session = { id: sessionId, pty, conversationId, buffer: '', inputBuffer: '' }
    this.sessions.set(sessionId, session)

    pty.onData((data) => {
      // 广播到渲染层
      eventBus.sendToRenderer('terminal:output', undefined as any, { sessionId, data })
      // 简易持久化：将输出作为 assistant 消息写入（按行聚合）
      this.appendAssistantMessage(conversationId, data)
    })

    pty.onExit(({ exitCode, signal }) => {
      eventBus.sendToRenderer('terminal:exit', undefined as any, {
        sessionId,
        code: exitCode,
        signal
      })
    })

    return sessionId
  }

  async write(sessionId: string, data: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return
    s.pty.write(data)
    // 捕获输入并在换行时落盘为 system 消息
    if (!this.threadPresenter) return
    s.inputBuffer += data
    if (/[\r\n]/.test(data)) {
      const line = s.inputBuffer.replace(/[\r\n]+/g, '')
      s.inputBuffer = ''
      if (line.trim().length > 0) {
        void this.threadPresenter.sendMessage(s.conversationId, `> ${line}`, 'system')
      }
    }
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return
    s.pty.resize(cols, rows)
  }

  async stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return
    try {
      s.pty.kill()
    } finally {
      this.sessions.delete(sessionId)
    }
  }

  private async appendAssistantMessage(conversationId: string, chunk: string) {
    if (!this.threadPresenter) return

    // 清理 ANSI 转义序列和特殊字符，确保内容可以安全序列化为 JSON
    const cleanChunk = chunk
      .replace(/\x1b\[[0-9;]*m/g, '') // 移除 ANSI 颜色代码
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // 移除其他 ANSI 转义序列
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 移除控制字符
      .trim()

    // 只有当清理后的内容不为空且有意义时才记录
    if (cleanChunk.length > 0 && !cleanChunk.match(/^[\s─│┌┐└┘├┤┬┴┼╭╮╯╰╱╲╳]*$/)) {
      try {
        await this.threadPresenter.sendMessage(conversationId, cleanChunk, 'assistant')
      } catch (error) {
        console.warn('Failed to save terminal output to chat:', error)
      }
    }
  }
}
