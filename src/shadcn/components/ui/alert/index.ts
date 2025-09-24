import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Alert } from "./Alert.vue"
export { default as AlertDescription } from "./AlertDescription.vue"
export { default as AlertTitle } from "./AlertTitle.vue"

export const alertVariants = cva(
  'relative w-full rounded-lg border border-zinc-200 px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current dark:border-zinc-800',
  {
    variants: {
      variant: {
        default: 'bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50',
        destructive:
          'text-red-500 bg-white [&>svg]:text-current *:data-[slot=alert-description]:text-red-500/90 dark:text-red-900 dark:bg-zinc-950 dark:*:data-[slot=alert-description]:text-red-900/90',
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export type AlertVariants = VariantProps<typeof alertVariants>
