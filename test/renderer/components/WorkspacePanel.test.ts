import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspacePanel from '@/components/sidepanel/WorkspacePanel.vue'

const {
  showArtifactMock,
  toggleSectionMock,
  clearArtifactMock,
  clearDiffMock,
  selectFileMock,
  selectDiffMock,
  registerWorkspaceMock,
  readDirectoryMock,
  getGitStatusMock,
  readFilePreviewMock,
  getGitDiffMock,
  expandDirectoryMock,
  openFileMock,
  revealFileInFolderMock
} = vi.hoisted(() => ({
  showArtifactMock: vi.fn(),
  toggleSectionMock: vi.fn(),
  clearArtifactMock: vi.fn(),
  clearDiffMock: vi.fn(),
  selectFileMock: vi.fn(),
  selectDiffMock: vi.fn(),
  registerWorkspaceMock: vi.fn().mockResolvedValue(undefined),
  readDirectoryMock: vi.fn().mockResolvedValue([]),
  getGitStatusMock: vi.fn().mockResolvedValue({
    changes: []
  }),
  readFilePreviewMock: vi.fn().mockResolvedValue(null),
  getGitDiffMock: vi.fn().mockResolvedValue(null),
  expandDirectoryMock: vi.fn().mockResolvedValue([]),
  openFileMock: vi.fn().mockResolvedValue(undefined),
  revealFileInFolderMock: vi.fn().mockResolvedValue(undefined)
}))

const sessionState = {
  selectedArtifactContext: null,
  selectedFilePath: null,
  selectedDiffPath: null,
  viewMode: 'preview',
  sections: {
    files: false,
    git: false,
    artifacts: true
  }
}

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
  ]
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
  useSidepanelStore: () => ({
    toggleSection: toggleSectionMock,
    clearArtifact: clearArtifactMock,
    clearDiff: clearDiffMock,
    selectFile: selectFileMock,
    selectDiff: selectDiffMock,
    getSessionState: () => sessionState
  })
}))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    registerWorkspace: registerWorkspaceMock,
    readDirectory: readDirectoryMock,
    getGitStatus: getGitStatusMock,
    readFilePreview: readFilePreviewMock,
    getGitDiff: getGitDiffMock,
    expandDirectory: expandDirectoryMock,
    openFile: openFileMock,
    revealFileInFolder: revealFileInFolderMock
  })
}))

vi.mock('@/components/workspace/WorkspaceFileNode.vue', () => ({
  default: defineComponent({
    name: 'WorkspaceFileNode',
    template: '<div class="workspace-file-node-stub" />'
  })
}))

vi.mock('@/components/sidepanel/WorkspaceViewer.vue', () => ({
  default: defineComponent({
    name: 'WorkspaceViewer',
    template: '<div class="workspace-viewer-stub" />'
  })
}))

describe('WorkspacePanel', () => {
  beforeEach(() => {
    showArtifactMock.mockReset()
    toggleSectionMock.mockReset()
    clearArtifactMock.mockReset()
    clearDiffMock.mockReset()
    selectFileMock.mockReset()
    selectDiffMock.mockReset()
    registerWorkspaceMock.mockClear()
    readDirectoryMock.mockClear()
    getGitStatusMock.mockClear()
    readFilePreviewMock.mockClear()
    getGitDiffMock.mockClear()
    expandDirectoryMock.mockClear()
    openFileMock.mockClear()
    revealFileInFolderMock.mockClear()
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
  })
})
