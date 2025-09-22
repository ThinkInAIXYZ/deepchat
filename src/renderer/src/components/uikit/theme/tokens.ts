export type ThemeTokens = Record<string, string>

export const deepchatV3LightBrand: ThemeTokens = {
  // Light (mapped from Figma Theme Colors panel)
  '--background': '0 0% 100%', // #ffffff
  '--foreground': '229 85% 5%', // #020618
  '--card': '0 0% 100%',
  '--card-foreground': '229 85% 5%',
  '--popover': '0 0% 100%',
  '--popover-foreground': '229 85% 5%',
  '--primary': '221 97% 54%', // #155dfc
  '--primary-foreground': '210 40% 98%', // #f8fafc
  '--secondary': '210 40% 96%', // #f1f5f9
  '--secondary-foreground': '223 48% 11%', // #0f172b
  '--muted': '210 40% 96%', // #f1f5f9
  '--muted-foreground': '215 18% 47%', // #62748e
  '--accent': '210 40% 96%',
  '--accent-foreground': '223 48% 11%',
  '--destructive': '357 100% 45%', // #e7000b
  '--destructive-foreground': '210 40% 98%',
  '--border': '214 32% 91%', // #e2e8f0
  '--input': '214 32% 91%',
  '--ring': '229 85% 5%',
  '--container': '0 0% 100%',
  '--chart-1': '12 76% 61%', // #e76e50
  '--chart-2': '173 58% 39%', // #2a9d90
  '--chart-3': '197 37% 24%', // #274754
  '--chart-4': '43 74% 66%', // #e8c468
  '--chart-5': '27 87% 67%', // #f4a462
  '--sidebar': '210 40% 98%', // #f8fafc (alias for sidebar-background)
  '--sidebar-background': '210 40% 98%',
  '--sidebar-foreground': '215 28% 27%', // #314158
  '--sidebar-primary': '223 48% 11%', // #0f172b
  '--sidebar-primary-foreground': '210 40% 98%',
  '--sidebar-accent': '210 40% 96%',
  '--sidebar-accent-foreground': '223 48% 11%',
  '--sidebar-border': '214 32% 91%',
  '--sidebar-ring': '221 97% 54%', // #155dfc
  '--usage-low': '173 58% 39%', // #2a9d90
  '--usage-mid': '43 74% 66%', // #e8c468
  '--usage-high': '12 76% 61%', // #e76e50
  // Border radius tokens (px)
  '--radius-none': '0px',
  '--radius-xs': '2px',
  '--radius-sm': '4px',
  '--radius-md': '6px',
  '--radius-lg': '8px',
  '--radius-xl': '12px',
  '--radius-2xl': '16px',
  '--radius-3xl': '24px',
  '--radius-full': '9999px',
  '--radius': 'var(--radius-md)', // default rounded
  // Shadow tokens
  '--shadow-none': '0 0 #0000',
  '--shadow-2xs': '0 1px 0 0 rgba(0, 0, 0, 0.05)',
  '--shadow-xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  '--shadow-sm': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  '--shadow-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  '--shadow-xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  '--shadow-2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  '--shadow-inset-2xs': 'inset 0 1px 0 0 rgba(0, 0, 0, 0.05)',
  '--shadow-inset-xs': 'inset 0 1px 1px 0 rgba(0, 0, 0, 0.05)',
  '--shadow-inset-sm': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
  // Typography tokens
  '--font-family-sans':
    "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'",
  '--font-size-xs': '0.75rem',
  '--font-size-sm': '0.875rem',
  '--font-size-base': '1rem',
  '--font-size-lg': '1.125rem',
  '--font-size-xl': '1.25rem',
  '--font-size-2xl': '1.5rem',
  '--font-size-3xl': '1.875rem',
  '--font-size-4xl': '2.25rem',
  '--font-size-5xl': '3rem',
  '--font-size-6xl': '3.75rem',
  '--font-size-7xl': '4.5rem',
  '--font-size-8xl': '6rem',
  '--font-size-9xl': '8rem',
  '--line-height-xs': '1rem',
  '--line-height-sm': '1.25rem',
  '--line-height-base': '1.5rem',
  '--line-height-lg': '1.75rem',
  '--line-height-xl': '1.75rem',
  '--line-height-2xl': '2rem',
  '--line-height-3xl': '2.25rem',
  '--line-height-4xl': '2.5rem',
  '--line-height-5xl': '1',
  '--line-height-6xl': '1',
  '--line-height-7xl': '1',
  '--line-height-8xl': '1',
  '--line-height-9xl': '1',
  '--font-weight-thin': '100',
  '--font-weight-extralight': '200',
  '--font-weight-light': '300',
  '--font-weight-normal': '400',
  '--font-weight-medium': '500',
  '--font-weight-semibold': '600',
  '--font-weight-bold': '700',
  '--font-weight-extrabold': '800',
  '--font-weight-black': '900',
  // Blur tokens (from Figma Blur panel)
  '--blur-none': '0px',
  '--blur-xs': '4px',
  '--blur-sm': '8px',
  '--blur-md': '12px',
  '--blur-lg': '16px',
  '--blur-xl': '24px',
  '--blur-2xl': '40px',
  '--blur-3xl': '64px',
  // Opacity tokens (from Figma Opacity panel)
  '--opacity-0': '0',
  '--opacity-5': '0.05',
  '--opacity-10': '0.1',
  '--opacity-15': '0.15',
  '--opacity-20': '0.2',
  '--opacity-25': '0.25',
  '--opacity-30': '0.3',
  '--opacity-35': '0.35',
  '--opacity-40': '0.4',
  '--opacity-45': '0.45',
  '--opacity-50': '0.5',
  '--opacity-55': '0.55',
  '--opacity-60': '0.6',
  '--opacity-65': '0.65',
  '--opacity-70': '0.7',
  '--opacity-75': '0.75',
  '--opacity-80': '0.8',
  '--opacity-85': '0.85',
  '--opacity-90': '0.9',
  '--opacity-95': '0.95',
  '--opacity-100': '1'
}

export const deepchatV3DarkBrand: ThemeTokens = {
  // Dark (mapped from Figma dark tokens hints)
  '--background': '0 0% 14%', // #252525
  '--foreground': '0 0% 100%',
  '--card': '0 0% 14%',
  '--card-foreground': '0 0% 100%',
  '--popover': '0 0% 14%',
  '--popover-foreground': '0 0% 100%',
  '--primary': '210 100% 43%',
  '--primary-foreground': '0 0% 100%',
  '--secondary': '0 0% 20%',
  '--secondary-foreground': '0 0% 90%',
  '--muted': '0 0% 100% / 0.02',
  '--muted-foreground': '0 0% 100% / 0.2', // #ffffff33
  '--accent': '0 0% 20%',
  '--accent-foreground': '0 0% 100% / 0.8', // #ffffffcc
  '--destructive': '0 62% 30%',
  '--destructive-foreground': '0 0% 100%',
  '--border': '0 0% 100% / 0.05', // #ffffff0d
  '--input': '0 0% 100% / 0.1',
  '--ring': '210 100% 43%',
  '--container': '0 0% 14%',
  '--usage-low': '215 16% 30%',
  '--usage-mid': '215 16% 50%',
  '--usage-high': '215 16% 70%',
  // Blur tokens (shared across themes)
  '--blur-none': '0px',
  '--blur-xs': '4px',
  '--blur-sm': '8px',
  '--blur-md': '12px',
  '--blur-lg': '16px',
  '--blur-xl': '24px',
  '--blur-2xl': '40px',
  '--blur-3xl': '64px',
  // Opacity tokens (shared across themes)
  '--opacity-0': '0',
  '--opacity-5': '0.05',
  '--opacity-10': '0.1',
  '--opacity-15': '0.15',
  '--opacity-20': '0.2',
  '--opacity-25': '0.25',
  '--opacity-30': '0.3',
  '--opacity-35': '0.35',
  '--opacity-40': '0.4',
  '--opacity-45': '0.45',
  '--opacity-50': '0.5',
  '--opacity-55': '0.55',
  '--opacity-60': '0.6',
  '--opacity-65': '0.65',
  '--opacity-70': '0.7',
  '--opacity-75': '0.75',
  '--opacity-80': '0.8',
  '--opacity-85': '0.85',
  '--opacity-90': '0.9',
  '--opacity-95': '0.95',
  '--opacity-100': '1'
}

export type ApplyThemeOptions = {
  target?: HTMLElement
  dark?: boolean
  replace?: boolean
}

export function applyTheme(tokens: ThemeTokens, options: ApplyThemeOptions = {}): void {
  const target =
    options.target ?? (typeof document !== 'undefined' ? document.documentElement : undefined)
  if (!target) return

  // Toggle dark mode class if requested
  if (typeof options.dark === 'boolean') {
    target.classList.toggle('dark', !!options.dark)
  }

  // Apply variables
  if (options.replace) {
    // Remove any previous inline css variables from target
    Array.from(target.style)
      .filter((name) => name.startsWith('--'))
      .forEach((name) => target.style.removeProperty(name))
  }

  for (const [k, v] of Object.entries(tokens)) {
    target.style.setProperty(k, v)
  }
}

export const Themes = {
  light: deepchatV3LightBrand,
  dark: deepchatV3DarkBrand
}

// Figma-derived presets (day/night). Currently aligned to existing light/dark brand.
// If you prefer exact Figma palette, we can map all tokens once design rules stabilize.
// Export semantic themes under consistent names
