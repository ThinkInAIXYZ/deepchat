import { ref, computed } from 'vue'

const _selectedSessionId = ref<string | null>(null)
const _selectedSessionTitle = ref('')

export function useMockViewState() {
  const selectSession = (id: string | null, title: string = '') => {
    _selectedSessionId.value = id
    _selectedSessionTitle.value = title
  }

  return {
    mockSessionId: _selectedSessionId,
    mockSessionTitle: _selectedSessionTitle,
    isMockChatActive: computed(() => _selectedSessionId.value !== null),
    selectSession
  }
}
