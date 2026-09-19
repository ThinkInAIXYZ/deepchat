import { app } from 'electron'
import axios from 'axios'
import { createManagedMcpStdio, type McpClientHost, type McpManagerHost } from '@deepchat/mcp'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import { ToolchainService } from '@/toolchains'
import { getPathEntriesFromEnv, setPathEntriesOnEnv } from '@/agent/shared/process/shellEnvHelper'
import { terminateProcessTreeByPid } from '@/agent/shared/process/processTree'
import { childProcessRegistry } from '@/agent/shared/process/childProcessRegistry'
import { awaitWithAbort } from '@deepchat/agent-kernel/collab/lib/awaitWithAbort'
import { proxyConfig } from '@/platform/proxy'

export function createMcpClientHost(): McpClientHost {
  const runtime = RuntimeHelper.getInstance()
  const toolchain = () => ToolchainService.getInstance()
  return {
    identity: { name: 'DeepChat', version: app.getVersion() },
    home: app.getPath('home'),
    initializeRuntimes: () => runtime.initializeRuntimes(),
    expandPath: (value) => runtime.expandPath(value),
    rewriteCommand: (command, args) => toolchain().rewriteCommand(command, args),
    runtimeRoot: (name) => toolchain().resolve(name).rootDir,
    resolvedBinDirs: () => toolchain().resolvedBinDirs(),
    getDefaultPaths: (home) => runtime.getDefaultPaths(home),
    getPathEntriesFromEnv,
    setPathEntriesOnEnv,
    awaitWithAbort,
    createStdio: (params, recordId) =>
      createManagedMcpStdio(params, recordId, {
        recordLaunch: (record) =>
          childProcessRegistry.record({ subsystem: 'mcp-stdio', ...record }),
        terminateTree: (pid) => terminateProcessTreeByPid(pid, { graceMs: 2000 }),
        clearLaunch: (id) => childProcessRegistry.clear('mcp-stdio', id)
      })
  }
}

export function createMcpManagerHost(
  notifications: McpManagerHost['notifications']
): McpManagerHost {
  return {
    client: createMcpClientHost(),
    notifications,
    async probeRegistry(url, signal) {
      const proxyUrl = proxyConfig.getProxyUrl()
      const proxyOptions = (() => {
        if (!proxyUrl) return {}
        const u = new URL(proxyUrl)
        const host = u.hostname
        const port = u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80
        const auth = u.username ? { username: u.username, password: u.password ?? '' } : undefined
        return { proxy: { host, port, ...(auth ? { auth } : {}) } }
      })()
      const response = await axios.get(url, { ...proxyOptions, signal })
      return response.status >= 200 && response.status < 300
    }
  }
}
