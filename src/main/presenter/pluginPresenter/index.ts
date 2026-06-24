import { app, BrowserWindow, shell } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import ElectronStore from 'electron-store'
import { unzipSync } from 'fflate'
import type {
  IConfigPresenter,
  IMCPPresenter,
  ISkillPresenter,
  MCPServerConfig
} from '@shared/presenter'
import type {
  DeepChatPluginManifest,
  PluginActionResult,
  PluginInstallationRecord,
  PluginListItem,
  PluginResourceRecord,
  PluginRuntimeManifest,
  PluginRuntimeStatus,
  PluginSettingsContribution,
  RuntimeDependencyRecord
} from '@shared/types/plugin'
import { OFFICIAL_PLUGIN_SOURCE } from '@shared/types/plugin'
import { registerPluginToolPolicy, unregisterPluginToolPolicies } from './toolPolicyStore'

const execFileAsync = promisify(execFile)

const GITHUB_RELEASE_DOWNLOAD_PREFIX = 'https://github.com/ThinkInAIXYZ/deepchat/releases/download/'
const PLUGIN_PACKAGE_EXTENSION = '.dcplugin'

type PluginStoreShape = {
  installations: PluginInstallationRecord[]
  resources: PluginResourceRecord[]
  runtimes: RuntimeDependencyRecord[]
}

type PluginPresenterDeps = {
  configPresenter: IConfigPresenter
  mcpPresenter: IMCPPresenter
  skillPresenter: ISkillPresenter
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  appPath?: string
  isPackaged?: boolean
  resourcesPath?: string
}

type ResolvedOfficialPlugin = {
  manifest: DeepChatPluginManifest
  root: string
  sourcePath: string
  sourceType: 'directory' | 'package'
}

type RuntimePermissionState = 'granted' | 'missing' | 'unknown'

type RuntimePermissionCheckResult = {
  platform: NodeJS.Platform
  accessibility: RuntimePermissionState
  screenRecording: RuntimePermissionState
  uia?: RuntimePermissionState
  postMessage?: RuntimePermissionState
  diagnostics?: Record<string, string | number | boolean | null>
  error?: string
  command?: string
  stdout?: string
  stderr?: string
}

type SkillContributionPort = ISkillPresenter & {
  registerPluginSkill?: (input: {
    ownerPluginId: string
    id: string
    skillRoot: string
    pluginRoot?: string
  }) => Promise<void> | void
  unregisterPluginSkillsByOwner?: (ownerPluginId: string) => Promise<void> | void
}

export class PluginPresenter {
  private readonly configPresenter: IConfigPresenter
  private readonly mcpPresenter: IMCPPresenter
  private readonly skillPresenter: SkillContributionPort
  private readonly platform: NodeJS.Platform
  private readonly arch: NodeJS.Architecture
  private readonly appPath: string
  private readonly isPackaged: boolean
  private readonly resourcesPath: string
  private readonly settingsWindows = new Map<string, BrowserWindow>()
  private readonly store = new ElectronStore<PluginStoreShape>({
    name: 'plugin-settings',
    defaults: {
      installations: [],
      resources: [],
      runtimes: []
    }
  })
  private officialPlugins = new Map<string, ResolvedOfficialPlugin>()

  constructor(deps: PluginPresenterDeps) {
    this.configPresenter = deps.configPresenter
    this.mcpPresenter = deps.mcpPresenter
    this.skillPresenter = deps.skillPresenter as SkillContributionPort
    this.platform = deps.platform ?? process.platform
    this.arch = deps.arch ?? process.arch
    this.appPath = deps.appPath ?? app.getAppPath()
    this.isPackaged = deps.isPackaged ?? app.isPackaged
    this.resourcesPath = deps.resourcesPath ?? process.resourcesPath ?? ''
  }

  async initialize(): Promise<void> {
    await this.loadOfficialPlugins()
    await this.repairMissingPluginResources()

    for (const installation of this.getInstallations()) {
      if (installation.enabled) {
        try {
          await this.activatePlugin(installation.pluginId)
        } catch (error) {
          console.warn('[PluginHost] Failed to activate installed plugin:', {
            pluginId: installation.pluginId,
            error
          })
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    const pluginIds = new Set(this.getInstallations().map((installation) => installation.pluginId))
    const servers = await this.configPresenter.getMcpServers()

    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (!this.isPluginOwnedServerConfig(serverConfig)) {
        continue
      }

      const ownerPluginId = this.getServerOwnerPluginId(serverConfig)
      if (ownerPluginId) {
        pluginIds.add(ownerPluginId)
      }

      try {
        if (await this.mcpPresenter.isServerRunning(serverName)) {
          await this.mcpPresenter.stopServer(serverName)
        }
      } catch (error) {
        console.warn('[PluginHost] Failed to stop plugin-owned MCP server during shutdown:', {
          pluginId: ownerPluginId,
          serverName,
          error
        })
      }
    }

    for (const pluginId of pluginIds) {
      unregisterPluginToolPolicies(pluginId)
    }

    this.closeAllPluginSettingsWindows()
  }

  async listPlugins(): Promise<PluginListItem[]> {
    await this.loadOfficialPlugins()
    return await Promise.all(
      Array.from(this.officialPlugins.values()).map(async (plugin) => {
        return await this.buildPluginListItem(plugin.manifest.id)
      })
    )
  }

  async getPlugin(pluginId: string): Promise<PluginListItem | undefined> {
    await this.loadOfficialPlugins()
    if (!this.officialPlugins.has(pluginId)) {
      return undefined
    }
    return await this.buildPluginListItem(pluginId)
  }

  async enablePlugin(pluginId: string): Promise<PluginActionResult> {
    try {
      await this.loadOfficialPlugins()
      const plugin = this.getOfficialPluginOrThrow(pluginId)
      this.assertTrustedOfficialPlugin(plugin.manifest)
      this.assertPlatformSupported(plugin.manifest)
      const installation = this.ensureOfficialPluginInstallation(plugin)

      const nextInstallation: PluginInstallationRecord = {
        ...installation,
        enabled: true,
        updatedAt: Date.now()
      }
      try {
        await this.activatePlugin(pluginId)
      } catch (error) {
        await this.disableByOwner(pluginId)
        throw error
      }
      this.upsertInstallation(nextInstallation)
      return { ok: true, status: await this.buildPluginListItem(pluginId) }
    } catch (error) {
      return this.errorResult(error)
    }
  }

  async disablePlugin(pluginId: string): Promise<PluginActionResult> {
    try {
      const installation = this.getInstallation(pluginId)
      if (!installation) {
        return { ok: true, status: await this.buildPluginListItem(pluginId) }
      }

      await this.disableByOwner(pluginId)
      this.upsertInstallation({
        ...installation,
        enabled: false,
        updatedAt: Date.now()
      })
      return { ok: true, status: await this.buildPluginListItem(pluginId) }
    } catch (error) {
      return this.errorResult(error)
    }
  }

  async invokeAction(
    pluginId: string,
    actionId: string,
    _payload?: unknown
  ): Promise<PluginActionResult> {
    try {
      if (actionId === 'settings.open') {
        await this.openPluginSettingsWindow(pluginId)
        return { ok: true }
      }

      switch (actionId) {
        case 'runtime.getStatus':
          return {
            ok: true,
            data: (await this.refreshRuntime(pluginId)) as unknown as PluginActionResult['data']
          }
        case 'runtime.checkPermissions':
          return {
            ok: true,
            data: (await this.checkRuntimePermissions(pluginId)) as PluginActionResult['data']
          }
        case 'runtime.openPermissionGuide':
          await this.openRuntimeGuide(pluginId)
          return { ok: true }
        case 'runtime.openProject':
          await shell.openExternal('https://github.com/trycua/cua')
          return { ok: true }
        case 'runtime.uninstallHelper':
          return {
            ok: false,
            error:
              'Helper uninstall is not implemented for this runtime. Use the helper provider uninstall flow.'
          }
        case 'config.get': {
          const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
          const configPath = path.join(plugin.root, 'config.json')
          if (!fs.existsSync(configPath)) {
            return { ok: true, data: {} }
          }
          const raw = fs.readFileSync(configPath, 'utf-8')
          return { ok: true, data: JSON.parse(raw) }
        }
        case 'config.set': {
          const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
          const payload = (_payload ?? {}) as Record<string, unknown>
          const configPath = path.join(plugin.root, 'config.json')
          fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), 'utf-8')
          return { ok: true }
        }
        default:
          throw new Error(`Unsupported plugin action: ${actionId}`)
      }
    } catch (error) {
      console.warn('[PluginHost] Plugin action failed:', {
        pluginId,
        actionId,
        error
      })
      return this.errorResult(error)
    }
  }

  private async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
    this.assertTrustedOfficialPlugin(plugin.manifest)
    this.assertPlatformSupported(plugin.manifest)
    this.applyDeclaredExecutablePermissions(plugin.manifest, plugin.root)

    await this.disableByOwner(pluginId)

    let runtime: PluginRuntimeStatus | undefined
    if (plugin.manifest.runtime) {
      runtime = await this.refreshRuntime(pluginId)
      this.upsertResource({
        pluginId,
        kind: 'runtime',
        key: runtime.runtimeId,
        payload: this.toJsonPayload(runtime),
        enabled: true
      })
    }

    this.registerSettingsContributions(plugin)

    if (runtime && runtime.state !== 'installed' && runtime.state !== 'running') {
      return
    }

    const registeredServerNames = await this.registerMcpServers(plugin, runtime)
    await this.registerSkills(plugin)
    this.registerToolPolicies(plugin)
    await this.startPluginMcpServersIfReady(pluginId, registeredServerNames)
  }

  private async disableByOwner(pluginId: string): Promise<void> {
    const servers = await this.configPresenter.getMcpServers()
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (this.isServerOwnedByPlugin(serverConfig, pluginId)) {
        try {
          if (await this.mcpPresenter.isServerRunning(serverName)) {
            await this.mcpPresenter.stopServer(serverName)
          }
        } catch (error) {
          console.warn('[PluginHost] Failed to stop plugin-owned MCP server:', {
            pluginId,
            serverName,
            error
          })
        }
        await this.configPresenter.removeMcpServer(serverName)
      }
    }

    await this.skillPresenter.unregisterPluginSkillsByOwner?.(pluginId)
    unregisterPluginToolPolicies(pluginId)
    this.closePluginSettingsWindow(pluginId)
    this.removeResourceRecordsByOwner(pluginId)
  }

  private isPluginOwnedServerConfig(serverConfig: MCPServerConfig): boolean {
    return Boolean(serverConfig.ownerPluginId || serverConfig.source === 'plugin')
  }

  private isServerOwnedByPlugin(serverConfig: MCPServerConfig, pluginId: string): boolean {
    return (
      serverConfig.ownerPluginId === pluginId ||
      (serverConfig.source === 'plugin' && serverConfig.sourceId === pluginId)
    )
  }

  private getServerOwnerPluginId(serverConfig: MCPServerConfig): string | undefined {
    return (
      serverConfig.ownerPluginId ||
      (serverConfig.source === 'plugin' ? serverConfig.sourceId : undefined)
    )
  }

  private async removePersistedInstallation(pluginId: string): Promise<void> {
    await this.disableByOwner(pluginId)
    this.removeInstallationRecord(pluginId)
    this.removeRuntimeRecordsByOwner(pluginId)
  }

  private async registerMcpServers(
    plugin: ResolvedOfficialPlugin,
    runtime?: PluginRuntimeStatus
  ): Promise<string[]> {
    const servers = plugin.manifest.mcpServers ?? []
    const registeredServerNames: string[] = []
    for (const server of servers) {
      const command = this.resolvePluginTemplate(server.command, plugin, runtime)
      const serverName = server.id
      const existingServers = await this.configPresenter.getMcpServers()
      const existing = existingServers[serverName]
      if (existing && existing.ownerPluginId !== plugin.manifest.id) {
        throw new Error(`MCP server "${serverName}" already exists and is not owned by this plugin`)
      }

      const serverEnv = this.resolvePluginTemplateRecord(server.env ?? {}, plugin, runtime)
      const config: MCPServerConfig = {
        type: 'stdio',
        command,
        args: server.args.map((arg) => this.resolvePluginTemplate(arg, plugin, runtime)),
        env: {
          ...serverEnv,
          DEEPCHAT_PLUGIN_ID: plugin.manifest.id
        },
        descriptions: server.displayName,
        icons: 'plugin',
        autoApprove: server.autoApprove,
        enabled: true,
        disable: false,
        source: 'plugin',
        sourceId: plugin.manifest.id,
        ownerPluginId: plugin.manifest.id
      }

      if (existing) {
        await this.configPresenter.updateMcpServer(serverName, config)
      } else {
        await this.configPresenter.addMcpServer(serverName, config)
      }

      this.upsertResource({
        pluginId: plugin.manifest.id,
        kind: 'mcpServer',
        key: serverName,
        payload: this.toJsonPayload(config),
        enabled: true
      })
      registeredServerNames.push(serverName)
    }
    return registeredServerNames
  }

  private async registerSkills(plugin: ResolvedOfficialPlugin): Promise<void> {
    for (const skill of plugin.manifest.skills ?? []) {
      const skillPath = this.resolvePluginRelativePath(plugin.root, skill.path)
      const skillRoot = path.dirname(skillPath)
      if (!fs.existsSync(skillPath)) {
        throw new Error(`Plugin skill file is missing: ${skill.path}`)
      }

      await this.skillPresenter.registerPluginSkill?.({
        ownerPluginId: plugin.manifest.id,
        id: skill.id,
        skillRoot,
        pluginRoot: plugin.root
      })
      this.upsertResource({
        pluginId: plugin.manifest.id,
        kind: 'skill',
        key: skill.id,
        payload: { path: skillPath },
        enabled: true
      })
    }
  }

  private registerSettingsContributions(plugin: ResolvedOfficialPlugin): void {
    for (const contribution of plugin.manifest.settingsContributions ?? []) {
      const entry = this.resolvePluginRelativePath(plugin.root, contribution.entry)
      const preloadTypes = this.resolvePluginRelativePath(plugin.root, contribution.preloadTypes)
      if (!fs.existsSync(entry)) {
        throw new Error(`Plugin settings entry is missing: ${contribution.entry}`)
      }
      if (!fs.existsSync(preloadTypes)) {
        throw new Error(`Plugin preload types are missing: ${contribution.preloadTypes}`)
      }
      const settings: PluginSettingsContribution = {
        id: contribution.id,
        ownerPluginId: plugin.manifest.id,
        title: contribution.title,
        placement: contribution.placement,
        entry,
        preloadTypes
      }
      this.upsertResource({
        pluginId: plugin.manifest.id,
        kind: 'settings',
        key: contribution.id,
        payload: this.toJsonPayload(settings),
        enabled: true
      })
    }
  }

  private async openPluginSettingsWindow(pluginId: string): Promise<void> {
    const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)

    const settings = this.getSettingsContribution(pluginId)
    if (!settings) {
      throw new Error(`Plugin ${pluginId} does not provide a settings contribution`)
    }

    const existing = this.settingsWindows.get(pluginId)
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return
    }

    const settingsWindow = new BrowserWindow({
      width: 760,
      height: 620,
      show: false,
      autoHideMenuBar: true,
      title: plugin.manifest.name,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/pluginSettings.mjs'),
        sandbox: false
      }
    })

    this.settingsWindows.set(pluginId, settingsWindow)
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    settingsWindow.on('ready-to-show', () => {
      if (!settingsWindow.isDestroyed()) {
        settingsWindow.show()
      }
    })
    settingsWindow.on('closed', () => {
      this.settingsWindows.delete(pluginId)
    })

    await settingsWindow.loadFile(settings.entry, {
      query: {
        pluginId
      }
    })
  }

  private closePluginSettingsWindow(pluginId: string): void {
    const settingsWindow = this.settingsWindows.get(pluginId)
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close()
    }
    this.settingsWindows.delete(pluginId)
  }

  private closeAllPluginSettingsWindows(): void {
    for (const pluginId of Array.from(this.settingsWindows.keys())) {
      this.closePluginSettingsWindow(pluginId)
    }
  }

  private registerToolPolicies(plugin: ResolvedOfficialPlugin): void {
    for (const policy of plugin.manifest.toolPolicies ?? []) {
      registerPluginToolPolicy({
        pluginId: plugin.manifest.id,
        serverId: policy.serverId,
        tools: policy.tools,
        enabled: true
      })
      this.upsertResource({
        pluginId: plugin.manifest.id,
        kind: 'toolPolicy',
        key: policy.serverId,
        payload: this.toJsonPayload(policy.tools),
        enabled: true
      })
    }
  }

  private async refreshRuntime(pluginId: string): Promise<PluginRuntimeStatus> {
    const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
    const runtimeManifest = plugin.manifest.runtime
    if (!runtimeManifest) {
      throw new Error(`Plugin ${pluginId} does not declare a runtime`)
    }

    const status = await this.detectRuntime(runtimeManifest, plugin.root)
    this.upsertRuntimeRecord({
      pluginId,
      runtimeId: runtimeManifest.id,
      provider: runtimeManifest.install?.provider ?? plugin.manifest.publisher,
      command: status.command,
      helperAppPath: status.helperAppPath,
      version: status.version,
      installSource: runtimeManifest.install?.strategy,
      state: status.state,
      lastError: status.lastError,
      checkedAt: status.checkedAt ?? Date.now()
    })
    return status
  }

  private async detectRuntime(
    runtime: PluginRuntimeManifest,
    pluginRoot: string
  ): Promise<PluginRuntimeStatus> {
    const checkedAt = Date.now()
    for (const candidate of runtime.detect) {
      const command = this.resolveRuntimeCandidate(candidate, pluginRoot)
      if (!command) {
        continue
      }

      if (path.isAbsolute(command) && !fs.existsSync(command)) {
        continue
      }

      try {
        const { stdout } = await execFileAsync(command, ['--version'], {
          timeout: 5000,
          windowsHide: true
        })
        const helperAppPath = this.resolveHelperAppPath(command)
        return {
          runtimeId: runtime.id,
          displayName: runtime.displayName,
          state: 'installed',
          command,
          helperAppPath,
          version: stdout.trim() || undefined,
          checkedAt
        }
      } catch (error) {
        if (path.isAbsolute(command)) {
          const helperAppPath = this.resolveHelperAppPath(command)
          return {
            runtimeId: runtime.id,
            displayName: runtime.displayName,
            state: 'error',
            command,
            helperAppPath,
            lastError: error instanceof Error ? error.message : String(error),
            checkedAt
          }
        }
      }
    }

    return {
      runtimeId: runtime.id,
      displayName: runtime.displayName,
      state: 'missing',
      checkedAt
    }
  }

  private async checkRuntimePermissions(pluginId: string): Promise<RuntimePermissionCheckResult> {
    const runtime = await this.refreshRuntime(pluginId)
    if (!runtime.command) {
      console.warn('[PluginHost] Runtime permission check skipped because runtime is missing:', {
        pluginId,
        runtimeId: runtime.runtimeId,
        state: runtime.state,
        lastError: runtime.lastError
      })
      return {
        platform: this.platform,
        accessibility: 'unknown',
        screenRecording: 'unknown',
        error: runtime.lastError || 'Runtime is missing'
      }
    }

    return await this.runRuntimePermissionTool(pluginId, runtime.command)
  }

  private async runRuntimePermissionTool(
    pluginId: string,
    command: string
  ): Promise<RuntimePermissionCheckResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, this.runtimePermissionToolArgs(), {
        timeout: 10000,
        windowsHide: true
      })
      return this.parseRuntimePermissionToolResult(command, stdout, stderr)
    } catch (error) {
      console.warn('[PluginHost] Runtime permission fallback failed:', {
        pluginId,
        command,
        error
      })
      const stdout = this.extractRawExecOutput(error, 'stdout')
      const stderr = this.extractRawExecOutput(error, 'stderr')
      const parsed = this.parseRuntimePermissionToolResult(command, stdout, stderr)
      if (this.hasPermissionSignal(parsed)) {
        parsed.error = `Permission check returned a non-zero status. ${this.describeExecError(error)}`
        return parsed
      }
      return {
        platform: this.platform,
        accessibility: 'unknown',
        screenRecording: 'unknown',
        command,
        error: `Permission check failed. ${this.describeExecError(error)}`,
        stdout: this.extractExecOutput(error, 'stdout'),
        stderr: this.extractExecOutput(error, 'stderr')
      }
    }
  }

  private runtimePermissionToolArgs(): string[] {
    return ['check_permissions', JSON.stringify({ prompt: false })]
  }

  private parseRuntimePermissionToolResult(
    command: string,
    stdout: string,
    stderr: string
  ): RuntimePermissionCheckResult {
    const parsed =
      this.parsePermissionJson(stdout) ?? this.parsePermissionJson(`${stdout}\n${stderr}`)
    const result: RuntimePermissionCheckResult = {
      platform: this.platform,
      accessibility: 'unknown',
      screenRecording: 'unknown',
      command,
      stdout: this.truncateOutput(stdout),
      stderr: this.truncateOutput(stderr)
    }

    if (this.platform === 'win32' && parsed) {
      result.uia = this.toPermissionState(parsed.uia)
      result.postMessage = this.toPermissionState(parsed.post_message ?? parsed.postMessage)
      result.diagnostics = this.toRuntimePermissionDiagnostics(parsed)
      return result
    }

    const output = `${stdout}\n${stderr}`
    result.accessibility = this.parsePermissionState(output, 'Accessibility')
    result.screenRecording = this.parsePermissionState(output, 'Screen Recording')

    if (this.platform === 'linux' && parsed) {
      result.diagnostics = this.toRuntimePermissionDiagnostics(parsed)
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        result.error = parsed.error.trim()
      }
    }

    return result
  }

  private hasPermissionSignal(result: RuntimePermissionCheckResult): boolean {
    return (
      result.accessibility !== 'unknown' ||
      result.screenRecording !== 'unknown' ||
      result.uia !== undefined ||
      result.postMessage !== undefined
    )
  }

  private parsePermissionJson(output: string): Record<string, unknown> | undefined {
    const trimmed = output.trim()
    if (!trimmed) {
      return undefined
    }
    try {
      const parsed = JSON.parse(trimmed)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
  }

  private toRuntimePermissionDiagnostics(
    value: Record<string, unknown>
  ): Record<string, string | number | boolean | null> {
    const diagnostics: Record<string, string | number | boolean | null> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean' ||
        entry === null
      ) {
        diagnostics[key] = entry
      }
    }
    return diagnostics
  }

  private toPermissionState(value: unknown): RuntimePermissionState {
    if (value === true) {
      return 'granted'
    }
    if (value === false) {
      return 'missing'
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['granted', 'ok', 'true', 'available', 'enabled', 'yes'].includes(normalized)) {
        return 'granted'
      }
      if (
        ['missing', 'denied', 'deny', 'false', 'unavailable', 'disabled', 'no'].includes(normalized)
      ) {
        return 'missing'
      }
    }
    return 'unknown'
  }

  private describeError(error: unknown): string {
    return this.sanitizePermissionError(error instanceof Error ? error.message : String(error))
  }

  private describeExecError(error: unknown): string {
    const message = this.describeError(error)
    const stdout = this.extractExecOutput(error, 'stdout')
    const stderr = this.extractExecOutput(error, 'stderr')
    const parts = [message]
    if (stdout) {
      parts.push(`stdout: ${stdout}`)
    }
    if (stderr) {
      parts.push(`stderr: ${stderr}`)
    }
    return parts.join(' | ')
  }

  private extractExecOutput(error: unknown, key: 'stdout' | 'stderr'): string | undefined {
    const value = this.extractRawExecOutput(error, key)
    if (!value.trim()) {
      return undefined
    }
    return this.truncateOutput(value)
  }

  private extractRawExecOutput(error: unknown, key: 'stdout' | 'stderr'): string {
    if (!error || typeof error !== 'object') {
      return ''
    }
    const value = (error as { stdout?: unknown; stderr?: unknown })[key]
    if (typeof value !== 'string' || !value.trim()) {
      return ''
    }
    return this.sanitizePermissionError(value)
  }

  private truncateOutput(value: string): string {
    const normalized = this.sanitizePermissionError(value).trim()
    return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized
  }

  private sanitizePermissionError(value: string): string {
    return value.replace(/\s*hint:\s*PowerShell 5\.1[\s\S]*?(?=(?:\sFallback:|$))/i, ' ').trim()
  }

  private parsePermissionState(output: string, label: string): 'granted' | 'missing' | 'unknown' {
    const line = output
      .split(/\r?\n/)
      .find((candidate) => candidate.toLowerCase().includes(label.toLowerCase()))
    if (!line) {
      return 'unknown'
    }
    if (/not granted|missing|denied/i.test(line)) {
      return 'missing'
    }
    if (/granted/i.test(line)) {
      return 'granted'
    }
    return 'unknown'
  }

  private async openRuntimeGuide(pluginId: string): Promise<void> {
    const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
    let helperOpenError: string | undefined

    if (this.platform === 'darwin' && plugin.manifest.runtime) {
      try {
        const runtime = await this.refreshRuntime(pluginId)
        if (runtime.helperAppPath) {
          const openError = await shell.openPath(runtime.helperAppPath)
          if (!openError) {
            return
          }
          helperOpenError = openError
          console.warn('[PluginHost] Runtime helper permission guide failed to open:', {
            pluginId,
            helperAppPath: runtime.helperAppPath,
            error: openError
          })
        }
      } catch (error) {
        helperOpenError = this.describeError(error)
        console.warn('[PluginHost] Runtime helper permission guide unavailable:', {
          pluginId,
          error
        })
      }
    }

    const guideUrl = plugin.manifest.runtime?.install?.guideUrl?.trim()
    if (!guideUrl) {
      if (helperOpenError) {
        throw new Error(
          `Failed to open runtime helper and plugin ${pluginId} does not declare a runtime guide URL. Helper: ${helperOpenError}`
        )
      }
      throw new Error(`Plugin ${pluginId} does not declare a runtime guide URL`)
    }
    await shell.openExternal(guideUrl)
  }

  private async loadOfficialPlugins(): Promise<void> {
    this.officialPlugins.clear()
    const plugins = [
      ...this.resolveOfficialPluginPackages(),
      ...this.resolveOfficialPluginDirectories()
    ]
    const usablePluginIds = new Set<string>()

    for (const plugin of plugins) {
      if (!this.isPluginPlatformSupported(plugin.manifest)) {
        continue
      }
      try {
        this.assertTrustedOfficialPlugin(plugin.manifest)
        usablePluginIds.add(plugin.manifest.id)
      } catch {
        // The main discovery pass logs untrusted plugin details and performs cleanup.
      }
    }

    for (const plugin of plugins) {
      if (this.officialPlugins.has(plugin.manifest.id)) {
        continue
      }
      if (!this.isPluginPlatformSupported(plugin.manifest)) {
        console.info(`[PluginHost] Skipping plugin ${plugin.manifest.id}: platform not supported`)
        if (!usablePluginIds.has(plugin.manifest.id)) {
          await this.removePersistedInstallation(plugin.manifest.id)
        }
        continue
      }
      try {
        this.assertTrustedOfficialPlugin(plugin.manifest)
      } catch (error) {
        console.warn(`[PluginHost] Skipping untrusted plugin ${plugin.manifest.id}:`, error)
        if (!usablePluginIds.has(plugin.manifest.id)) {
          await this.removePersistedInstallation(plugin.manifest.id)
        }
        continue
      }
      console.info(`[PluginHost] Discovered plugin: ${plugin.manifest.id} at ${plugin.root}`)
      this.officialPlugins.set(plugin.manifest.id, plugin)
    }
  }

  private resolveOfficialPluginDirectories(): ResolvedOfficialPlugin[] {
    const sourceRoots = this.isPackaged
      ? [this.getPluginInstallRoot()]
      : [
          path.join(process.cwd(), 'plugins'),
          path.join(this.appPath, 'plugins'),
          this.getPluginInstallRoot()
        ]
    const pluginRoots = new Set<string>()

    for (const sourceRoot of sourceRoots) {
      if (!sourceRoot || !fs.existsSync(sourceRoot)) {
        continue
      }

      if (fs.existsSync(path.join(sourceRoot, 'plugin.json'))) {
        pluginRoots.add(sourceRoot)
        continue
      }

      for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue
        }
        const candidate = path.join(sourceRoot, entry.name)
        if (fs.existsSync(path.join(candidate, 'plugin.json'))) {
          pluginRoots.add(candidate)
        }
      }
    }

    return Array.from(pluginRoots).map((root) => ({
      manifest: this.readManifest(path.join(root, 'plugin.json')),
      root,
      sourcePath: root,
      sourceType: 'directory'
    }))
  }

  private resolveOfficialPluginPackages(): ResolvedOfficialPlugin[] {
    const resourceRoots = this.resourcesPath
      ? [
          path.join(this.resourcesPath, 'app.asar.unpacked', 'plugins'),
          path.join(this.resourcesPath, 'plugins')
        ]
      : []
    const packageRoots = this.isPackaged
      ? resourceRoots
      : [
          path.join(process.cwd(), 'build', 'bundled-plugins'),
          path.join(this.appPath, 'build', 'bundled-plugins'),
          path.join(this.appPath, 'plugins'),
          ...resourceRoots
        ]
    const packagePaths = new Set<string>()

    for (const packageRoot of packageRoots) {
      if (!packageRoot || !fs.existsSync(packageRoot)) {
        continue
      }

      for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(PLUGIN_PACKAGE_EXTENSION)) {
          packagePaths.add(path.join(packageRoot, entry.name))
        }
      }
    }

    return Array.from(packagePaths).map((packagePath) => {
      const manifest = this.readPackageManifest(packagePath)
      return {
        manifest,
        root: packagePath,
        sourcePath: packagePath,
        sourceType: 'package'
      }
    })
  }

  private readManifest(manifestPath: string): DeepChatPluginManifest {
    const parsed = this.hydrateManifestPlaceholders(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as DeepChatPluginManifest
    )
    if (!parsed.id || !parsed.name || !parsed.version || !parsed.source) {
      throw new Error(`Invalid plugin manifest: ${manifestPath}`)
    }
    return parsed
  }

  private readPackageManifest(packagePath: string): DeepChatPluginManifest {
    const files = this.readPluginPackage(packagePath)
    const manifestFile = files['plugin.json']
    if (!manifestFile) {
      throw new Error(`Plugin package is missing plugin.json: ${packagePath}`)
    }
    const manifest = this.hydrateManifestPlaceholders(
      JSON.parse(Buffer.from(manifestFile).toString('utf8')) as DeepChatPluginManifest
    )
    if (!manifest.id || !manifest.name || !manifest.version || !manifest.source) {
      throw new Error(`Invalid plugin package manifest: ${packagePath}`)
    }
    return manifest
  }

  private readPluginPackage(packagePath: string): Record<string, Uint8Array> {
    const files = unzipSync(new Uint8Array(fs.readFileSync(packagePath)))
    this.verifyPackageChecksums(packagePath, files)
    return files
  }

  private verifyPackageChecksums(packagePath: string, files: Record<string, Uint8Array>): void {
    const checksumFile = files['checksums.json']
    if (!checksumFile) {
      throw new Error(`Plugin package is missing checksums.json: ${packagePath}`)
    }

    const checksums = JSON.parse(Buffer.from(checksumFile).toString('utf8')) as Record<
      string,
      string
    >
    for (const [relativePath, expectedHash] of Object.entries(checksums)) {
      this.assertSafeRelativePath(relativePath, 'package checksum path')
      const content = files[relativePath]
      if (!content) {
        throw new Error(`Plugin package checksum references a missing file: ${relativePath}`)
      }
      const actualHash = createHash('sha256').update(Buffer.from(content)).digest('hex')
      if (actualHash !== expectedHash) {
        throw new Error(`Plugin package checksum mismatch: ${relativePath}`)
      }
    }

    for (const relativePath of Object.keys(files)) {
      if (relativePath === 'checksums.json' || relativePath.endsWith('/')) {
        continue
      }
      this.assertSafeRelativePath(relativePath, 'package file path')
      if (!checksums[relativePath]) {
        throw new Error(`Plugin package file is missing checksum: ${relativePath}`)
      }
    }
  }

  private assertTrustedOfficialPlugin(manifest: DeepChatPluginManifest): void {
    if (manifest.source.type !== OFFICIAL_PLUGIN_SOURCE) {
      throw new Error(`Plugin ${manifest.id} is not from the official source`)
    }
    if (
      !manifest.source.url.startsWith(GITHUB_RELEASE_DOWNLOAD_PREFIX) &&
      !manifest.source.url.startsWith('${github.release.download}/')
    ) {
      throw new Error(`Plugin ${manifest.id} has an untrusted source URL`)
    }
    if (manifest.source.publisher !== manifest.publisher) {
      throw new Error(`Plugin ${manifest.id} publisher does not match source metadata`)
    }
  }

  private ensureOfficialPluginInstallation(
    plugin: ResolvedOfficialPlugin
  ): PluginInstallationRecord {
    const pluginId = plugin.manifest.id
    const existing = this.getInstallation(pluginId)
    const existingManifestPath = existing?.path
      ? path.join(existing.path, 'plugin.json')
      : undefined
    if (existing && existingManifestPath && fs.existsSync(existingManifestPath)) {
      const existingManifest = this.readManifest(existingManifestPath)
      const shouldRefreshDirectoryInstallation =
        plugin.sourceType === 'directory' &&
        path.resolve(plugin.sourcePath) !== path.resolve(existing.path)
      if (
        !shouldRefreshDirectoryInstallation &&
        existingManifest.version === plugin.manifest.version &&
        this.arePluginManifestsEquivalent(existingManifest, plugin.manifest)
      ) {
        this.assertTrustedOfficialPlugin(existingManifest)
        this.assertPlatformSupported(existingManifest)
        this.applyDeclaredExecutablePermissions(existingManifest, existing.path)
        return existing
      }
    }

    const installRoot = this.installResolvedPlugin(plugin)
    const installedManifest = this.readManifest(path.join(installRoot, 'plugin.json'))
    this.assertTrustedOfficialPlugin(installedManifest)
    this.assertPlatformSupported(installedManifest)
    this.applyDeclaredExecutablePermissions(installedManifest, installRoot)

    const now = Date.now()
    const next: PluginInstallationRecord = {
      pluginId,
      version: installedManifest.version,
      path: installRoot,
      enabled: existing?.enabled ?? false,
      trusted: true,
      source: OFFICIAL_PLUGIN_SOURCE,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now
    }
    this.upsertInstallation(next)
    this.officialPlugins.set(pluginId, {
      manifest: installedManifest,
      root: installRoot,
      sourcePath: installRoot,
      sourceType: 'directory'
    })
    return next
  }

  private assertPlatformSupported(manifest: DeepChatPluginManifest): void {
    if (!this.isPluginPlatformSupported(manifest)) {
      throw new Error(`Plugin ${manifest.id} does not support ${this.platform}/${this.arch}`)
    }
  }

  private isPluginPlatformSupported(manifest: DeepChatPluginManifest): boolean {
    const platforms = new Set(manifest.engines.platforms.map((platform) => platform.toLowerCase()))
    const aliases = this.platform === 'darwin' ? ['darwin', 'macos', 'mac'] : [this.platform]
    const targets = manifest.engines.targets?.map((target) => target.toLowerCase()) ?? []
    if (targets.length > 0) {
      return aliases.some((platform) => targets.includes(`${platform}/${this.arch}`))
    }
    return aliases.some((platform) => platforms.has(platform))
  }

  private installResolvedPlugin(plugin: ResolvedOfficialPlugin): string {
    const installRoot = this.getInstalledPluginRoot(plugin.manifest.id)
    if (plugin.sourceType === 'directory' && path.resolve(plugin.sourcePath) === installRoot) {
      return installRoot
    }

    const preservedConfig = this.readInstalledPluginConfig(installRoot)
    fs.rmSync(installRoot, { recursive: true, force: true })
    fs.mkdirSync(installRoot, { recursive: true })

    if (plugin.sourceType === 'package') {
      this.extractPluginPackage(plugin.sourcePath, installRoot)
    } else {
      this.copyPluginDirectory(plugin.sourcePath, installRoot)
    }

    this.writeInstalledPluginConfig(installRoot, preservedConfig)

    return installRoot
  }

  private arePluginManifestsEquivalent(
    left: DeepChatPluginManifest,
    right: DeepChatPluginManifest
  ): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  private readInstalledPluginConfig(installRoot: string): string | undefined {
    const configPath = path.join(installRoot, 'config.json')
    if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
      return undefined
    }
    return fs.readFileSync(configPath, 'utf8')
  }

  private writeInstalledPluginConfig(installRoot: string, config: string | undefined): void {
    if (config === undefined) {
      return
    }
    fs.writeFileSync(path.join(installRoot, 'config.json'), config, 'utf8')
  }

  private extractPluginPackage(packagePath: string, installRoot: string): void {
    const files = this.readPluginPackage(packagePath)
    for (const [relativePath, content] of Object.entries(files)) {
      if (relativePath.endsWith('/')) {
        continue
      }
      const outputPath = this.resolvePluginRelativePath(installRoot, relativePath)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, Buffer.from(content))
    }
  }

  private applyDeclaredExecutablePermissions(
    manifest: DeepChatPluginManifest,
    pluginRoot: string
  ): void {
    for (const candidate of manifest.runtime?.detect ?? []) {
      if (!candidate.startsWith('plugin:')) {
        continue
      }
      const executablePath = this.resolvePluginRelativePath(
        pluginRoot,
        candidate.slice('plugin:'.length)
      )
      if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
        continue
      }
      fs.chmodSync(executablePath, 0o755)
    }
  }

  private copyPluginDirectory(sourceRoot: string, installRoot: string): void {
    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        entry.name === '.DS_Store' ||
        entry.name === 'vendor' ||
        entry.name === 'build' ||
        entry.name === 'node_modules' ||
        entry.name === '.build'
      ) {
        continue
      }

      const sourcePath = path.join(sourceRoot, entry.name)
      const targetPath = path.join(installRoot, entry.name)
      if (entry.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true })
        this.copyPluginDirectory(sourcePath, targetPath)
        continue
      }
      if (entry.isFile()) {
        fs.copyFileSync(sourcePath, targetPath)
      }
    }
  }

  private getPluginInstallRoot(): string {
    return path.join(app.getPath('userData'), 'plugins')
  }

  private getInstalledPluginRoot(pluginId: string): string {
    return path.join(this.getPluginInstallRoot(), this.normalizePluginDirectoryName(pluginId))
  }

  private normalizePluginDirectoryName(pluginId: string): string {
    return pluginId.replace(/[^a-zA-Z0-9._-]/g, '-')
  }

  private async repairMissingPluginResources(): Promise<void> {
    const installedIds = new Set(
      this.getInstallations().map((installation) => installation.pluginId)
    )
    const resources = this.getResources()
    for (const resource of resources) {
      if (!installedIds.has(resource.pluginId)) {
        await this.disableByOwner(resource.pluginId)
      }
    }
  }

  private async buildPluginListItem(pluginId: string): Promise<PluginListItem> {
    const plugin = this.getOfficialPluginOrThrow(pluginId)
    const installation = this.getInstallation(pluginId)
    const runtimeRecord = this.getRuntimeRecord(pluginId, plugin.manifest.runtime?.id)
    const settings = this.getSettingsContribution(pluginId)
    const runtime = plugin.manifest.runtime
      ? {
          runtimeId: plugin.manifest.runtime.id,
          displayName: plugin.manifest.runtime.displayName,
          state: runtimeRecord?.state ?? 'missing',
          command: runtimeRecord?.command,
          helperAppPath: runtimeRecord?.helperAppPath,
          version: runtimeRecord?.version,
          lastError: runtimeRecord?.lastError,
          checkedAt: runtimeRecord?.checkedAt
        }
      : undefined

    return {
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      publisher: plugin.manifest.publisher,
      installed: true,
      enabled: Boolean(installation?.enabled),
      trusted: true,
      trustState: 'trusted',
      official: true,
      capabilities: plugin.manifest.capabilities,
      runtime,
      mcpServers: await this.getPluginMcpRuntimeStatuses(plugin.manifest),
      settings
    }
  }

  private getOfficialPluginOrThrow(pluginId: string): ResolvedOfficialPlugin {
    const plugin = this.officialPlugins.get(pluginId)
    if (!plugin) {
      throw new Error(`Official plugin ${pluginId} is not available`)
    }
    return plugin
  }

  private getInstalledOrOfficialPluginOrThrow(pluginId: string): ResolvedOfficialPlugin {
    const official = this.officialPlugins.get(pluginId)
    if (official) {
      const installation = this.ensureOfficialPluginInstallation(official)
      const manifestPath = path.join(installation.path, 'plugin.json')
      if (fs.existsSync(manifestPath)) {
        return {
          manifest: this.readManifest(manifestPath),
          root: installation.path,
          sourcePath: installation.path,
          sourceType: 'directory'
        }
      }
    }

    const installation = this.getInstallation(pluginId)
    if (installation?.path && fs.existsSync(path.join(installation.path, 'plugin.json'))) {
      return {
        manifest: this.readManifest(path.join(installation.path, 'plugin.json')),
        root: installation.path,
        sourcePath: installation.path,
        sourceType: 'directory'
      }
    }

    return this.getOfficialPluginOrThrow(pluginId)
  }

  private getInstallations(): PluginInstallationRecord[] {
    return this.store.get('installations') ?? []
  }

  private getInstallation(pluginId: string): PluginInstallationRecord | undefined {
    return this.getInstallations().find((installation) => installation.pluginId === pluginId)
  }

  private removeInstallationRecord(pluginId: string): void {
    this.store.set(
      'installations',
      this.getInstallations().filter((installation) => installation.pluginId !== pluginId)
    )
  }

  private upsertInstallation(record: PluginInstallationRecord): void {
    this.store.set('installations', [
      ...this.getInstallations().filter((item) => item.pluginId !== record.pluginId),
      record
    ])
  }

  private getResources(): PluginResourceRecord[] {
    return this.store.get('resources') ?? []
  }

  private upsertResource(input: Omit<PluginResourceRecord, 'createdAt' | 'updatedAt'>): void {
    const now = Date.now()
    const existing = this.getResources().find(
      (resource) =>
        resource.pluginId === input.pluginId &&
        resource.kind === input.kind &&
        resource.key === input.key
    )
    const next: PluginResourceRecord = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    this.store.set('resources', [
      ...this.getResources().filter(
        (resource) =>
          !(
            resource.pluginId === input.pluginId &&
            resource.kind === input.kind &&
            resource.key === input.key
          )
      ),
      next
    ])
  }

  private removeResourceRecordsByOwner(pluginId: string): void {
    this.store.set(
      'resources',
      this.getResources().filter((resource) => resource.pluginId !== pluginId)
    )
  }

  private getRuntimeRecord(
    pluginId: string,
    runtimeId?: string
  ): RuntimeDependencyRecord | undefined {
    if (!runtimeId) {
      return undefined
    }
    return (this.store.get('runtimes') ?? []).find(
      (runtime) => runtime.pluginId === pluginId && runtime.runtimeId === runtimeId
    )
  }

  private removeRuntimeRecordsByOwner(pluginId: string): void {
    this.store.set(
      'runtimes',
      (this.store.get('runtimes') ?? []).filter((runtime) => runtime.pluginId !== pluginId)
    )
  }

  private upsertRuntimeRecord(record: RuntimeDependencyRecord): void {
    this.store.set('runtimes', [
      ...(this.store.get('runtimes') ?? []).filter(
        (runtime) =>
          !(runtime.pluginId === record.pluginId && runtime.runtimeId === record.runtimeId)
      ),
      record
    ])
  }

  private resolveManifestSettingsContribution(
    plugin: ResolvedOfficialPlugin,
    pluginRoot: string
  ): PluginSettingsContribution | undefined {
    const contribution = plugin.manifest.settingsContributions?.[0]
    if (!contribution) {
      return undefined
    }

    const entry = this.resolvePluginRelativePath(pluginRoot, contribution.entry)
    const preloadTypes = this.resolvePluginRelativePath(pluginRoot, contribution.preloadTypes)
    if (!fs.existsSync(entry) || !fs.existsSync(preloadTypes)) {
      return undefined
    }

    return {
      id: contribution.id,
      ownerPluginId: plugin.manifest.id,
      title: contribution.title,
      placement: contribution.placement,
      entry,
      preloadTypes
    }
  }

  private isSettingsContributionAvailable(settings?: PluginSettingsContribution): boolean {
    try {
      const entry = settings?.entry
      const preloadTypes = settings?.preloadTypes
      if (!entry || !preloadTypes) {
        return false
      }
      return fs.existsSync(entry) && fs.existsSync(preloadTypes)
    } catch {
      return false
    }
  }

  private getSettingsContribution(pluginId: string): PluginSettingsContribution | undefined {
    const record = this.getResources().find(
      (resource) =>
        resource.pluginId === pluginId && resource.kind === 'settings' && resource.enabled
    )
    const stored = record?.payload as unknown as PluginSettingsContribution | undefined
    if (this.isSettingsContributionAvailable(stored)) {
      return stored
    }

    const plugin = this.getOfficialPluginOrThrow(pluginId)
    const installation = this.getInstallation(pluginId)
    if (installation?.path) {
      const installedSettings = this.resolveManifestSettingsContribution(plugin, installation.path)
      if (installedSettings) {
        return installedSettings
      }
    }

    if (plugin.sourceType === 'package') {
      const ensuredInstallation = this.ensureOfficialPluginInstallation(plugin)
      return this.resolveManifestSettingsContribution(plugin, ensuredInstallation.path)
    }

    return this.resolveManifestSettingsContribution(plugin, plugin.root)
  }

  private resolvePluginTemplate(
    template: string,
    plugin: ResolvedOfficialPlugin,
    runtime?: PluginRuntimeStatus
  ): string {
    let result = template
      .replaceAll('${plugin.root}', plugin.root)
      .replaceAll('${plugin.id}', plugin.manifest.id)
    if (runtime) {
      result = result
        .replaceAll(`\${runtime.${runtime.runtimeId}.command}`, runtime.command ?? '')
        .replaceAll(`\${runtime.${runtime.runtimeId}.helperAppPath}`, runtime.helperAppPath ?? '')
    }
    return result
  }

  private resolveRuntimeCandidate(candidate: string, pluginRoot: string): string | null {
    candidate = candidate.replaceAll('${arch}', this.arch)
    if (candidate.startsWith('app-helper:')) {
      return this.resolveAppHelperRelativePath(candidate.slice('app-helper:'.length))
    }
    if (candidate.startsWith('plugin:')) {
      return this.resolvePluginRelativePath(pluginRoot, candidate.slice('plugin:'.length))
    }
    if (candidate.startsWith('PATH:')) {
      return candidate.slice('PATH:'.length)
    }
    if (candidate.startsWith('~/')) {
      return path.join(app.getPath('home'), candidate.slice(2))
    }
    return candidate
  }

  private resolveAppHelperRelativePath(relativePath: string): string | null {
    if (this.platform !== 'darwin' || !this.isPackaged || !this.resourcesPath) {
      return null
    }

    const normalized = this.assertSafeRelativePath(relativePath, 'app helper path')
    const helperRoot = path.resolve(path.dirname(this.resourcesPath), 'Helpers')
    const resolved = path.resolve(helperRoot, ...normalized.split('/').filter(Boolean))
    const relativeToHelperRoot = path.relative(helperRoot, resolved)
    if (relativeToHelperRoot.startsWith('..') || path.isAbsolute(relativeToHelperRoot)) {
      throw new Error(`App helper path escapes helper root: ${relativePath}`)
    }
    return resolved
  }

  private resolvePluginTemplateRecord(
    input: Record<string, string>,
    plugin: ResolvedOfficialPlugin,
    runtime?: PluginRuntimeStatus
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        this.resolvePluginTemplate(value, plugin, runtime)
      ])
    )
  }

  private resolveHelperAppPath(command: string): string | undefined {
    if (!path.isAbsolute(command)) {
      return undefined
    }

    let current = path.dirname(path.normalize(command))
    while (current && current !== path.dirname(current)) {
      if (current.endsWith('.app')) {
        return current
      }
      current = path.dirname(current)
    }
    return undefined
  }

  private async startPluginMcpServersIfReady(
    pluginId: string,
    serverNames: string[]
  ): Promise<void> {
    if (serverNames.length === 0 || !this.mcpPresenter.isReady()) {
      return
    }

    for (const serverName of serverNames) {
      try {
        if (!(await this.mcpPresenter.isServerRunning(serverName))) {
          await this.mcpPresenter.startServer(serverName)
        }
      } catch (error) {
        console.warn('[PluginHost] Failed to auto-start plugin MCP server:', {
          pluginId,
          serverName,
          error
        })
      }
    }
  }

  private async getPluginMcpRuntimeStatuses(
    manifest: DeepChatPluginManifest
  ): Promise<NonNullable<PluginListItem['mcpServers']>> {
    const servers = await this.configPresenter.getMcpServers()
    const statuses: NonNullable<PluginListItem['mcpServers']> = []
    for (const server of manifest.mcpServers ?? []) {
      const serverConfig = servers[server.id]
      statuses.push({
        serverId: server.id,
        enabled: Boolean(serverConfig?.enabled),
        running: await this.mcpPresenter.isServerRunning(server.id),
        lastError: serverConfig?.enabled
          ? this.mcpPresenter.getServerLastError?.(server.id)
          : undefined
      })
    }
    return statuses
  }

  private hydrateManifestPlaceholders(manifest: DeepChatPluginManifest): DeepChatPluginManifest {
    return JSON.parse(
      JSON.stringify(manifest)
        .replaceAll('${app.version}', app.getVersion())
        .replaceAll('${arch}', this.arch)
        .replaceAll('${target.platform}', this.platform)
        .replaceAll(
          '${github.release.download}',
          `${GITHUB_RELEASE_DOWNLOAD_PREFIX}${this.getReleaseTag()}`
        )
    ) as DeepChatPluginManifest
  }

  private getReleaseTag(): string {
    const version = app.getVersion()
    return version.startsWith('v') ? version : `v${version}`
  }

  private assertSafeRelativePath(relativePath: string, label: string): string {
    const normalized = relativePath.replace(/\\/g, '/')
    if (
      !normalized ||
      normalized.startsWith('/') ||
      normalized.includes('..') ||
      /^[A-Za-z]:/.test(normalized)
    ) {
      throw new Error(`Unsafe ${label}: ${relativePath}`)
    }
    return normalized
  }

  private resolvePluginRelativePath(pluginRoot: string, relativePath: string): string {
    const normalized = this.assertSafeRelativePath(relativePath, 'plugin path')
    const resolved = path.resolve(pluginRoot, ...normalized.split('/').filter(Boolean))
    const relativeToRoot = path.relative(pluginRoot, resolved)
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new Error(`Plugin path escapes package root: ${relativePath}`)
    }
    return resolved
  }

  private toJsonPayload(value: unknown): PluginResourceRecord['payload'] {
    return JSON.parse(JSON.stringify(value)) as PluginResourceRecord['payload']
  }

  private errorResult(error: unknown): PluginActionResult {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
