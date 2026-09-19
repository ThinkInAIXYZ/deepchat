#!/usr/bin/env node

import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

// 这里放你要维护的shadcn组件列表
const components = [
  "accordion",
  "alert",
  "alert-dialog",
  "aspect-ratio",
  "avatar",
  "badge",
  "breadcrumb",
  "button",
  "card",
  "checkbox",
  "collapsible",
  "context-menu",
  "dialog",
  "dropdown-menu",
  "hover-card",
  "input",
  "label",
  "menubar",
  "navigation-menu",
  "popover",
  "progress",
  "radio-group",
  "select",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "switch",
  "tabs",
  "textarea",
  "tooltip",
  "toggle",
  'sonner',
  'table',
  'form',
  'calendar',
  'drawer',
  'combobox',
  'slider',
  'scroll-area',
  'button-group',
  'empty',
  'field',
  'input-group',
  'item',
  'kbd',
  'spinner'
]

// 批量更新组件
function updateComponents() {
  if (components.length === 0) {
    console.log('组件列表为空，请在脚本中配置组件')
    return
  }

  console.log(`正在更新 ${components.length} 个组件: ${components.join(', ')}`)

  try {
    const command = `cd "${projectRoot}" && pnpm dlx shadcn-vue@latest add ${components.join(' ')} -o`
    execSync(command, { stdio: 'inherit' })
    console.log('组件更新完成 ✓')
  } catch (error) {
    console.error('更新组件时出错:', error.message)
  }
}

// 执行更新
updateComponents()
