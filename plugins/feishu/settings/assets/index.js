const stateNode = document.getElementById('plugin-state')
const mcpStateNode = document.getElementById('mcp-state')
const brandNode = document.getElementById('brand')
const appIdNode = document.getElementById('app-id')
const appSecretNode = document.getElementById('app-secret')
const presetNode = document.getElementById('preset')
const messageNode = document.getElementById('message')

function setText(node, value) {
  if (node) node.textContent = value || 'Unknown'
}

function setMessage(value) {
  if (messageNode) messageNode.textContent = value || ''
}

function setState(enabled) {
  if (!stateNode) return
  stateNode.textContent = enabled ? 'Enabled' : 'Disabled'
  stateNode.className = enabled ? 'state state-ok' : 'state state-muted'
}

function getPluginApi() {
  const api = window.deepchatPlugin
  if (!api) throw new Error('Plugin settings bridge is unavailable.')
  return api
}

async function loadConfig() {
  const result = await getPluginApi().invokeAction('config.get')
  if (result.ok && result.data) {
    brandNode.value = result.data.brand || 'feishu'
    appIdNode.value = result.data.appId || ''
    appSecretNode.value = result.data.appSecret || ''
    presetNode.value = result.data.preset || 'preset.default'
  }
}

async function refreshStatus() {
  const status = await getPluginApi().getStatus()
  setState(status.enabled)

  const mcp = status.mcpServers?.find((s) => s.serverId === 'feishu-tools')
  if (!mcp) {
    setText(mcpStateNode, 'Unavailable')
  } else if (mcp.running) {
    setText(mcpStateNode, 'Running')
    setMessage('')
  } else if (mcp.enabled) {
    setText(mcpStateNode, 'Stopped')
    setMessage('')
  } else if (mcp.lastError) {
    setText(mcpStateNode, 'Error')
    setMessage(mcp.lastError)
  } else {
    setText(mcpStateNode, 'Disabled')
    setMessage('')
  }

  if (!mcp) {
    setMessage('')
  }
}

document.getElementById('save')?.addEventListener('click', async () => {
  const appId = appIdNode.value.trim()
  const appSecret = appSecretNode.value.trim()

  if (!appId || !appSecret) {
    setMessage('App ID and App Secret are required.')
    return
  }

  setMessage('Saving...')
  const result = await getPluginApi().invokeAction('config.set', {
    appId,
    appSecret,
    brand: brandNode.value,
    preset: presetNode.value
  })

  if (!result.ok) {
    setMessage(result.error || 'Failed to save config.')
    return
  }

  setMessage('Saved. Restart the MCP server to apply changes.')
})

document.getElementById('disable')?.addEventListener('click', async () => {
  try {
    const result = await getPluginApi().disable()
    if (!result.ok) {
      setMessage(result.error || 'Failed to disable plugin.')
      return
    }
    await refreshStatus()
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error))
  }
})

document.getElementById('preset-docs')?.addEventListener('click', async (e) => {
  e.preventDefault()
  try {
    await getPluginApi().invokeAction('shell.openExternal', {
      url: 'https://github.com/larksuite/lark-openapi-mcp/blob/main/docs/reference/tool-presets/presets.md'
    })
  } catch {
    // ignore
  }
})

Promise.all([loadConfig(), refreshStatus()]).catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error))
})
