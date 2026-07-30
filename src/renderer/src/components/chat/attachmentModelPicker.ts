import { nextTick, type Ref } from 'vue'

export interface ChatStatusBarModelPicker {
  openModelPicker?: () => boolean
}

export function openChatStatusBarModelPicker(
  statusBarRef: Readonly<Ref<ChatStatusBarModelPicker | null>>,
  logScope: string
): void {
  void nextTick(() => {
    const opened = statusBarRef.value?.openModelPicker?.() ?? false
    if (!opened) {
      console.warn(`[${logScope}] Model picker is unavailable`)
    }
  })
}

export function switchAttachmentToVisionModel(
  cancelPreparation: () => void,
  openModelPicker: () => void
): void {
  cancelPreparation()
  openModelPicker()
}
