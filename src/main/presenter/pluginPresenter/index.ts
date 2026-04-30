import { app, BrowserWindow, dialog, shell } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import ElectronStore from 'electron-store'
import { unzipSync } from 'fflate'
import { fetch } from 'undici'
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

const GITHUB_OWNER = 'ThinkInAIXYZ'
const GITHUB_REPO = 'deepchat'
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`
const GITHUB_RELEASE_DOWNLOAD_PREFIX = `${GITHUB_RELEASES_URL}/download/`
const PLUGIN_PACKAGE_EXTENSION = '.dcplugin'
const OFFICIAL_PLUGIN_CATALOG_PATH = path.join('resources', 'plugins', 'official-catalog.json')

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
  appPath?: string
}

type ResolvedOfficialPlugin = {
  manifest: DeepChatPluginManifest
  root: string
  sourcePath: string
  sourceType: 'directory' | 'package' | 'remote'
}

type OfficialPluginCatalogEntry = {
  assetBaseName?: string
  manifest: DeepChatPluginManifest
}

type RuntimePermissionState = 'granted' | 'missing' | 'unknown'

type RuntimePermissionCheckResult = {
  accessibility: RuntimePermissionState
  screenRecording: RuntimePermissionState
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
  private readonly appPath: string
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
    this.appPath = deps.appPath ?? app.getAppPath()
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

  async installOfficialPlugin(pluginId: string): Promise<PluginActionResult> {
    try {
      await this.loadOfficialPlugins()
      const plugin = this.getOfficialPluginOrThrow(pluginId)
      this.assertTrustedOfficialPlugin(plugin.manifest)
      this.assertPlatformSupported(plugin.manifest)
      return await this.installTrustedPlugin(plugin)
    } catch (error) {
      return this.errorResult(error)
    }
  }

  async installPluginFromFile(filePath?: string): Promise<PluginActionResult> {
    try {
      const packagePath = filePath ?? (await this.selectPluginPackageFile())
      if (!packagePath) {
        return { ok: true, data: { canceled: true } }
      }

      const plugin = this.resolvePackagePlugin(packagePath)
      this.assertTrustedOfficialPlugin(plugin.manifest)
      this.assertPlatformSupported(plugin.manifest)
      return await this.installTrustedPlugin(plugin)
    } catch (error) {
      return this.errorResult(error)
    }
  }

  async openOfficialPluginRelease(pluginId?: string): Promise<PluginActionResult> {
    try {
      await shell.openExternal(this.getOfficialPluginReleaseUrl(pluginId))
      return { ok: true }
    } catch (error) {
      return this.errorResult(error)
    }
  }

  async enablePlugin(pluginId: string): Promise<PluginActionResult> {
    try {
      const installation = this.getInstallation(pluginId)
      if (!installation) {
        throw new Error(`Install plugin ${pluginId} before enabling it`)
      }

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

  async deletePlugin(pluginId: string): Promise<PluginActionResult> {
    try {
      const installation = this.getInstallation(pluginId)
      await this.disableByOwner(pluginId)
      this.store.set(
        'installations',
        this.getInstallations().filter((installation) => installation.pluginId !== pluginId)
      )
      this.removeResourceRecordsByOwner(pluginId)
      this.removeRuntimeRecordsByOwner(pluginId)
      this.removeInstalledPluginFiles(installation?.path)
      this.officialPlugins.clear()
      await this.loadOfficialPlugins()
      if (!this.officialPlugins.has(pluginId)) {
        return { ok: true }
      }
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

    const runtime = await this.refreshRuntime(pluginId)
    this.upsertResource({
      pluginId,
      kind: 'runtime',
      key: runtime.runtimeId,
      payload: this.toJsonPayload(runtime),
      enabled: true
    })

    this.registerSettingsContributions(plugin)

    if (runtime.state !== 'installed' && runtime.state !== 'running') {
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
      if (serverConfig.ownerPluginId === pluginId) {
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

  private async registerMcpServers(
    plugin: ResolvedOfficialPlugin,
    runtime: PluginRuntimeStatus
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
    const installation = this.getInstallation(pluginId)
    if (!installation?.enabled) {
      throw new Error(`Plugin ${pluginId} is not enabled`)
    }

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
        accessibility: 'unknown',
        screenRecording: 'unknown',
        error: runtime.lastError || 'Runtime is missing'
      }
    }

    try {
      return await this.runRuntimePermissionProbe(pluginId, runtime.command)
    } catch (probeError) {
      console.warn('[PluginHost] Runtime permission probe failed, falling back to tool call:', {
        pluginId,
        command: runtime.command,
        error: probeError
      })
      return await this.runRuntimePermissionToolFallback(pluginId, runtime.command, probeError)
    }
  }

  private async runRuntimePermissionProbe(
    pluginId: string,
    command: string
  ): Promise<RuntimePermissionCheckResult> {
    const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'deepchat-cua-permissions-'))
    const outputPath = path.join(tempRoot, 'status.json')
    try {
      const { stdout, stderr } = await execFileAsync(
        command,
        ['deepchat-permission-probe', '--output', outputPath, '--prompt'],
        {
          timeout: 15000,
          windowsHide: true
        }
      )
      if (!fs.existsSync(outputPath)) {
        throw new Error('Permission probe did not write a status file')
      }

      const status = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as {
        accessibility?: unknown
        screen_recording?: unknown
        screenRecording?: unknown
      }
      const result: RuntimePermissionCheckResult = {
        accessibility: this.toPermissionState(status.accessibility),
        screenRecording: this.toPermissionState(status.screen_recording ?? status.screenRecording),
        command
      }
      if (stdout.trim()) {
        result.stdout = this.truncateOutput(stdout)
      }
      if (stderr.trim()) {
        result.stderr = this.truncateOutput(stderr)
      }
      console.info('[PluginHost] Runtime permission probe completed:', {
        pluginId,
        command,
        accessibility: result.accessibility,
        screenRecording: result.screenRecording
      })
      return result
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }

  private async runRuntimePermissionToolFallback(
    pluginId: string,
    command: string,
    probeError: unknown
  ): Promise<RuntimePermissionCheckResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, ['check_permissions'], {
        timeout: 10000,
        windowsHide: true
      })
      const output = `${stdout}\n${stderr}`
      return {
        accessibility: this.parsePermissionState(output, 'Accessibility'),
        screenRecording: this.parsePermissionState(output, 'Screen Recording'),
        command,
        stdout: this.truncateOutput(stdout),
        stderr: this.truncateOutput(stderr),
        error: `Permission probe failed; used fallback. ${this.describeError(probeError)}`
      }
    } catch (error) {
      console.warn('[PluginHost] Runtime permission fallback failed:', {
        pluginId,
        command,
        error
      })
      return {
        accessibility: 'unknown',
        screenRecording: 'unknown',
        command,
        error: `Permission check failed. Probe: ${this.describeError(probeError)}. Fallback: ${this.describeExecError(error)}`,
        stdout: this.extractExecOutput(error, 'stdout'),
        stderr: this.extractExecOutput(error, 'stderr')
      }
    }
  }

  private toPermissionState(value: unknown): RuntimePermissionState {
    if (value === true) {
      return 'granted'
    }
    if (value === false) {
      return 'missing'
    }
    return 'unknown'
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
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
    if (!error || typeof error !== 'object') {
      return undefined
    }
    const value = (error as { stdout?: unknown; stderr?: unknown })[key]
    if (typeof value !== 'string' || !value.trim()) {
      return undefined
    }
    return this.truncateOutput(value)
  }

  private truncateOutput(value: string): string {
    const normalized = value.trim()
    return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized
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
    const guideUrl = plugin.manifest.runtime?.install?.guideUrl?.trim()
    if (!guideUrl) {
      throw new Error(`Plugin ${pluginId} does not declare a runtime guide URL`)
    }
    await shell.openExternal(guideUrl)
  }

  private async loadOfficialPlugins(): Promise<void> {
    this.officialPlugins.clear()

    for (const plugin of [
      ...this.resolveOfficialPluginDirectories(),
      ...this.resolveOfficialPluginPackages(),
      ...this.resolveOfficialPluginCatalog()
    ]) {
      if (this.officialPlugins.has(plugin.manifest.id)) {
        continue
      }
      if (!this.isPluginPlatformSupported(plugin.manifest)) {
        continue
      }
      this.assertTrustedOfficialPlugin(plugin.manifest)
      this.officialPlugins.set(plugin.manifest.id, plugin)
    }
  }

  private resolveOfficialPluginDirectories(): ResolvedOfficialPlugin[] {
    const sourceRoots = [this.getPluginInstallRoot()]
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
    const packageRoots = [
      this.getPluginInstallRoot(),
      path.join(process.cwd(), 'dist', 'plugins'),
      path.join(this.appPath, 'plugins'),
      path.join(process.resourcesPath ?? '', 'app.asar.unpacked', 'plugins'),
      path.join(process.resourcesPath ?? '', 'plugins')
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

  private resolveOfficialPluginCatalog(): ResolvedOfficialPlugin[] {
    return this.readOfficialPluginCatalog().flatMap((entry) => {
      const manifest = this.hydrateCatalogManifest(entry)
      if (!this.isCatalogPlatformSupported(manifest)) {
        return []
      }
      return [
        {
          manifest,
          root: manifest.source.url,
          sourcePath: manifest.source.url,
          sourceType: 'remote' as const
        }
      ]
    })
  }

  private readOfficialPluginCatalog(): OfficialPluginCatalogEntry[] {
    const catalogPaths = [
      path.join(process.cwd(), OFFICIAL_PLUGIN_CATALOG_PATH),
      path.join(this.appPath, OFFICIAL_PLUGIN_CATALOG_PATH),
      path.join(process.resourcesPath ?? '', OFFICIAL_PLUGIN_CATALOG_PATH),
      path.join(process.resourcesPath ?? '', 'app.asar.unpacked', OFFICIAL_PLUGIN_CATALOG_PATH)
    ]

    for (const catalogPath of catalogPaths) {
      if (!catalogPath || !fs.existsSync(catalogPath)) {
        continue
      }
      const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
        plugins?: OfficialPluginCatalogEntry[]
      }
      return parsed.plugins ?? []
    }

    return []
  }

  private hydrateCatalogManifest(entry: OfficialPluginCatalogEntry): DeepChatPluginManifest {
    const version = app.getVersion()
    const manifest = this.hydrateManifestPlaceholders(entry.manifest)

    if (entry.assetBaseName) {
      manifest.source.url = `${this.getOfficialPluginReleaseDownloadBase()}/${this.getOfficialPluginAssetName(
        entry.assetBaseName,
        version
      )}`
    }

    return manifest
  }

  private isCatalogPlatformSupported(manifest: DeepChatPluginManifest): boolean {
    return this.isPluginPlatformSupported(manifest)
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

  private resolvePackagePlugin(packagePath: string): ResolvedOfficialPlugin {
    if (!packagePath.endsWith(PLUGIN_PACKAGE_EXTENSION)) {
      throw new Error(`Plugin package must use the ${PLUGIN_PACKAGE_EXTENSION} extension`)
    }
    const manifest = this.readPackageManifest(packagePath)
    return {
      manifest,
      root: packagePath,
      sourcePath: packagePath,
      sourceType: 'package'
    }
  }

  private async selectPluginPackageFile(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'DeepChat Plugin Packages', extensions: ['dcplugin'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
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

  private async installTrustedPlugin(plugin: ResolvedOfficialPlugin): Promise<PluginActionResult> {
    const installRoot = await this.installResolvedPlugin(plugin)
    const pluginId = plugin.manifest.id
    const installedManifest = this.readManifest(path.join(installRoot, 'plugin.json'))
    this.assertTrustedOfficialPlugin(installedManifest)
    this.assertPlatformSupported(installedManifest)
    this.applyDeclaredExecutablePermissions(installedManifest, installRoot)

    const now = Date.now()
    const existing = this.getInstallation(pluginId)
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
    return { ok: true, status: await this.buildPluginListItem(pluginId) }
  }

  private assertPlatformSupported(manifest: DeepChatPluginManifest): void {
    if (!this.isPluginPlatformSupported(manifest)) {
      throw new Error(`Plugin ${manifest.id} does not support ${this.platform}`)
    }
  }

  private isPluginPlatformSupported(manifest: DeepChatPluginManifest): boolean {
    const platforms = new Set(manifest.engines.platforms.map((platform) => platform.toLowerCase()))
    const aliases = this.platform === 'darwin' ? ['darwin', 'macos', 'mac'] : [this.platform]
    return aliases.some((platform) => platforms.has(platform))
  }

  private async installResolvedPlugin(plugin: ResolvedOfficialPlugin): Promise<string> {
    const installRoot = this.getInstalledPluginRoot(plugin.manifest.id)
    if (plugin.sourceType === 'directory' && path.resolve(plugin.sourcePath) === installRoot) {
      return installRoot
    }

    fs.rmSync(installRoot, { recursive: true, force: true })
    fs.mkdirSync(installRoot, { recursive: true })

    if (plugin.sourceType === 'remote') {
      const packagePath = await this.downloadOfficialPluginPackage(plugin)
      this.extractPluginPackage(packagePath, installRoot)
      fs.rmSync(path.dirname(packagePath), { recursive: true, force: true })
    } else if (plugin.sourceType === 'package') {
      this.extractPluginPackage(plugin.sourcePath, installRoot)
    } else {
      this.copyPluginDirectory(plugin.sourcePath, installRoot)
    }

    return installRoot
  }

  private async downloadOfficialPluginPackage(plugin: ResolvedOfficialPlugin): Promise<string> {
    const url = plugin.manifest.source.url
    const response = await fetch(url, { redirect: 'follow' })
    if (response.status === 404) {
      await shell.openExternal(this.getOfficialPluginReleaseUrl(plugin.manifest.id))
      throw new Error(
        `Official plugin package was not found for this DeepChat release. Opened GitHub Releases.`
      )
    }
    if (!response.ok) {
      throw new Error(`Official plugin download failed: HTTP ${response.status}`)
    }

    const content = Buffer.from(await response.arrayBuffer())
    if (content.length === 0) {
      throw new Error('Official plugin download returned an empty package')
    }

    const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'deepchat-plugin-'))
    const packagePath = path.join(tempRoot, path.basename(new URL(url).pathname))
    fs.writeFileSync(packagePath, content)

    const manifest = this.readPackageManifest(packagePath)
    if (manifest.id !== plugin.manifest.id) {
      throw new Error(
        `Downloaded plugin id mismatch: expected ${plugin.manifest.id}, got ${manifest.id}`
      )
    }
    this.assertTrustedOfficialPlugin(manifest)
    return packagePath
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

  private removeInstalledPluginFiles(pluginPath?: string): void {
    if (!pluginPath) {
      return
    }

    const installRoot = this.getPluginInstallRoot()
    const relativeToInstallRoot = path.relative(installRoot, pluginPath)
    if (
      !relativeToInstallRoot ||
      relativeToInstallRoot.startsWith('..') ||
      path.isAbsolute(relativeToInstallRoot)
    ) {
      return
    }

    fs.rmSync(pluginPath, { recursive: true, force: true })
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
      installed: Boolean(installation),
      enabled: Boolean(installation?.enabled),
      trusted: Boolean(installation?.trusted),
      trustState: installation?.trusted ? 'trusted' : 'untrusted',
      official: true,
      capabilities: plugin.manifest.capabilities,
      releaseUrl: this.getOfficialPluginReleaseUrl(plugin.manifest.id),
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

  private upsertRuntimeRecord(record: RuntimeDependencyRecord): void {
    this.store.set('runtimes', [
      ...(this.store.get('runtimes') ?? []).filter(
        (runtime) =>
          !(runtime.pluginId === record.pluginId && runtime.runtimeId === record.runtimeId)
      ),
      record
    ])
  }

  private removeRuntimeRecordsByOwner(pluginId: string): void {
    this.store.set(
      'runtimes',
      (this.store.get('runtimes') ?? []).filter((runtime) => runtime.pluginId !== pluginId)
    )
  }

  private getSettingsContribution(pluginId: string): PluginSettingsContribution | undefined {
    const record = this.getResources().find(
      (resource) =>
        resource.pluginId === pluginId && resource.kind === 'settings' && resource.enabled
    )
    return record?.payload as unknown as PluginSettingsContribution | undefined
  }

  private resolvePluginTemplate(
    template: string,
    plugin: ResolvedOfficialPlugin,
    runtime: PluginRuntimeStatus
  ): string {
    return template
      .replaceAll(`\${runtime.${runtime.runtimeId}.command}`, runtime.command ?? '')
      .replaceAll(`\${runtime.${runtime.runtimeId}.helperAppPath}`, runtime.helperAppPath ?? '')
      .replaceAll('${plugin.root}', plugin.root)
      .replaceAll('${plugin.id}', plugin.manifest.id)
  }

  private resolveRuntimeCandidate(candidate: string, pluginRoot: string): string | null {
    candidate = candidate.replaceAll('${arch}', process.arch)
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

  private resolvePluginTemplateRecord(
    input: Record<string, string>,
    plugin: ResolvedOfficialPlugin,
    runtime: PluginRuntimeStatus
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

    if (!(await this.configPresenter.getMcpEnabled())) {
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
        running: await this.mcpPresenter.isServerRunning(server.id)
      })
    }
    return statuses
  }

  private hydrateManifestPlaceholders(manifest: DeepChatPluginManifest): DeepChatPluginManifest {
    return JSON.parse(
      JSON.stringify(manifest)
        .replaceAll('${app.version}', app.getVersion())
        .replaceAll('${arch}', process.arch)
        .replaceAll('${target.platform}', this.platform)
        .replaceAll('${github.release.download}', this.getOfficialPluginReleaseDownloadBase())
    ) as DeepChatPluginManifest
  }

  private getOfficialPluginReleaseUrl(_pluginId?: string): string {
    return `${GITHUB_RELEASES_URL}/tag/${this.getReleaseTag()}`
  }

  private getOfficialPluginReleaseDownloadBase(): string {
    return `${GITHUB_RELEASE_DOWNLOAD_PREFIX}${this.getReleaseTag()}`
  }

  private getReleaseTag(): string {
    const version = app.getVersion()
    return version.startsWith('v') ? version : `v${version}`
  }

  private getOfficialPluginAssetName(assetBaseName: string, version = app.getVersion()): string {
    const safeAssetBaseName = assetBaseName.replace(/[^a-zA-Z0-9._-]/g, '-')
    return `${safeAssetBaseName}-${version}-${this.platform}-${process.arch}${PLUGIN_PACKAGE_EXTENSION}`
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
