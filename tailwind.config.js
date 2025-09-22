const animate = require('tailwindcss-animate')
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  safelist: ['dark'],
  prefix: '',

  content: [
    './pages/**/*.{ts,tsx,vue}',
    './components/**/*.{ts,tsx,vue}',
    './app/**/*.{ts,tsx,vue}',
    './src/**/*.{ts,tsx,vue}',
    './node_modules/vue-renderer-markdown/dist/tailwind.ts'
  ],

  fontFamily: {
    display: ['Geist', 'sans-serif'],
    text: ['Geist', 'sans-serif']
  },

  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px'
      }
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-family-sans)']
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        container: 'hsl(var(--container))',

        base: {
          50: 'hsl(var(--base-50))',
          100: 'hsl(var(--base-100))',
          200: 'hsl(var(--base-200))',
          300: 'hsl(var(--base-300))',
          400: 'hsl(var(--base-400))',
          500: 'hsl(var(--base-500))',
          600: 'hsl(var(--base-600))',
          700: 'hsl(var(--base-700))',
          800: 'hsl(var(--base-800))',
          900: 'hsl(var(--base-900))',
          950: 'hsl(var(--base-950))',
          1000: 'hsl(var(--base-1000))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          50: 'hsl(var(--primary-50))',
          100: 'hsl(var(--primary-100))',
          200: 'hsl(var(--primary-200))',
          300: 'hsl(var(--primary-300))',
          400: 'hsl(var(--primary-400))',
          500: 'hsl(var(--primary-500))',
          600: 'hsl(var(--primary-600))',
          700: 'hsl(var(--primary-700))',
          800: 'hsl(var(--primary-800))',
          900: 'hsl(var(--primary-900))',
          950: 'hsl(var(--primary-950))',
          1000: 'hsl(var(--primary-1000))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        usage: {
          low: 'hsl(var(--usage-low))',
          mid: 'hsl(var(--usage-mid))',
          high: 'hsl(var(--usage-high))'
        }
      },
      borderRadius: {
        none: 'var(--radius-none)',
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
        full: 'var(--radius-full)'
      },
      boxShadow: {
        none: 'var(--shadow-none)',
        '2xs': 'var(--shadow-2xs)',
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        '2xl': 'var(--shadow-2xl)',
        inset: 'var(--shadow-inset-sm)',
        'inset-2xs': 'var(--shadow-inset-2xs)',
        'inset-xs': 'var(--shadow-inset-xs)',
        'inset-sm': 'var(--shadow-inset-sm)'
      },
      blur: {
        none: 'var(--blur-none)',
        xs: 'var(--blur-xs)',
        sm: 'var(--blur-sm)',
        md: 'var(--blur-md)',
        lg: 'var(--blur-lg)',
        xl: 'var(--blur-xl)',
        '2xl': 'var(--blur-2xl)',
        '3xl': 'var(--blur-3xl)'
      },
      backdropBlur: {
        none: 'var(--blur-none)',
        xs: 'var(--blur-xs)',
        sm: 'var(--blur-sm)',
        md: 'var(--blur-md)',
        lg: 'var(--blur-lg)',
        xl: 'var(--blur-xl)',
        '2xl': 'var(--blur-2xl)',
        '3xl': 'var(--blur-3xl)'
      },
      opacity: {
        0: 'var(--opacity-0)',
        5: 'var(--opacity-5)',
        10: 'var(--opacity-10)',
        15: 'var(--opacity-15)',
        20: 'var(--opacity-20)',
        25: 'var(--opacity-25)',
        30: 'var(--opacity-30)',
        35: 'var(--opacity-35)',
        40: 'var(--opacity-40)',
        45: 'var(--opacity-45)',
        50: 'var(--opacity-50)',
        55: 'var(--opacity-55)',
        60: 'var(--opacity-60)',
        65: 'var(--opacity-65)',
        70: 'var(--opacity-70)',
        75: 'var(--opacity-75)',
        80: 'var(--opacity-80)',
        85: 'var(--opacity-85)',
        90: 'var(--opacity-90)',
        95: 'var(--opacity-95)',
        100: 'var(--opacity-100)'
      },
      backdropOpacity: {
        0: 'var(--opacity-0)',
        5: 'var(--opacity-5)',
        10: 'var(--opacity-10)',
        15: 'var(--opacity-15)',
        20: 'var(--opacity-20)',
        25: 'var(--opacity-25)',
        30: 'var(--opacity-30)',
        35: 'var(--opacity-35)',
        40: 'var(--opacity-40)',
        45: 'var(--opacity-45)',
        50: 'var(--opacity-50)',
        55: 'var(--opacity-55)',
        60: 'var(--opacity-60)',
        65: 'var(--opacity-65)',
        70: 'var(--opacity-70)',
        75: 'var(--opacity-75)',
        80: 'var(--opacity-80)',
        85: 'var(--opacity-85)',
        90: 'var(--opacity-90)',
        95: 'var(--opacity-95)',
        100: 'var(--opacity-100)'
      },
      fontSize: {
        xs: ['var(--font-size-xs)', { lineHeight: 'var(--line-height-xs)' }],
        sm: ['var(--font-size-sm)', { lineHeight: 'var(--line-height-sm)' }],
        base: ['var(--font-size-base)', { lineHeight: 'var(--line-height-base)' }],
        lg: ['var(--font-size-lg)', { lineHeight: 'var(--line-height-lg)' }],
        xl: ['var(--font-size-xl)', { lineHeight: 'var(--line-height-xl)' }],
        '2xl': ['var(--font-size-2xl)', { lineHeight: 'var(--line-height-2xl)' }],
        '3xl': ['var(--font-size-3xl)', { lineHeight: 'var(--line-height-3xl)' }],
        '4xl': ['var(--font-size-4xl)', { lineHeight: 'var(--line-height-4xl)' }],
        '5xl': ['var(--font-size-5xl)', { lineHeight: 'var(--line-height-5xl)' }],
        '6xl': ['var(--font-size-6xl)', { lineHeight: 'var(--line-height-6xl)' }],
        '7xl': ['var(--font-size-7xl)', { lineHeight: 'var(--line-height-7xl)' }],
        '8xl': ['var(--font-size-8xl)', { lineHeight: 'var(--line-height-8xl)' }],
        '9xl': ['var(--font-size-9xl)', { lineHeight: 'var(--line-height-9xl)' }]
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 }
        },
        'collapsible-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-collapsible-content-height)' }
        },
        'collapsible-up': {
          from: { height: 'var(--radix-collapsible-content-height)' },
          to: { height: 0 }
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'collapsible-down': 'collapsible-down 0.2s ease-in-out',
        'collapsible-up': 'collapsible-up 0.2s ease-in-out',
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
      }
    }
  },
  plugins: [animate, require('@tailwindcss/typography'), require('tailwind-scrollbar-hide')]
}
