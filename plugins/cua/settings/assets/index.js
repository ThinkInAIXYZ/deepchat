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
const messageDetailNode = document.getElementById('message-detail')
const messageDetailTextNode = document.getElementById('message-detail-text')
const projectLinkNode = document.getElementById('project-link')

let currentPlatform = 'unknown'
let currentArch = 'unknown'

function setText(node, value) {
  if (node) {
    node.textContent = value || 'Unknown'
  }
}

function setMessage(value, kind = 'info', detail = '') {
  if (messageNode) {
    messageNode.textContent = value || ''
    messageNode.className = `message message-${kind}`
  }
  if (messageDetailNode && messageDetailTextNode) {
    const hasDetail = Boolean(detail && detail !== value)
    messageDetailNode.hidden = !hasDetail
    messageDetailTextNode.textContent = hasDetail ? detail : ''
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
  if (normalized === 'running' || normalized === 'installed') {
    return { text: value, className: 'permission-pill permission-ok' }
  }
  if (normalized === 'stopped' || normalized === 'disabled') {
    return { text: value, className: 'permission-pill permission-muted' }
  }
  if (normalized === 'error') {
    return { text: 'Error', className: 'permission-pill permission-denied' }
  }
  if (normalized === 'unavailable' || normalized === 'failed') {
    return { text: 'Unavailable', className: 'permission-pill permission-denied' }
  }
  return { text: value || 'Unknown', className: 'permission-pill permission-muted' }
}

function setStatusNode(node, value) {
  if (!node) {
    return
  }
  const status = normalizeStatus(value)
  node.textContent = status.text
  node.className = status.className
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

function isMissingPermission(value) {
  const normalized = String(value || '').toLowerCase()
  return normalized === 'missing' || normalized === 'denied' || normalized === 'deny'
}

function friendlyErrorMessage(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return ''
  }
  if (/PowerShell 5\.1|positional JSON arg|deepchat-permission-probe/i.test(raw)) {
    return 'Permission status could not be read from this CUA build. Open setup, then check again.'
  }
  if (raw.length > 220) {
    return 'Permission check failed. See message details.'
  }
  return raw
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

function updatePermissionMessage(data) {
  const record = asRecord(data)
  const hasMissing =
    isMissingPermission(record.accessibility) ||
    isMissingPermission(record.screenRecording) ||
    isMissingPermission(record.uia) ||
    isMissingPermission(record.postMessage)

  if (record.error) {
    setMessage(friendlyErrorMessage(record.error), 'warning', String(record.error))
    return
  }
  if (hasMissing) {
    setMessage('Grant the missing permissions, then check again.', 'warning')
    return
  }
  setMessage('')
}

async function refreshStatus() {
  const status = await getPluginApi().getStatus()
  currentPlatform = status.platform || 'unknown'
  currentArch = status.arch || 'unknown'

  setState(status.enabled)
  setStatusNode(runtimeStateNode, status.runtime?.state)
  setText(runtimeVersionNode, status.runtime?.version)
  setText(runtimePlatformNode, `${currentPlatform}/${currentArch}`)
  setText(runtimeCommandNode, status.runtime?.command)
  setText(runtimeHelperAppNode, status.runtime?.helperAppPath || 'Not required on this platform')
  renderInitialDiagnostics(currentPlatform)

  const cuaMcp = status.mcpServers?.find((server) => server.serverId === 'cua-driver')
  if (!cuaMcp) {
    setStatusNode(mcpStateNode, 'Unavailable')
    setMessage('')
  } else if (cuaMcp.lastError) {
    setStatusNode(mcpStateNode, 'Error')
    setMessage('MCP server is not running correctly.', 'error', cuaMcp.lastError)
  } else if (cuaMcp.running) {
    setStatusNode(mcpStateNode, 'Running')
    setMessage('')
  } else if (cuaMcp.enabled) {
    setStatusNode(mcpStateNode, 'Stopped')
    setMessage('')
  } else {
    setStatusNode(mcpStateNode, 'Disabled')
    setMessage('')
  }
}

async function checkPermissions() {
  setMessage('Checking permissions...')
  const result = await getPluginApi().invokeAction('runtime.checkPermissions')
  if (!result.ok || !result.data) {
    console.error('[CUA Settings] Permission check failed:', result)
    setMessage(
      friendlyErrorMessage(result.error || 'Permission check failed'),
      'error',
      result.error
    )
    return
  }

  renderPermissionResult(result.data)
  if (result.data.error) {
    console.warn('[CUA Settings] Permission check returned diagnostics:', result.data)
  }
  updatePermissionMessage(result.data)
}

document.getElementById('check')?.addEventListener('click', async () => {
  try {
    await refreshStatus()
    await checkPermissions()
  } catch (error) {
    console.error('[CUA Settings] Check failed:', error)
    const message = error instanceof Error ? error.message : String(error)
    setMessage(friendlyErrorMessage(message), 'error', message)
  }
})

document.getElementById('guide')?.addEventListener('click', async () => {
  try {
    const result = await getPluginApi().invokeAction('runtime.openPermissionGuide')
    if (!result.ok) {
      setMessage(
        friendlyErrorMessage(result.error || 'Failed to open permission setup'),
        'error',
        result.error
      )
      return
    }
    setMessage('Permission setup opened.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setMessage(friendlyErrorMessage(message), 'error', message)
  }
})

projectLinkNode?.addEventListener('click', async (event) => {
  event.preventDefault()
  try {
    const result = await getPluginApi().invokeAction('runtime.openProject')
    if (!result.ok) {
      setMessage(
        friendlyErrorMessage(result.error || 'Failed to open project'),
        'error',
        result.error
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setMessage(friendlyErrorMessage(message), 'error', message)
  }
})

document.getElementById('disable')?.addEventListener('click', async () => {
  try {
    const result = await getPluginApi().disable()
    if (!result.ok) {
      setMessage(
        friendlyErrorMessage(result.error || 'Failed to disable plugin'),
        'error',
        result.error
      )
      return
    }
    await refreshStatus()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setMessage(friendlyErrorMessage(message), 'error', message)
  }
})

refreshStatus().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  setMessage(friendlyErrorMessage(message), 'error', message)
})
