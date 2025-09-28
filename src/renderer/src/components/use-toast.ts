import type { Component, VNode } from 'vue'
import { computed, defineComponent, isVNode } from 'vue'
import { toast as sonnerToast, useVueSonner } from 'vue-sonner'
import type { Action, ExternalToast, ToastT } from 'vue-sonner'

export type StringOrVNode = string | VNode | (() => VNode)

export type ToastVariant = 'default' | 'destructive'

export type ToastOptions = {
  id?: string | number
  title?: StringOrVNode
  description?: StringOrVNode
  variant?: ToastVariant
  duration?: number
  action?: Action | Component
  onOpenChange?: (open: boolean) => void
}

export type ToastInput = Omit<ToastOptions, 'id'>

const wrapVNode = (node: VNode): Component =>
  defineComponent({
    name: 'ToastVNodeWrapper',
    setup: () => () => node
  })

const normalizeContent = (
  content?: StringOrVNode
): string | Component | (() => string | Component) | undefined => {
  if (content === undefined) return undefined

  if (typeof content === 'string') return content

  if (typeof content === 'function') return content as unknown as () => string | Component

  if (isVNode(content)) return wrapVNode(content)

  return undefined
}

const mapVariantToHandler = (variant: ToastVariant | undefined) => {
  if (variant === 'destructive') return sonnerToast.error

  return sonnerToast
}

const buildOptions = (options: ToastOptions): ExternalToast => {
  const { id, description, duration, action, onOpenChange } = options
  const descriptionContent = normalizeContent(description)
  return {
    id,
    description: descriptionContent,
    duration: duration ?? 5000,
    action,
    onDismiss: () => onOpenChange?.(false),
    onAutoClose: () => onOpenChange?.(false)
  }
}

const showToast = (options: ToastOptions): string | number => {
  const handler = mapVariantToHandler(options.variant)
  const messageContent =
    normalizeContent(options.title) ?? normalizeContent(options.description) ?? ' '

  options.onOpenChange?.(true)

  return handler(messageContent, buildOptions(options))
}

function toast(props: ToastInput) {
  const merged: ToastOptions = { ...props }
  const id = showToast(merged)

  const update = (next: ToastInput) => {
    Object.assign(merged, next)
    showToast({ ...merged, id })
  }

  const dismiss = () => {
    sonnerToast.dismiss(id)
  }

  return {
    id,
    dismiss,
    update
  }
}

function useToast() {
  const { activeToasts } = useVueSonner()

  return {
    toasts: computed<ToastT[]>(() => activeToasts.value),
    toast,
    dismiss: (toastId?: string | number) => sonnerToast.dismiss(toastId)
  }
}

export { toast, useToast }
