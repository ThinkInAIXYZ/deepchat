// === Vue Core ===
import { ref, onMounted } from 'vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

/**
 * Composable for detecting device platform and OS version
 *
 * Features:
 * - Detects if the current OS is macOS or Windows 11+
 * - Automatically loads device info on component mount
 * - Centralizes platform-specific UI logic
 *
 * Platform Detection Rules:
 * - macOS: All versions return true
 * - Windows: Only Windows 11+ returns true
 * - Linux: Returns false
 *
 * Technical Notes:
 * - Windows osVersion format: "10.0.22621" (Major.Minor.BuildNumber)
 *   - Windows 11 starts at build 22000
 *   - We extract the 3rd part (index [2]) for build number comparison
 * - macOS osVersion format: "25.1.0" (Darwin kernel version)
 *   - macOS Tahoe (26) = Darwin 25.x
 *   - macOS Sequoia (15) = Darwin 24.x
 *   - macOS Sonoma (14) = Darwin 23.x
 *   - No version check needed, all macOS versions are treated equally
 */
export function useDeviceVersion() {
  // === Local State ===
  const isWinMacOS = ref(false)
  const isMacOS = ref(false)
  const devicePresenter = usePresenter('devicePresenter')

  // === Lifecycle Hooks ===
  onMounted(() => {
    devicePresenter.getDeviceInfo().then((deviceInfo) => {
      // Detect macOS (all versions)
      const isMacOSPlatform = deviceInfo.platform === 'darwin'
      isMacOS.value = isMacOSPlatform

      // Check if it's Windows 11+
      // Note: Windows osVersion format is "10.0.22621", we need the 3rd part (build number)
      let isWin11Plus = false
      if (deviceInfo.platform === 'win32') {
        const buildNumber = parseInt(deviceInfo.osVersion.split('.')[2] || '0', 10)
        const win11Metadata = deviceInfo.osVersionMetadata.find((v) => v.name === 'Windows 11')
        isWin11Plus = win11Metadata ? buildNumber >= win11Metadata.build : false
      }

      // isWinMacOS is true for: macOS (all versions) OR Windows 11+
      isWinMacOS.value = isMacOSPlatform || isWin11Plus
    })
  })

  // === Return API ===
  return {
    // State
    isWinMacOS,
    isMacOS
  }
}
