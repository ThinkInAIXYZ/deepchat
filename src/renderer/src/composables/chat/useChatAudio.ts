import { useSoundStore } from '@/stores/sound'
import sfxfcMp3 from '/sounds/sfx-fc.mp3?url'
import sfxtyMp3 from '/sounds/sfx-typing.mp3?url'

/**
 * Chat audio composable
 * Handles typewriter and tool call sound effects
 */
export function useChatAudio() {
  const soundStore = useSoundStore()

  let typewriterAudio: HTMLAudioElement | null = null
  let toolcallAudio: HTMLAudioElement | null = null
  let lastSoundTime = 0
  const soundInterval = 120

  /**
   * Initialize audio elements
   */
  const initAudio = () => {
    if (!typewriterAudio) {
      typewriterAudio = new Audio(sfxtyMp3)
      typewriterAudio.volume = 0.6
      typewriterAudio.load()
    }
    if (!toolcallAudio) {
      toolcallAudio = new Audio(sfxfcMp3)
      toolcallAudio.volume = 1
      toolcallAudio.load()
    }
  }

  /**
   * Play typewriter sound effect (throttled)
   */
  const playTypewriterSound = () => {
    const now = Date.now()
    if (!soundStore.soundEnabled || !typewriterAudio) return
    if (now - lastSoundTime > soundInterval) {
      typewriterAudio.currentTime = 0
      typewriterAudio.play().catch(console.error)
      lastSoundTime = now
    }
  }

  /**
   * Play tool call sound effect
   */
  const playToolcallSound = () => {
    if (!soundStore.soundEnabled || !toolcallAudio) return
    toolcallAudio.currentTime = 0
    toolcallAudio.play().catch(console.error)
  }

  // Initialize audio on composable creation
  initAudio()

  return {
    initAudio,
    playTypewriterSound,
    playToolcallSound
  }
}
