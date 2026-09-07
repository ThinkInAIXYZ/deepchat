import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'

export interface DcButtonProps extends PrimitiveProps {
  variant?: DcButtonVariants['variant']
  size?: DcButtonVariants['size']
  icon?: string
  iconSize?: DcIconSize
  iconClass?: HTMLAttributes['class']
  loading?: boolean
  disabled?: boolean
  active?: boolean
  /** Visible tooltip. `label` alone only provides the accessible name. */
  tooltip?: string
  tooltipSide?: DcTooltipSide
  tooltipSideOffset?: number
  tooltipDelayDuration?: number
  tooltipContentClass?: HTMLAttributes['class']
  tooltipIgnoreNonKeyboardFocus?: boolean
  label?: string
  class?: HTMLAttributes['class']
}

import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

type DcIconSize = '3' | '3.5' | '4'
type DcTooltipSide = 'top' | 'bottom' | 'left' | 'right'

export const dcButtonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,scale] duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4 [&_svg]:shrink-0 shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 gap-2 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        xs: 'h-7 gap-1.5 rounded-md px-2.5 text-xs has-[>svg]:px-2',
        lg: 'h-10 gap-2 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-8',
        'icon-sm': 'size-7',
        'icon-xs': 'size-6',
        'icon-lg': 'size-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export type DcButtonVariants = VariantProps<typeof dcButtonVariants>
