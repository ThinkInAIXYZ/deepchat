import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Toggle } from "./Toggle.vue"

export const toggleVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-zinc-100 hover:text-zinc-500 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-zinc-100 data-[state=on]:text-zinc-900 [&_svg]:pointer-events-none [&_svg:not([class*=\'size-\'])]:size-4 [&_svg]:shrink-0 focus-visible:border-zinc-950 focus-visible:ring-zinc-950/50 focus-visible:ring-[3px] outline-none transition-[color,box-shadow] aria-invalid:ring-red-500/20 dark:aria-invalid:ring-red-500/40 aria-invalid:border-red-500 whitespace-nowrap dark:hover:bg-zinc-800 dark:hover:text-zinc-400 dark:data-[state=on]:bg-zinc-800 dark:data-[state=on]:text-zinc-50 dark:focus-visible:border-zinc-300 dark:focus-visible:ring-zinc-300/50 dark:aria-invalid:ring-red-900/20 dark:dark:aria-invalid:ring-red-900/40 dark:aria-invalid:border-red-900',
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          'border border-zinc-200 bg-transparent shadow-xs hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm: "h-8 px-1.5 min-w-8",
        lg: "h-10 px-2.5 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export type ToggleVariants = VariantProps<typeof toggleVariants>
