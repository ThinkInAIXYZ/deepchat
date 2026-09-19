import {
  StdioClientTransport,
  type StdioServerParameters
} from '@modelcontextprotocol/client/stdio'
import type { ManagedMcpStdio } from './ports.js'

export interface McpProcessLifecycle {
  recordLaunch(record: { recordId: string; pid: number; commandLine: string[] }): void
  terminateTree(pid: number): Promise<boolean>
  clearLaunch(recordId: string): void
}

/** The host supplies persistence and process-tree operations; no child handle escapes this closure. */
export function createManagedMcpStdio(
  params: StdioServerParameters,
  recordId: string,
  lifecycle: McpProcessLifecycle
): ManagedMcpStdio {
  let launchedPid: number | undefined
  class RecordedTransport extends StdioClientTransport {
    override async start(): Promise<void> {
      await super.start()
      launchedPid = this.pid ?? undefined
      if (launchedPid)
        lifecycle.recordLaunch({
          recordId,
          pid: launchedPid,
          commandLine: [params.command, ...(params.args ?? [])]
        })
    }
  }
  const transport = new RecordedTransport(params)
  // Drain stderr without forwarding arbitrary server output (which may contain credentials).
  transport.stderr?.on('data', () => {})
  return {
    transport,
    async terminate() {
      const pid = launchedPid ?? transport.pid
      if (!pid) return false
      const terminated = await lifecycle.terminateTree(pid)
      if (terminated) {
        lifecycle.clearLaunch(recordId)
        launchedPid = undefined
      }
      return terminated
    }
  }
}
