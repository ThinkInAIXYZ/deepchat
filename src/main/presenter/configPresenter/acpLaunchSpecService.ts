import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { unzipSync } from 'fflate'
import type {
  AcpAgentConfig,
  AcpAgentInstallState,
  AcpManualAgent,
  AcpRegistryAgent,
  AcpRegistryBinaryDistribution,
  AcpResolvedLaunchSpec
} from '@shared/presenter'

type RegistryDistributionSelection =
  | {
      type: 'binary'
      targetKey: string
      binary: AcpRegistryBinaryDistribution
    }
  | {
      type: 'npx' | 'uvx'
      runner: {
        package: string
        args?: string[]
        env?: Record<string, string>
      }
    }

const sanitizeRelativePath = (input: string): string => {
  const trimmed = input.replace(/^\.\/+/, '').trim()
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'))
  if (!normalized || normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
    throw new Error(`Unsafe archive path: ${input}`)
  }
  return normalized
}

const ensureDir = (dir: string): void => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

const listFilesRecursive = (root: string): string[] => {
  if (!fs.existsSync(root)) {
    return []
  }

  const entries = fs.readdirSync(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath))
      continue
    }
    files.push(fullPath)
  }
  return files
}

export class AcpLaunchSpecService {
  private readonly installRoot: string

  constructor(registryRoot: string) {
    this.installRoot = path.join(registryRoot, 'agents')
    ensureDir(this.installRoot)
  }

  buildRegistryPreview(agent: AcpRegistryAgent): Pick<AcpAgentConfig, 'command' | 'args'> {
    const selection = this.selectRegistryDistribution(agent)
    if (!selection) {
      return {
        command: 'unsupported',
        args: []
      }
    }

    if (selection.type === 'binary') {
      return {
        command: selection.binary.cmd,
        args: selection.binary.args ?? []
      }
    }

    return {
      command: selection.type,
      args:
        selection.type === 'npx'
          ? ['-y', selection.runner.package, ...(selection.runner.args ?? [])]
          : [selection.runner.package, ...(selection.runner.args ?? [])]
    }
  }

  selectRegistryDistribution(agent: AcpRegistryAgent): RegistryDistributionSelection | null {
    const platformKey = this.getPlatformKey()

    if (platformKey && agent.distribution.binary?.[platformKey]) {
      return {
        type: 'binary',
        targetKey: platformKey,
        binary: agent.distribution.binary[platformKey]
      }
    }

    if (agent.distribution.npx) {
      return {
        type: 'npx',
        runner: agent.distribution.npx
      }
    }

    if (agent.distribution.uvx) {
      return {
        type: 'uvx',
        runner: agent.distribution.uvx
      }
    }

    return null
  }

  async ensureRegistryAgentInstalled(
    agent: AcpRegistryAgent,
    currentState: AcpAgentInstallState | null,
    options?: { repair?: boolean }
  ): Promise<AcpAgentInstallState> {
    const selection = this.selectRegistryDistribution(agent)
    const lastCheckedAt = Date.now()

    if (!selection) {
      return {
        status: 'error',
        version: agent.version,
        distributionType: null,
        lastCheckedAt,
        error: `No compatible distribution found for ${process.platform}/${process.arch}`
      }
    }

    if (selection.type !== 'binary') {
      return {
        status: 'installed',
        distributionType: selection.type,
        version: agent.version,
        lastCheckedAt,
        installedAt: currentState?.installedAt ?? lastCheckedAt,
        installDir: null,
        error: null
      }
    }

    const binaryConfig = selection.binary
    const installDir = this.getBinaryInstallDir(agent)
    const commandPath = this.resolveInstalledBinaryPath(installDir, binaryConfig.cmd)

    if (!options?.repair && commandPath) {
      return {
        status: 'installed',
        distributionType: 'binary',
        version: agent.version,
        lastCheckedAt,
        installedAt: currentState?.installedAt ?? lastCheckedAt,
        installDir,
        error: null
      }
    }

    try {
      if (options?.repair && fs.existsSync(installDir)) {
        fs.rmSync(installDir, { recursive: true, force: true })
      }
      ensureDir(installDir)

      const archivePath = await this.downloadArchive(binaryConfig.archive, agent)
      await this.extractArchive(archivePath, installDir)
      fs.rmSync(archivePath, { force: true })

      const installedCommand = this.resolveInstalledBinaryPath(installDir, binaryConfig.cmd)
      if (!installedCommand) {
        throw new Error(`Installed archive does not contain ${binaryConfig.cmd}`)
      }

      if (process.platform !== 'win32') {
        fs.chmodSync(installedCommand, 0o755)
      }

      return {
        status: 'installed',
        distributionType: 'binary',
        version: agent.version,
        lastCheckedAt,
        installedAt: lastCheckedAt,
        installDir,
        error: null
      }
    } catch (error) {
      return {
        status: 'error',
        distributionType: 'binary',
        version: agent.version,
        lastCheckedAt,
        installedAt: currentState?.installedAt ?? null,
        installDir,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async resolveRegistryLaunchSpec(
    agent: AcpRegistryAgent,
    installState: AcpAgentInstallState | null
  ): Promise<AcpResolvedLaunchSpec> {
    const selection = this.selectRegistryDistribution(agent)
    if (!selection) {
      throw new Error(
        `ACP registry agent ${agent.id} does not support ${process.platform}/${process.arch}`
      )
    }

    if (selection.type === 'binary') {
      const ensuredState = await this.ensureRegistryAgentInstalled(agent, installState)
      if (ensuredState.status !== 'installed' || !ensuredState.installDir) {
        throw new Error(ensuredState.error || `Failed to install ACP agent ${agent.id}`)
      }

      const installedCommand = this.resolveInstalledBinaryPath(
        ensuredState.installDir,
        selection.binary.cmd
      )
      if (!installedCommand) {
        throw new Error(`Installed binary for ${agent.id} is missing`)
      }

      return {
        agentId: agent.id,
        source: 'registry',
        distributionType: 'binary',
        version: agent.version,
        command: installedCommand,
        args: selection.binary.args ?? [],
        env: selection.binary.env ?? {},
        installDir: ensuredState.installDir
      }
    }

    return {
      agentId: agent.id,
      source: 'registry',
      distributionType: selection.type,
      version: agent.version,
      command: selection.type,
      args:
        selection.type === 'npx'
          ? ['-y', selection.runner.package, ...(selection.runner.args ?? [])]
          : [selection.runner.package, ...(selection.runner.args ?? [])],
      env: selection.runner.env ?? {},
      installDir: null
    }
  }

  resolveManualLaunchSpec(agent: AcpManualAgent): AcpResolvedLaunchSpec {
    return {
      agentId: agent.id,
      source: 'manual',
      distributionType: 'manual',
      command: agent.command,
      args: agent.args ?? [],
      env: agent.env ?? {},
      installDir: null
    }
  }

  private getBinaryInstallDir(agent: AcpRegistryAgent): string {
    return path.join(this.installRoot, agent.id, agent.version)
  }

  private resolveInstalledBinaryPath(installDir: string, cmd: string): string | null {
    const normalized = sanitizeRelativePath(cmd)
    const directPath = path.join(installDir, normalized)
    if (fs.existsSync(directPath)) {
      return directPath
    }

    const basename = path.basename(normalized)
    return listFilesRecursive(installDir).find((file) => path.basename(file) === basename) ?? null
  }

  private getPlatformKey(): string | null {
    const platformMap: Record<string, string> = {
      darwin: 'darwin',
      linux: 'linux',
      win32: 'windows'
    }
    const archMap: Record<string, string> = {
      arm64: 'aarch64',
      x64: 'x86_64'
    }

    const platform = platformMap[process.platform]
    const arch = archMap[process.arch]

    if (!platform || !arch) {
      return null
    }

    return `${platform}-${arch}`
  }

  private async downloadArchive(url: string, agent: AcpRegistryAgent): Promise<string> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `deepchat-acp-${agent.id}-`))
    const archivePath = path.join(tempDir, path.basename(new URL(url).pathname))
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download archive: ${response.status} ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    fs.writeFileSync(archivePath, Buffer.from(arrayBuffer))
    return archivePath
  }

  private async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    const lowerName = archivePath.toLowerCase()

    if (lowerName.endsWith('.zip')) {
      const archive = unzipSync(new Uint8Array(fs.readFileSync(archivePath)))
      Object.entries(archive).forEach(([entryPath, content]) => {
        const normalized = sanitizeRelativePath(entryPath)
        const outputPath = path.join(targetDir, normalized)
        if (entryPath.endsWith('/')) {
          ensureDir(outputPath)
          return
        }
        ensureDir(path.dirname(outputPath))
        fs.writeFileSync(outputPath, Buffer.from(content))
      })
      return
    }

    this.validateTarEntries(archivePath)
    execFileSync('tar', ['-xf', archivePath, '-C', targetDir], {
      stdio: 'ignore'
    })
  }

  private validateTarEntries(archivePath: string): void {
    const listed = execFileSync('tar', ['-tf', archivePath], {
      encoding: 'utf-8'
    })
    listed
      .split(/\r?\n/)
      .filter((entry) => entry.trim().length > 0)
      .forEach((entry) => {
        sanitizeRelativePath(entry)
      })
  }
}
