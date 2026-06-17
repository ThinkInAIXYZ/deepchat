import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspacePanel from '@/components/sidepanel/WorkspacePanel.vue'

const {
  showArtifactMock,
  toggleSectionMock,
  clearArtifactMock,
  clearFileMock,
  clearDiffMock,
  selectFileMock,
  selectDiffMock,
  registerWorkspaceMock,
  watchWorkspaceMock,
  unwatchWorkspaceMock,
  readDirectoryMock,
  getGitStatusMock,
  readFilePreviewMock,
  getGitDiffMock,
  expandDirectoryMock,
  openFileMock,
  revealFileInFolderMock,
  selectDirectoryMock,
  isDirectoryMock,
  getPathForFileMock,
  workspaceInvalidationState,
  workspaceWatchStatusState,
  setSessionProjectDirMock
} = vi.hoisted(() => ({
  showArtifactMock: vi.fn(),
  toggleSectionMock: vi.fn(),
  clearArtifactMock: vi.fn(),
  clearFileMock: vi.fn(),
  clearDiffMock: vi.fn(),
  selectFileMock: vi.fn(),
  selectDiffMock: vi.fn(),
  registerWorkspaceMock: vi.fn().mockResolvedValue(undefined),
  watchWorkspaceMock: vi.fn().mockResolvedValue(undefined),
  unwatchWorkspaceMock: vi.fn().mockResolvedValue(undefined),
  readDirectoryMock: vi.fn().mockResolvedValue([]),
  getGitStatusMock: vi.fn().mockResolvedValue({
    workspacePath: 'C:/repo',
    branch: 'main',
    ahead: 0,
    behind: 0,
    changes: []
  }),
  readFilePreviewMock: vi.fn().mockResolvedValue(null),
  getGitDiffMock: vi.fn().mockResolvedValue(null),
  expandDirectoryMock: vi.fn().mockResolvedValue([]),
  openFileMock: vi.fn().mockResolvedValue(undefined),
  revealFileInFolderMock: vi.fn().mockResolvedValue(undefined),
  selectDirectoryMock: vi.fn().mockResolvedValue(null),
  isDirectoryMock: vi.fn().mockResolvedValue(true),
  getPathForFileMock: vi.fn(() => ''),
  workspaceInvalidationState: {
    listeners: [] as Array<
      (payload: {
        workspacePath: string
        kind: 'fs' | 'git' | 'full'
        source: 'watcher' | 'fallback' | 'lifecycle'
        version: number
      }) => void
    >,
    reset() {
      this.listeners = []
    },
    subscribe(
      listener: (payload: {
        workspacePath: string
        kind: 'fs' | 'git' | 'full'
        source: 'watcher' | 'fallback' | 'lifecycle'
        version: number
      }) => void
    ) {
      this.listeners.push(listener)
      return () => {
        this.listeners = this.listeners.filter((currentListener) => currentListener !== listener)
      }
    }
  },
  workspaceWatchStatusState: {
    listeners: [] as Array<
      (payload: {
        workspacePath: string
        health: 'healthy' | 'degraded' | 'failed'
        mode: 'native' | 'snapshot-polling' | 'git-metadata-polling'
        reason:
          | 'ready'
          | 'native-error'
          | 'utility-exit'
          | 'fallback-started'
          | 'overflow'
          | 'root-deleted'
          | 'shutdown'
        message?: string
        version: number
      }) => void
    >,
    reset() {
      this.listeners = []
    },
    subscribe(
      listener: (payload: {
        workspacePath: string
        health: 'healthy' | 'degraded' | 'failed'
        mode: 'native' | 'snapshot-polling' | 'git-metadata-polling'
        reason:
          | 'ready'
          | 'native-error'
          | 'utility-exit'
          | 'fallback-started'
          | 'overflow'
          | 'root-deleted'
          | 'shutdown'
        message?: string
        version: number
      }) => void
    ) {
      this.listeners.push(listener)
      return () => {
        this.listeners = this.listeners.filter((currentListener) => currentListener !== listener)
      }
    }
  },
  setSessionProjectDirMock: vi.fn().mockResolvedValue(undefined)
}))

const sessionState = reactive({
  selectedArtifactContext: null,
  selectedFilePath: null,
  selectedDiffPath: null,
  viewMode: 'preview',
  sections: {
    files: true,
    git: true,
    artifacts: true
  }
})

const sidepanelStore = reactive({
  open: true,
  toggleSection: toggleSectionMock,
  clearArtifact: clearArtifactMock,
  clearFile: clearFileMock,
  clearDiff: clearDiffMock,
  selectFile: selectFileMock,
  selectDiff: selectDiffMock,
  getSessionState: () => sessionState
})

const artifactStore = {
  currentArtifact: null,
  currentMessageId: null,
  currentThreadId: null,
  showArtifact: showArtifactMock
}

const messageStore = {
  messages: [
    {
      id: 'm1',
      sessionId: 's1',
      orderSeq: 1,
      role: 'assistant',
      content: JSON.stringify([
        {
          type: 'content',
          status: 'success',
          timestamp: 1,
          content:
            '<antArtifact type="text/markdown" identifier="artifact-1" title="Workspace Doc"># Hello</antArtifact>'
        }
      ]),
      status: 'sent',
      isContextEdge: 0,
      metadata: '{}',
      createdAt: 10,
      updatedAt: 10
    }
  ],
  getAssistantMessageBlocks: (message: { content: string }) => JSON.parse(message.content)
}

const emitWorkspaceInvalidated = async (payload: {
  workspacePath: string
  kind: 'fs' | 'git' | 'full'
  source: 'watcher' | 'fallback' | 'lifecycle'
  version?: number
}) => {
  for (const listener of workspaceInvalidationState.listeners) {
    listener({
      version: 1,
      ...payload
    })
  }
  await flushPromises()
}

const emitWorkspaceWatchStatusChanged = async (payload: {
  workspacePath: string
  health: 'healthy' | 'degraded' | 'failed'
  mode: 'native' | 'snapshot-polling' | 'git-metadata-polling'
  reason:
    | 'ready'
    | 'native-error'
    | 'utility-exit'
    | 'fallback-started'
    | 'overflow'
    | 'root-deleted'
    | 'shutdown'
  message?: string
  version?: number
}) => {
  for (const listener of workspaceWatchStatusState.listeners) {
    listener({
      version: 1,
      ...payload
    })
  }
  await flushPromises()
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<i class="icon-stub" />'
  })
}))

vi.mock('@/stores/artifact', () => ({
  useArtifactStore: () => artifactStore
}))

vi.mock('@/stores/ui/message', () => ({
  useMessageStore: () => messageStore
}))

vi.mock('@/stores/ui/sidepanel', () => ({
  useSidepanelStore: () => sidepanelStore
}))

vi.mock('@api/WorkspaceClient', () => ({
  createWorkspaceClient: vi.fn(() => ({
    registerWorkspace: registerWorkspaceMock,
    watchWorkspace: watchWorkspaceMock,
    unwatchWorkspace: unwatchWorkspaceMock,
    readDirectory: readDirectoryMock,
    getGitStatus: getGitStatusMock,
    readFilePreview: readFilePreviewMock,
    getGitDiff: getGitDiffMock,
    expandDirectory: expandDirectoryMock,
    openFile: openFileMock,
    revealFileInFolder: revealFileInFolderMock,
    onInvalidated: vi.fn((listener: (payload: unknown) => void) =>
      workspaceInvalidationState.subscribe(listener as any)
    ),
    onWatchStatusChanged: vi.fn((listener: (payload: unknown) => void) =>
      workspaceWatchStatusState.subscribe(listener as any)
    )
  }))
}))

vi.mock('@api/ProjectClient', () => ({
  createProjectClient: vi.fn(() => ({
    selectDirectory: selectDirectoryMock
  }))
}))

vi.mock('@api/FileClient', () => ({
  createFileClient: vi.fn(() => ({
    isDirectory: isDirectoryMock,
    getPathForFile: getPathForFileMock
  }))
}))

vi.mock('@/stores/ui/session', () => ({
  useSessionStore: () => ({
    setSessionProjectDir: setSessionProjectDirMock
  })
}))

vi.mock('@/components/workspace/WorkspaceFileNode.vue', () => ({
  default: defineComponent({
    name: 'WorkspaceFileNode',
    props: {
      node: {
        type: Object,
        required: true
      }
    },
    emits: ['toggle', 'append-path', 'insert-path'],
    template: `
      <div class="workspace-file-node-stub">
        <button class="node-toggle" type="button" @click="$emit('toggle', node)">
          {{ node.name }}
        </button>
        <button class="node-preview" type="button" @click="$emit('append-path', node.path)">
          Preview
        </button>
        <button class="node-insert" type="button" @click="$emit('insert-path', node.path)">
          Insert
        </button>
        <div v-if="node.children">
          <div v-for="child in node.children" :key="child.path" class="node-child">
            {{ child.name }}
          </div>
        </div>
      </div>
    `
  })
}))

vi.mock('@/components/sidepanel/WorkspaceViewer.vue', () => ({
  default: defineComponent({
    emits: ['toggle-fullscreen', 'back'],
    template: '<button class="workspace-viewer-stub" type="button" @click="$emit(\'back\')" />'
  })
}))

describe('WorkspacePanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()

    workspaceInvalidationState.reset()
    workspaceWatchStatusState.reset()
    sidepanelStore.open = true
    sessionState.selectedArtifactContext = null
    sessionState.selectedFilePath = null
    sessionState.selectedDiffPath = null
    sessionState.sections.files = true
    sessionState.sections.git = true
    sessionState.sections.artifacts = true
    artifactStore.currentArtifact = null
    artifactStore.currentMessageId = null
    artifactStore.currentThreadId = null

    showArtifactMock.mockReset()
    toggleSectionMock.mockReset()
    clearArtifactMock.mockReset()
    clearFileMock.mockReset()
    clearDiffMock.mockReset()
    selectFileMock.mockReset()
    selectDiffMock.mockReset()
    registerWorkspaceMock.mockReset().mockResolvedValue(undefined)
    watchWorkspaceMock.mockReset().mockResolvedValue(undefined)
    unwatchWorkspaceMock.mockReset().mockResolvedValue(undefined)
    readDirectoryMock.mockReset().mockResolvedValue([])
    getGitStatusMock.mockReset().mockResolvedValue({
      workspacePath: 'C:/repo',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changes: []
    })
    readFilePreviewMock.mockReset().mockResolvedValue(null)
    getGitDiffMock.mockReset().mockResolvedValue(null)
    expandDirectoryMock.mockReset().mockResolvedValue([])
    openFileMock.mockReset().mockResolvedValue(undefined)
    revealFileInFolderMock.mockReset().mockResolvedValue(undefined)
    selectDirectoryMock.mockReset().mockResolvedValue(null)
    isDirectoryMock.mockReset().mockResolvedValue(true)
    getPathForFileMock.mockReset().mockReturnValue('')
    setSessionProjectDirMock.mockReset().mockResolvedValue(undefined)
  })

  it('extracts artifact items from assistant blocks and opens preview context', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Workspace Doc')

    const artifactButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Workspace Doc'))
    expect(artifactButton).toBeTruthy()

    await artifactButton!.trigger('click')

    expect(showArtifactMock).toHaveBeenCalledWith(
      {
        id: 'artifact-1',
        type: 'text/markdown',
        title: 'Workspace Doc',
        language: undefined,
        content: '# Hello',
        status: 'loaded'
      },
      'm1',
      's1',
      {
        force: true,
        open: false,
        viewMode: 'preview'
      }
    )

    wrapper.unmount()
  })

  it('does not render a subagent section in the workspace navigation', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    expect(wrapper.text()).not.toContain('chat.workspace.sections.subagents')

    wrapper.unmount()
  })

  it('switches from workspace list to a single file viewer and back', async () => {
    readDirectoryMock.mockResolvedValueOnce([
      {
        name: 'README.md',
        path: 'C:/repo/README.md',
        isDirectory: false
      }
    ])

    selectFileMock.mockImplementationOnce((_sessionId, filePath) => {
      sessionState.selectedFilePath = filePath
    })

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    expect(wrapper.find('.workspace-file-node-stub').exists()).toBe(true)
    expect(wrapper.find('.workspace-viewer-stub').exists()).toBe(false)

    await wrapper.find('.node-preview').trigger('click')

    expect(selectFileMock).toHaveBeenCalledWith('s1', 'C:/repo/README.md', {
      open: false,
      viewMode: 'preview'
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.find('.workspace-file-node-stub').exists()).toBe(false)
    expect(wrapper.find('.workspace-viewer-stub').exists()).toBe(true)

    await wrapper.find('.workspace-viewer-stub').trigger('click')

    expect(clearFileMock).toHaveBeenCalledWith('s1')

    wrapper.unmount()
  })

  it('switches from workspace git list to a single diff viewer and back', async () => {
    readDirectoryMock.mockResolvedValueOnce([
      {
        name: 'README.md',
        path: 'C:/repo/README.md',
        isDirectory: false
      }
    ])
    getGitStatusMock.mockResolvedValueOnce({
      workspacePath: 'C:/repo',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changes: [
        {
          path: 'C:/repo/src/changed.ts',
          relativePath: 'src/changed.ts',
          stagedStatus: null,
          unstagedStatus: 'M',
          type: 'modified'
        }
      ]
    })
    selectDiffMock.mockImplementationOnce((_sessionId, filePath) => {
      sessionState.selectedDiffPath = filePath
    })

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    const gitButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('src/changed.ts'))
    expect(gitButton).toBeTruthy()

    await gitButton!.trigger('click')

    expect(selectDiffMock).toHaveBeenCalledWith('s1', 'C:/repo/src/changed.ts', { open: false })

    await wrapper.vm.$nextTick()

    expect(wrapper.find('.workspace-file-node-stub').exists()).toBe(false)
    expect(wrapper.find('.workspace-viewer-stub').exists()).toBe(true)

    await wrapper.find('.workspace-viewer-stub').trigger('click')

    expect(clearDiffMock).toHaveBeenCalledWith('s1')

    wrapper.unmount()
  })

  it('keeps workspace list visible for artifact selections', async () => {
    readDirectoryMock.mockResolvedValueOnce([
      {
        name: 'README.md',
        path: 'C:/repo/README.md',
        isDirectory: false
      }
    ])

    sessionState.selectedArtifactContext = {
      threadId: 's1',
      messageId: 'm1',
      artifactId: 'artifact-1'
    }

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    expect(wrapper.find('.workspace-file-node-stub').exists()).toBe(true)
    expect(wrapper.find('.workspace-viewer-stub').exists()).toBe(true)

    wrapper.unmount()
  })

  it('keeps existing file list visible while reopening refreshes in the background', async () => {
    readDirectoryMock
      .mockResolvedValueOnce([
        {
          name: 'README.md',
          path: 'C:/repo/README.md',
          isDirectory: false
        }
      ])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve([
                {
                  name: 'README.md',
                  path: 'C:/repo/README.md',
                  isDirectory: false
                }
              ])
            }, 50)
          })
      )

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    expect(wrapper.find('.workspace-file-node-stub').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('chat.workspace.files.loading')

    sidepanelStore.open = false
    await wrapper.vm.$nextTick()
    sidepanelStore.open = true
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.workspace-file-node-stub').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('chat.workspace.files.loading')

    await vi.advanceTimersByTimeAsync(50)
    await flushPromises()

    wrapper.unmount()
  })

  it('emits insertion requests separately from preview selection', async () => {
    readDirectoryMock.mockResolvedValueOnce([
      {
        name: 'README.md',
        path: 'C:/repo/README.md',
        isDirectory: false
      }
    ])

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    await wrapper.find('.node-insert').trigger('click')

    expect(wrapper.emitted('insert-file-reference')).toEqual([['C:/repo/README.md']])
    expect(selectFileMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('starts and stops workspace watchers with panel lifecycle', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    expect(registerWorkspaceMock).toHaveBeenCalledWith('C:/repo')
    expect(watchWorkspaceMock).toHaveBeenCalledWith('C:/repo')

    wrapper.unmount()
    await flushPromises()

    expect(unwatchWorkspaceMock).toHaveBeenCalledWith('C:/repo')
  })

  it('captures watch status emitted during initial watcher startup', async () => {
    watchWorkspaceMock.mockImplementationOnce(async (workspacePath: string) => {
      await emitWorkspaceWatchStatusChanged({
        workspacePath,
        health: 'degraded',
        mode: 'snapshot-polling',
        reason: 'fallback-started'
      })
    })

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    expect(wrapper.find('[data-testid="workspace-watch-status"]').text()).toContain(
      'chat.workspace.files.watchStatus.degraded'
    )

    wrapper.unmount()
  })

  it('shows watcher fallback status and hides it when the watcher recovers', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    await emitWorkspaceWatchStatusChanged({
      workspacePath: 'C:/repo',
      health: 'degraded',
      mode: 'snapshot-polling',
      reason: 'fallback-started'
    })

    expect(wrapper.find('[data-testid="workspace-watch-status"]').text()).toContain(
      'chat.workspace.files.watchStatus.degraded'
    )

    await emitWorkspaceWatchStatusChanged({
      workspacePath: 'C:/repo',
      health: 'healthy',
      mode: 'native',
      reason: 'ready'
    })

    expect(wrapper.find('[data-testid="workspace-watch-status"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('keeps expanded directories expanded after a full invalidation refresh', async () => {
    readDirectoryMock
      .mockResolvedValueOnce([
        {
          name: 'src',
          path: 'C:/repo/src',
          isDirectory: true,
          expanded: false
        }
      ])
      .mockResolvedValueOnce([
        {
          name: 'src',
          path: 'C:/repo/src',
          isDirectory: true,
          expanded: false
        }
      ])
    expandDirectoryMock.mockResolvedValue([
      {
        name: 'child.ts',
        path: 'C:/repo/src/child.ts',
        isDirectory: false
      }
    ])

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    const nodeButton = wrapper.find('.node-toggle')
    await nodeButton.trigger('click')
    await flushPromises()

    expect(expandDirectoryMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('child.ts')

    await emitWorkspaceInvalidated({
      workspacePath: 'C:/repo',
      kind: 'full',
      source: 'watcher'
    })
    await vi.advanceTimersByTimeAsync(120)
    await flushPromises()

    expect(readDirectoryMock).toHaveBeenCalledTimes(2)
    expect(expandDirectoryMock).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('child.ts')

    wrapper.unmount()
  })

  it('sets the workspace when a directory is dropped', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: null
      }
    })

    await flushPromises()

    const file = new File([''], 'repo')
    getPathForFileMock.mockReturnValue('/tmp/workspace')

    const dropZone = wrapper.find('[class*="border-dashed"]')
    await dropZone.trigger('drop', {
      dataTransfer: {
        files: [file]
      }
    })
    await flushPromises()

    expect(getPathForFileMock).toHaveBeenCalledWith(file)
    expect(isDirectoryMock).toHaveBeenCalledWith('/tmp/workspace')
    expect(setSessionProjectDirMock).toHaveBeenCalledWith('s1', '/tmp/workspace')
    expect(wrapper.emitted('update:workspacePath')).toEqual([['/tmp/workspace']])

    wrapper.unmount()
  })

  it('ignores dropped files that are not directories', async () => {
    isDirectoryMock.mockResolvedValue(false)

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: null
      }
    })

    await flushPromises()

    const file = new File(['hello'], 'README.md', { type: 'text/markdown' })
    getPathForFileMock.mockReturnValue('/tmp/workspace/README.md')

    const dropZone = wrapper.find('[class*="border-dashed"]')
    await dropZone.trigger('drop', {
      dataTransfer: {
        files: [file]
      }
    })
    await flushPromises()

    expect(isDirectoryMock).toHaveBeenCalledWith('/tmp/workspace/README.md')
    expect(setSessionProjectDirMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:workspacePath')).toBeUndefined()

    wrapper.unmount()
  })

  it('refreshes only git state for git invalidations', async () => {
    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    expect(readDirectoryMock).toHaveBeenCalledTimes(1)
    expect(getGitStatusMock).toHaveBeenCalledTimes(1)

    await emitWorkspaceInvalidated({
      workspacePath: 'C:/repo',
      kind: 'git',
      source: 'watcher'
    })
    await vi.advanceTimersByTimeAsync(120)
    await flushPromises()

    expect(readDirectoryMock).toHaveBeenCalledTimes(1)
    expect(getGitStatusMock).toHaveBeenCalledTimes(2)
    expect(readFilePreviewMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('clears stale file and diff selections after a full refresh', async () => {
    sessionState.selectedFilePath = 'C:/repo/src/app.ts'
    sessionState.selectedDiffPath = 'C:/repo/src/app.ts'

    readFilePreviewMock
      .mockResolvedValueOnce({
        path: 'C:/repo/src/app.ts',
        relativePath: 'src/app.ts',
        name: 'app.ts',
        mimeType: 'text/plain',
        kind: 'text',
        content: 'hello',
        language: 'ts',
        metadata: {
          fileName: 'app.ts',
          fileSize: 5,
          fileCreated: new Date('2024-01-01'),
          fileModified: new Date('2024-01-01')
        }
      })
      .mockResolvedValueOnce({
        path: 'C:/repo/src/app.ts',
        relativePath: 'src/app.ts',
        name: 'app.ts',
        mimeType: 'text/plain',
        kind: 'text',
        content: 'hello',
        language: 'ts',
        metadata: {
          fileName: 'app.ts',
          fileSize: 5,
          fileCreated: new Date('2024-01-01'),
          fileModified: new Date('2024-01-01')
        }
      })
      .mockResolvedValueOnce(null)

    getGitStatusMock
      .mockResolvedValueOnce({
        workspacePath: 'C:/repo',
        branch: 'main',
        ahead: 0,
        behind: 0,
        changes: [
          {
            path: 'C:/repo/src/app.ts',
            relativePath: 'src/app.ts',
            stagedStatus: null,
            unstagedStatus: 'M',
            type: 'modified'
          }
        ]
      })
      .mockResolvedValueOnce({
        workspacePath: 'C:/repo',
        branch: 'main',
        ahead: 0,
        behind: 0,
        changes: []
      })

    getGitDiffMock
      .mockResolvedValueOnce({
        workspacePath: 'C:/repo',
        filePath: 'C:/repo/src/app.ts',
        relativePath: 'src/app.ts',
        staged: '',
        unstaged: 'diff --git a/src/app.ts b/src/app.ts'
      })
      .mockResolvedValueOnce({
        workspacePath: 'C:/repo',
        filePath: 'C:/repo/src/app.ts',
        relativePath: 'src/app.ts',
        staged: '',
        unstaged: 'diff --git a/src/app.ts b/src/app.ts'
      })

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    clearFileMock.mockClear()
    clearDiffMock.mockClear()

    await emitWorkspaceInvalidated({
      workspacePath: 'C:/repo',
      kind: 'full',
      source: 'watcher'
    })
    await vi.advanceTimersByTimeAsync(120)
    await flushPromises()

    expect(clearFileMock).toHaveBeenCalledWith('s1')
    expect(clearDiffMock).toHaveBeenCalledWith('s1')

    wrapper.unmount()
  })

  it('keeps the current temporary artifact selection when it is not part of artifact items', async () => {
    sessionState.selectedArtifactContext = {
      threadId: 's1',
      messageId: 'C:/repo/README.md',
      artifactId: 'temp-html-preview'
    }
    artifactStore.currentArtifact = {
      id: 'temp-html-preview',
      type: 'text/html',
      title: 'HTML Preview',
      content: '<h1>Hello</h1>',
      status: 'loaded'
    }
    artifactStore.currentMessageId = 'C:/repo/README.md'
    artifactStore.currentThreadId = 's1'

    const wrapper = mount(WorkspacePanel, {
      props: {
        sessionId: 's1',
        workspacePath: 'C:/repo'
      }
    })

    await flushPromises()

    expect(clearArtifactMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})
