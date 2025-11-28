<template>
  <div class="w-screen h-screen" :class="isWinMacOS ? '' : 'bg-background'">
    <AppBar />
    <main class="content-container">
      <!-- WebContentsView will be rendered here by the main process -->
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppBar from './components/AppBar.vue'
import { useDeviceVersion } from '@/composables/useDeviceVersion'
import { useMcpStore } from '@/stores/mcp'

// Detect platform to apply proper styling
const { isWinMacOS } = useDeviceVersion()
const router = useRouter()
const mcpStore = useMcpStore()

onMounted(async () => {
  // Check for pending MCP install from localStorage (cold start scenario)
  try {
    const pendingMcpInstall = localStorage.getItem('pending-mcp-install')
    if (pendingMcpInstall) {
      console.log('Found pending MCP install in localStorage (cold start):', pendingMcpInstall)
      // Clear the localStorage immediately to prevent re-processing
      localStorage.removeItem('pending-mcp-install')

      // Parse and process the MCP configuration
      const mcpConfig = JSON.parse(pendingMcpInstall)

      if (!mcpConfig?.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
        console.error('Invalid MCP install config, missing mcpServers')
        return
      }

      // Enable MCP if not already enabled
      if (!mcpStore.mcpEnabled) {
        await mcpStore.setMcpEnabled(true)
      }

      // Set the MCP install cache
      mcpStore.setMcpInstallCache(JSON.stringify(mcpConfig))

      // Navigate to MCP settings page
      const currentRoute = router.currentRoute.value
      if (currentRoute.name !== 'settings-mcp') {
        await router.push({ name: 'settings-mcp' })
      } else {
        await router.replace({
          name: 'settings-mcp',
          query: { ...currentRoute.query }
        })
      }

      console.log('MCP install deeplink processed successfully from cold start')
    }
  } catch (error) {
    console.error('Error processing pending MCP install from cold start:', error)
    // Clear potentially corrupted data
    localStorage.removeItem('pending-mcp-install')
  }
})
</script>

<style>
html,
body {
  background-color: transparent;
}
</style>
