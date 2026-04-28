const stateNode = document.getElementById('plugin-state')
const runtimeStateNode = document.getElementById('runtime-state')
const runtimeVersionNode = document.getElementById('runtime-version')
const runtimeCommandNode = document.getElementById('runtime-command')
const accessibilityNode = document.getElementById('permission-accessibility')
const screenRecordingNode = document.getElementById('permission-screen-recording')
const messageNode = document.getElementById('message')

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

async function refreshStatus() {
  const status = await window.deepchatPlugin.getStatus()
  setState(status.enabled)
  setText(runtimeStateNode, status.runtime?.state)
  setText(runtimeVersionNode, status.runtime?.version)
  setText(runtimeCommandNode, status.runtime?.command)
}

async function checkPermissions() {
  setMessage('Checking permissions...')
  const result = await window.deepchatPlugin.invokeAction('runtime.checkPermissions')
  if (!result.ok || !result.data) {
    setMessage(result.error || 'Permission check failed')
    return
  }

  setText(accessibilityNode, result.data.accessibility)
  setText(screenRecordingNode, result.data.screenRecording)
  setMessage('')
}

document.getElementById('check')?.addEventListener('click', async () => {
  try {
    await refreshStatus()
    await checkPermissions()
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error))
  }
})

document.getElementById('guide')?.addEventListener('click', async () => {
  const result = await window.deepchatPlugin.invokeAction('runtime.openPermissionGuide')
  if (!result.ok) {
    setMessage(result.error || 'Failed to open permission guide')
  }
})

document.getElementById('disable')?.addEventListener('click', async () => {
  const result = await window.deepchatPlugin.disable()
  if (!result.ok) {
    setMessage(result.error || 'Failed to disable plugin')
    return
  }
  await refreshStatus()
})

refreshStatus().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error))
})
