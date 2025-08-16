import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind CSS 类名
 * @param inputs
 * @returns
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get file icon based on MIME type
 * @param mimeType The MIME type string to match
 * @returns The corresponding vscode-icons identifier
 */
export function getMimeTypeIcon(mimeType: string) {
  if (
    mimeType.startsWith('text/plain') ||
    mimeType.startsWith('application/json') ||
    mimeType.startsWith('application/javascript') ||
    mimeType.startsWith('application/typescript')
  ) {
    return 'vscode-icons:file-type-text'
  } else if (mimeType.startsWith('text/csv')) {
    return 'vscode-icons:file-type-excel'
  } else if (
    mimeType.startsWith('application/vnd.ms-excel') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('numbers')
  ) {
    return 'vscode-icons:file-type-excel'
  } else if (mimeType.startsWith('text/markdown')) {
    return 'vscode-icons:file-type-markdown'
  } else if (mimeType.startsWith('application/x-yaml')) {
    return 'vscode-icons:file-type-yaml'
  } else if (
    mimeType.startsWith('application/xml') ||
    mimeType.startsWith('application/xhtml+xml')
  ) {
    return 'vscode-icons:file-type-xml'
  } else if (mimeType.startsWith('application/pdf')) {
    return 'vscode-icons:file-type-pdf2'
  } else if (mimeType.startsWith('image/')) {
    return 'vscode-icons:file-type-image'
  } else if (mimeType.startsWith('application/msword') || mimeType.includes('wordprocessingml')) {
    return 'vscode-icons:file-type-word'
  } else if (
    mimeType.startsWith('application/vnd.ms-powerpoint') ||
    mimeType.includes('presentationml')
  ) {
    return 'vscode-icons:file-type-powerpoint'
  } else if (mimeType.startsWith('text/html')) {
    return 'vscode-icons:file-type-html'
  } else if (mimeType.startsWith('text/css')) {
    return 'vscode-icons:file-type-css'
  } else if (mimeType.startsWith('audio/')) {
    return 'vscode-icons:file-type-audio'
  } else if (mimeType.startsWith('directory')) {
    return 'vscode-icons:default-folder-opened'
  } else {
    // Default file icon
    return 'vscode-icons:default-file'
  }
}
