import { computed, defineComponent, isVNode } from 'vue'
import type { Component, VNode } from 'vue'
import { toast as sonnerToast, useVueSonner } from 'vue-sonner'
import type { ExternalToast } from 'vue-sonner'
import { cn } from '@shadcn/lib/utils'

export type ToastContent = string | VNode | (() => VNode) | Component

export type ToastOptions = Omit<Partial<ExternalToast>, 'description' | 'class'> & {
  title?: ToastContent
  description?: ToastContent
  variant?: 'default' | 'destructive'
  class?: string
  onOpenChange?: (open: boolean) => void
}

type ToastHandle = {
  id: number | string
  dismiss: () => void
  update: (options: ToastOptions) => void
}

const baseToastClass = 'rounded-md border shadow-lg px-4 py-3 text-sm'
const variantClasses: Record<'default' | 'destructive', string> = {
  default: 'bg-popover text-popover-foreground border-border',
  destructive: 'bg-destructive text-destructive-foreground border-destructive',
}

const toRenderable = (content?: ToastContent) => {
  if (!content) return undefined
  if (typeof content === 'string') return content
  if (typeof content === 'function') {
    return defineComponent({
      setup: () => () => content(),
    })
  }
  if (isVNode(content)) {
    const vnode = content
    return defineComponent({
      setup: () => () => vnode,
    })
  }
  return content
}

const emitToast = (options: ToastOptions, existingId?: number | string) => {
  const {
    title,
    description,
    variant = 'default',
    onOpenChange,
    class: className,
    onDismiss,
    onAutoClose,
    ...rest
  } = options

  const id = sonnerToast(toRenderable(title) ?? '', {
    ...rest,
    id: existingId,
    description: toRenderable(description),
    class: cn(baseToastClass, variantClasses[variant], className),
    onDismiss: (toastInstance) => {
      onOpenChange?.(false)
      onDismiss?.(toastInstance)
    },
    onAutoClose: (toastInstance) => {
      onOpenChange?.(false)
      onAutoClose?.(toastInstance)
    },
  })

  if (existingId === undefined) {
    onOpenChange?.(true)
  }

  return id
}

const createToast = (options: ToastOptions): ToastHandle => {
  let currentOptions = { ...options }
  const id = emitToast(currentOptions)

  return {
    id,
    dismiss: () => sonnerToast.dismiss(id),
    update: (nextOptions) => {
      currentOptions = { ...currentOptions, ...nextOptions }
      emitToast(currentOptions, id)
    },
  }
}

const toastFn = (options: ToastOptions): ToastHandle => createToast(options)

toastFn.dismiss = (id?: number | string) => sonnerToast.dismiss(id)

type ToastFunction = typeof toastFn & {
  dismiss: (id?: number | string) => void
}

export const toast: ToastFunction = Object.assign(toastFn, {
  dismiss: toastFn.dismiss,
})

export function useToast() {
  const { activeToasts } = useVueSonner()
  return {
    toasts: computed(() => activeToasts.value),
    toast,
    dismiss: toast.dismiss,
  }
}
