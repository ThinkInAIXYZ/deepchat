import { app, utilityProcess } from 'electron'
import type { HostedProcess, HostedProcessOptions, ProcessHost } from '../processHost'

export const electronProcessHost: ProcessHost = {
  fork(modulePath: string, args: string[], options: HostedProcessOptions): HostedProcess {
    const host = utilityProcess.fork(modulePath, args, {
      serviceName: options.serviceName,
      stdio: options.stdio,
      env: options.env,
      ...(options.execArgv ? { execArgv: options.execArgv } : {})
    })
    return host as unknown as HostedProcess
  },

  async getMemoryRssBytes(pid: number): Promise<number | null> {
    const metric = app.getAppMetrics().find((entry) => entry.pid === pid)
    return metric ? metric.memory.workingSetSize * 1024 : null
  }
}
