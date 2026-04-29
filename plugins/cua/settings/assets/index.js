const stateNode = document.getElementById('plugin-state')
const runtimeStateNode = document.getElementById('runtime-state')
const runtimeVersionNode = document.getElementById('runtime-version')
const runtimeCommandNode = document.getElementById('runtime-command')
const accessibilityNode = document.getElementById('permission-accessibility')
const screenRecordingNode = document.getElementById('permission-screen-recording')
const messageNode = document.getElementById('message')
const projectLinkNode = document.getElementById('project-link')

function setText(node, value) {
  if (node) {
    node.textContent = value || 'Unknown'
  }
}

function setMessage(value) {
  setText(messageNode, value)
}

function setState(enabled) {
  if (!stateNode) {
    return
  }
  stateNode.textContent = enabled ? 'Enabled' : 'Disabled'
  stateNode.className = enabled ? 'state state-ok' : 'state state-muted'
}

function setPermissionStatus(node, value) {
  if (!node) {
    return
  }

  const normalized = String(value || '').toLowerCase()
  if (normalized === 'granted') {
    node.textContent = 'Granted'
    node.className = 'permission-pill permission-ok'
    return
  }

  if (normalized === 'missing' || normalized === 'denied' || normalized === 'deny') {
    node.textContent = 'Denied'
    node.className = 'permission-pill permission-denied'
    return
  }

  node.textContent = 'Unavailable'
  node.className = 'permission-pill permission-muted'
}

function getPluginApi() {
  const api = window.deepchatPlugin
  if (!api) {
    throw new Error(
      'DeepChat plugin settings bridge is unavailable. Restart DeepChat and reopen this page.'
    )
  }
  return api
}

async function refreshStatus() {
  const status = await getPluginApi().getStatus()
  setState(status.enabled)
  setText(runtimeStateNode, status.runtime?.state)
  setText(runtimeVersionNode, status.runtime?.version)
  setText(runtimeCommandNode, status.runtime?.command)
}

async function checkPermissions() {
  setMessage('Checking permissions...')
  const result = await getPluginApi().invokeAction('runtime.checkPermissions')
  if (!result.ok || !result.data) {
    console.error('[CUA Settings] Permission check failed:', result)
    setMessage(result.error || 'Permission check failed')
    return
  }

  setPermissionStatus(accessibilityNode, result.data.accessibility)
  setPermissionStatus(screenRecordingNode, result.data.screenRecording)
  if (result.data.error) {
    console.warn('[CUA Settings] Permission check returned diagnostics:', result.data)
    setMessage(result.data.error)
    return
  }
  setMessage('')
}

document.getElementById('check')?.addEventListener('click', async () => {
  try {
    await refreshStatus()
    await checkPermissions()
  } catch (error) {
    console.error('[CUA Settings] Check failed:', error)
    setMessage(error instanceof Error ? error.message : String(error))
  }
})

document.getElementById('guide')?.addEventListener('click', async () => {
  try {
    const result = await getPluginApi().invokeAction('runtime.openPermissionGuide')
    if (!result.ok) {
      setMessage(result.error || 'Failed to open permission guide')
    }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error))
  }
})

projectLinkNode?.addEventListener('click', async (event) => {
  event.preventDefault()
  try {
    const result = await getPluginApi().invokeAction('runtime.openProject')
    if (!result.ok) {
      setMessage(result.error || 'Failed to open project')
    }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error))
  }
})

document.getElementById('disable')?.addEventListener('click', async () => {
  try {
    const result = await getPluginApi().disable()
    if (!result.ok) {
      setMessage(result.error || 'Failed to disable plugin')
      return
    }
    await refreshStatus()
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error))
  }
})

refreshStatus().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error))
})
