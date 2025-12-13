import '@/assets/main.css'

type TooltipOverlayShowPayload = {
  x: number
  y: number
  text: string
}

const root = document.getElementById('app')
if (!root) {
  throw new Error('Tooltip overlay: missing #app')
}

root.className = 'fixed inset-0 pointer-events-none'

const tooltip = document.createElement('div')
tooltip.className =
  'fixed left-0 top-0 z-[2147483647] hidden select-none whitespace-nowrap rounded-md border border-border bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg'

const arrow = document.createElement('div')
arrow.className =
  'absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-primary'

const textNode = document.createElement('div')

tooltip.appendChild(textNode)
tooltip.appendChild(arrow)
root.appendChild(tooltip)

const { ipcRenderer } = window.electron

const hide = () => {
  tooltip.classList.add('hidden')
}

const show = (payload: TooltipOverlayShowPayload) => {
  textNode.textContent = payload.text

  tooltip.style.left = `${payload.x}px`
  tooltip.style.top = `${payload.y}px`
  tooltip.style.transform = 'translate(-50%, 0)'

  tooltip.classList.remove('hidden')
}

ipcRenderer.on('shell-tooltip-overlay:show', (_event, payload: TooltipOverlayShowPayload) => {
  show(payload)
})

ipcRenderer.on('shell-tooltip-overlay:hide', () => {
  hide()
})

ipcRenderer.on('shell-tooltip-overlay:clear', () => {
  hide()
})
