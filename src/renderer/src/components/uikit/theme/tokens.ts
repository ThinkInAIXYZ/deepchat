export type ThemeTokens = Record<string, string>

export const deepchatV3LightBrand: ThemeTokens = {
  // Light (mapped from Figma day tokens)
  '--background': '0 0% 100%', // #ffffff
  '--foreground': '0 0% 14%', // #252525
  '--card': '0 0% 100%',
  '--card-foreground': '0 0% 14%',
  '--popover': '0 0% 100%',
  '--popover-foreground': '0 0% 14%',
  '--primary': '210 100% 43%', // #006EDC
  '--primary-foreground': '0 0% 100%',
  '--secondary': '0 0% 96%',
  '--secondary-foreground': '0 0% 43%',
  '--muted': '0 0% 0% / 0.02', // #00000006
  '--muted-foreground': '0 0% 40%',
  '--accent': '0 0% 96%',
  '--accent-foreground': '0 0% 14% / 0.8', // #252525cc
  '--destructive': '0 84% 60%',
  '--destructive-foreground': '0 0% 98%',
  '--border': '0 0% 0% / 0.05', // #0000000d
  '--input': '0 0% 0% / 0.08',
  '--ring': '210 100% 43%',
  '--container': '0 0% 100%',
  '--usage-low': '215 16% 90%',
  '--usage-mid': '215 16% 70%',
  '--usage-high': '215 16% 40%'
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
  '--usage-high': '215 16% 70%'
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
