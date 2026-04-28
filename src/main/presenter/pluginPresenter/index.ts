import { app, BrowserWindow, shell } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import ElectronStore from 'electron-store'
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

const CUA_PLUGIN_ID = 'com.deepchat.plugins.cua'
const OFFICIAL_SOURCE_PREFIX = 'https://deepchat.thinkinai.xyz/plugins/'
const CUA_PERMISSION_GUIDE_URL = 'https://cua.ai/docs/cua-driver/guide/getting-started/installation'

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
}

type SkillContributionPort = ISkillPresenter & {
  registerPluginSkill?: (input: {
    ownerPluginId: string
    id: string
    skillRoot: string
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

      const now = Date.now()
      const existing = this.getInstallation(pluginId)
      const next: PluginInstallationRecord = {
        pluginId,
        version: plugin.manifest.version,
        path: plugin.root,
        enabled: existing?.enabled ?? false,
        trusted: true,
        source: OFFICIAL_PLUGIN_SOURCE,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now
      }
      this.upsertInstallation(next)
      return { ok: true, status: await this.buildPluginListItem(pluginId) }
    } catch (error) {
      return this.errorResult(error)
    }
  }

  async enablePlugin(pluginId: string): Promise<PluginActionResult> {
    try {
      const installResult = await this.installOfficialPlugin(pluginId)
      if (!installResult.ok) {
        return installResult
      }

      const installation = this.getInstallation(pluginId)
      if (!installation) {
        throw new Error(`Plugin ${pluginId} was not installed`)
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
      await this.disableByOwner(pluginId)
      this.store.set(
        'installations',
        this.getInstallations().filter((installation) => installation.pluginId !== pluginId)
      )
      this.removeResourceRecordsByOwner(pluginId)
      this.removeRuntimeRecordsByOwner(pluginId)
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

      if (pluginId !== CUA_PLUGIN_ID) {
        throw new Error(`Unsupported plugin action owner: ${pluginId}`)
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
            data: (await this.checkCuaPermissions(pluginId)) as PluginActionResult['data']
          }
        case 'runtime.openPermissionGuide':
          await shell.openExternal(CUA_PERMISSION_GUIDE_URL)
          return { ok: true }
        case 'runtime.uninstallHelper':
          return {
            ok: false,
            error:
              'Helper uninstall is intentionally not implemented on this platform. Use the official Cua Driver uninstall flow on macOS.'
          }
        default:
          throw new Error(`Unsupported plugin action: ${actionId}`)
      }
    } catch (error) {
      return this.errorResult(error)
    }
  }

  private async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.getOfficialPluginOrThrow(pluginId)
    this.assertTrustedOfficialPlugin(plugin.manifest)
    this.assertPlatformSupported(plugin.manifest)

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

    await this.registerMcpServers(plugin, runtime)
    await this.registerSkills(plugin)
    this.registerToolPolicies(plugin)
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
  ): Promise<void> {
    const servers = plugin.manifest.mcpServers ?? []
    for (const server of servers) {
      const command = this.resolveRuntimeTemplate(server.command, runtime)
      const serverName = server.id
      const existingServers = await this.configPresenter.getMcpServers()
      const existing = existingServers[serverName]
      if (existing && existing.ownerPluginId !== plugin.manifest.id) {
        throw new Error(`MCP server "${serverName}" already exists and is not owned by this plugin`)
      }

      const config: MCPServerConfig = {
        type: 'stdio',
        command,
        args: server.args,
        env: {
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
    }
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
        skillRoot
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
    const plugin = this.getOfficialPluginOrThrow(pluginId)
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
        preload: path.join(__dirname, '../preload/plugin-settings-preload.mjs'),
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
    const plugin = this.getOfficialPluginOrThrow(pluginId)
    const runtimeManifest = plugin.manifest.runtime
    if (!runtimeManifest) {
      throw new Error(`Plugin ${pluginId} does not declare a runtime`)
    }

    const status = await this.detectRuntime(runtimeManifest)
    this.upsertRuntimeRecord({
      pluginId,
      runtimeId: runtimeManifest.id,
      provider: runtimeManifest.install?.provider ?? plugin.manifest.publisher,
      command: status.command,
      version: status.version,
      installSource: runtimeManifest.install?.strategy,
      state: status.state,
      lastError: status.lastError,
      checkedAt: status.checkedAt ?? Date.now()
    })
    return status
  }

  private async detectRuntime(runtime: PluginRuntimeManifest): Promise<PluginRuntimeStatus> {
    const checkedAt = Date.now()
    for (const candidate of runtime.detect) {
      const command = this.resolveRuntimeCandidate(candidate)
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
        return {
          runtimeId: runtime.id,
          displayName: runtime.displayName,
          state: 'installed',
          command,
          version: stdout.trim() || undefined,
          checkedAt
        }
      } catch (error) {
        if (path.isAbsolute(command)) {
          return {
            runtimeId: runtime.id,
            displayName: runtime.displayName,
            state: 'error',
            command,
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

  private async checkCuaPermissions(pluginId: string) {
    const runtime = await this.refreshRuntime(pluginId)
    if (!runtime.command) {
      return {
        accessibility: 'unknown',
        screenRecording: 'unknown',
        error: 'missingRuntime'
      }
    }

    try {
      const { stdout, stderr } = await execFileAsync(runtime.command, ['check_permissions'], {
        timeout: 10000,
        windowsHide: true
      })
      return {
        accessibility: this.parsePermissionState(`${stdout}\n${stderr}`, 'Accessibility'),
        screenRecording: this.parsePermissionState(`${stdout}\n${stderr}`, 'Screen Recording')
      }
    } catch (error) {
      return {
        accessibility: 'unknown',
        screenRecording: 'unknown',
        error: error instanceof Error ? error.message : String(error)
      }
    }
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

  private async loadOfficialPlugins(): Promise<void> {
    if (this.officialPlugins.size > 0) {
      return
    }

    const cuaRoot = this.resolveOfficialPluginRoot('cua')
    if (!cuaRoot) {
      return
    }

    const manifest = this.readManifest(path.join(cuaRoot, 'plugin.json'))
    this.assertTrustedOfficialPlugin(manifest)
    this.officialPlugins.set(manifest.id, {
      manifest,
      root: cuaRoot
    })
  }

  private resolveOfficialPluginRoot(name: string): string | null {
    const candidates = [
      path.join(process.cwd(), 'plugins', name),
      path.join(this.appPath, 'plugins', name),
      path.join(process.resourcesPath ?? '', 'app.asar.unpacked', 'plugins', name),
      path.join(process.resourcesPath ?? '', 'plugins', name)
    ]
    return (
      candidates.find((candidate) => fs.existsSync(path.join(candidate, 'plugin.json'))) ?? null
    )
  }

  private readManifest(manifestPath: string): DeepChatPluginManifest {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as DeepChatPluginManifest
    if (!parsed.id || !parsed.name || !parsed.version || !parsed.source) {
      throw new Error(`Invalid plugin manifest: ${manifestPath}`)
    }
    return parsed
  }

  private assertTrustedOfficialPlugin(manifest: DeepChatPluginManifest): void {
    if (manifest.source.type !== OFFICIAL_PLUGIN_SOURCE) {
      throw new Error(`Plugin ${manifest.id} is not from the official source`)
    }
    if (!manifest.source.url.startsWith(OFFICIAL_SOURCE_PREFIX)) {
      throw new Error(`Plugin ${manifest.id} has an untrusted source URL`)
    }
    if (manifest.source.publisher !== manifest.publisher) {
      throw new Error(`Plugin ${manifest.id} publisher does not match source metadata`)
    }
  }

  private assertPlatformSupported(manifest: DeepChatPluginManifest): void {
    const platforms = new Set(manifest.engines.platforms.map((platform) => platform.toLowerCase()))
    const aliases = this.platform === 'darwin' ? ['darwin', 'macos', 'mac'] : [this.platform]
    if (!aliases.some((platform) => platforms.has(platform))) {
      throw new Error(`Plugin ${manifest.id} does not support ${this.platform}`)
    }
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
      runtime,
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

  private resolveRuntimeTemplate(template: string, runtime: PluginRuntimeStatus): string {
    return template.replace(`\${runtime.${runtime.runtimeId}.command}`, runtime.command ?? '')
  }

  private resolveRuntimeCandidate(candidate: string): string | null {
    if (candidate.startsWith('PATH:')) {
      return candidate.slice('PATH:'.length)
    }
    if (candidate.startsWith('~/')) {
      return path.join(app.getPath('home'), candidate.slice(2))
    }
    return candidate
  }

  private resolvePluginRelativePath(pluginRoot: string, relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/')
    if (normalized.startsWith('/') || normalized.includes('..') || /^[A-Za-z]:/.test(normalized)) {
      throw new Error(`Unsafe plugin path: ${relativePath}`)
    }
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
