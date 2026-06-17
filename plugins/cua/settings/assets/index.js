const stateNode = document.getElementById('plugin-state')
const runtimeStateNode = document.getElementById('runtime-state')
const runtimeVersionNode = document.getElementById('runtime-version')
const runtimePlatformNode = document.getElementById('runtime-platform')
const runtimeCommandNode = document.getElementById('runtime-command')
const runtimeHelperAppNode = document.getElementById('runtime-helper-app')
const mcpStateNode = document.getElementById('mcp-state')
const diagnosticsTitleNode = document.getElementById('diagnostics-title')
const diagnosticsRowsNode = document.getElementById('diagnostics-rows')
const messageNode = document.getElementById('message')
const projectLinkNode = document.getElementById('project-link')

let currentPlatform = 'unknown'
let currentArch = 'unknown'

function setText(node, value) {
  if (node) {
    node.textContent = value || 'Unknown'
  }
}

function setMessage(value) {
  if (messageNode) {
    messageNode.textContent = value || ''
  }
}

function setState(enabled) {
  if (!stateNode) {
    return
  }
  stateNode.textContent = enabled ? 'Enabled' : 'Disabled'
  stateNode.className = enabled ? 'state state-ok' : 'state state-muted'
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

function normalizeStatus(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'granted') {
    return { text: 'Granted', className: 'permission-pill permission-ok' }
  }
  if (normalized === 'missing' || normalized === 'denied' || normalized === 'deny') {
    return { text: 'Denied', className: 'permission-pill permission-denied' }
  }
  if (normalized === 'available' || normalized === 'ready' || normalized === 'ok') {
    return { text: 'Ready', className: 'permission-pill permission-ok' }
  }
  if (normalized === 'unavailable' || normalized === 'failed') {
    return { text: 'Unavailable', className: 'permission-pill permission-denied' }
  }
  return { text: value || 'Unknown', className: 'permission-pill permission-muted' }
}

function createRow(label, value, statusValue) {
  const row = document.createElement('div')
  row.className = 'row'

  const labelNode = document.createElement('span')
  labelNode.textContent = label
  row.appendChild(labelNode)

  const valueNode = document.createElement('strong')
  const status = normalizeStatus(statusValue || value)
  valueNode.textContent = status.text
  valueNode.className = status.className
  row.appendChild(valueNode)

  return row
}

function renderDiagnostics(title, rows) {
  if (diagnosticsTitleNode) {
    diagnosticsTitleNode.textContent = title
  }
  if (!diagnosticsRowsNode) {
    return
  }
  diagnosticsRowsNode.textContent = ''
  for (const row of rows) {
    diagnosticsRowsNode.appendChild(createRow(row.label, row.value, row.status))
  }
}

function renderInitialDiagnostics(platform) {
  if (platform === 'darwin') {
    renderDiagnostics('macOS Permissions', [
      { label: 'Accessibility', value: 'Run Check' },
      { label: 'Screen Recording', value: 'Run Check' }
    ])
    return
  }
  if (platform === 'win32') {
    renderDiagnostics('Windows Diagnostics', [
      { label: 'UI Automation', value: 'Run Check' },
      { label: 'PostMessage', value: 'Run Check' },
      { label: 'Integrity Level', value: 'Run Check' },
      { label: 'Elevated', value: 'Run Check' }
    ])
    return
  }
  if (platform === 'linux') {
    renderDiagnostics('Linux Diagnostics', [{ label: 'Runtime Check', value: 'Run Check' }])
    return
  }
  renderDiagnostics('Diagnostics', [{ label: 'Runtime Check', value: 'Run Check' }])
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function formatBoolean(value) {
  if (typeof value !== 'boolean') {
    return 'Unknown'
  }
  return value ? 'Yes' : 'No'
}

function renderPermissionResult(data) {
  const record = asRecord(data)
  const platform = String(record.platform || currentPlatform)
  const diagnostics = asRecord(record.diagnostics)

  if (platform === 'darwin') {
    renderDiagnostics('macOS Permissions', [
      { label: 'Accessibility', value: record.accessibility },
      { label: 'Screen Recording', value: record.screenRecording }
    ])
    return
  }

  if (platform === 'win32') {
    renderDiagnostics('Windows Diagnostics', [
      { label: 'UI Automation', value: record.uia },
      { label: 'PostMessage', value: record.postMessage },
      {
        label: 'Integrity Level',
        value: diagnostics.integrity_level || diagnostics.integrityLevel || 'Unknown'
      },
      { label: 'Elevated', value: formatBoolean(diagnostics.elevated) }
    ])
    return
  }

  if (platform === 'linux') {
    renderDiagnostics('Linux Diagnostics', [
      {
        label: 'Runtime Check',
        value: record.error ? 'Unavailable' : 'Ready',
        status: record.error ? 'unavailable' : 'ready'
      }
    ])
    return
  }

  renderDiagnostics('Diagnostics', [
    {
      label: 'Runtime Check',
      value: record.error ? 'Unavailable' : 'Ready',
      status: record.error ? 'unavailable' : 'ready'
    }
  ])
}

async function refreshStatus() {
  const status = await getPluginApi().getStatus()
  currentPlatform = status.platform || 'unknown'
  currentArch = status.arch || 'unknown'

  setState(status.enabled)
  setText(runtimeStateNode, status.runtime?.state)
  setText(runtimeVersionNode, status.runtime?.version)
  setText(runtimePlatformNode, `${currentPlatform}/${currentArch}`)
  setText(runtimeCommandNode, status.runtime?.command)
  setText(runtimeHelperAppNode, status.runtime?.helperAppPath || 'Not required on this platform')
  renderInitialDiagnostics(currentPlatform)

  const cuaMcp = status.mcpServers?.find((server) => server.serverId === 'cua-driver')
  if (!cuaMcp) {
    setText(mcpStateNode, 'Unavailable')
    setMessage('')
  } else if (cuaMcp.lastError) {
    setText(mcpStateNode, 'Error')
    setMessage(cuaMcp.lastError)
  } else if (cuaMcp.running) {
    setText(mcpStateNode, 'Running')
    setMessage('')
  } else if (cuaMcp.enabled) {
    setText(mcpStateNode, 'Stopped')
    setMessage('')
  } else {
    setText(mcpStateNode, 'Disabled')
    setMessage('')
  }
}

async function checkPermissions() {
  setMessage('Checking diagnostics...')
  const result = await getPluginApi().invokeAction('runtime.checkPermissions')
  if (!result.ok || !result.data) {
    console.error('[CUA Settings] Permission check failed:', result)
    setMessage(result.error || 'Permission check failed')
    return
  }

  renderPermissionResult(result.data)
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
