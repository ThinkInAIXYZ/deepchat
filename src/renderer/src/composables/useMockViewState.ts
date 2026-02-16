import { ref, computed } from 'vue'

const _selectedSessionId = ref<string | null>(null)
const _selectedSessionTitle = ref('')
const _selectedSessionProject = ref('')

export function useMockViewState() {
  const selectSession = (id: string | null, title: string = '', projectDir: string = '') => {
    _selectedSessionId.value = id
    _selectedSessionTitle.value = title
    _selectedSessionProject.value = projectDir
  }

  return {
    mockSessionId: _selectedSessionId,
    mockSessionTitle: _selectedSessionTitle,
    mockSessionProject: _selectedSessionProject,
    isMockChatActive: computed(() => _selectedSessionId.value !== null),
    selectSession
  }
}
