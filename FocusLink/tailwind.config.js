/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './mini.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  // 运行时通过 classList 动态切换的主题/字体类：字面量不在扫描内容中，必须 safelist 防 purge
  safelist: [
    'dark',
    'light',
    'theme-quiet',
    'theme-dawn',
    'theme-bloom',
    { pattern: /accent-(indigo|violet|emerald|rose|amber|sky)/ },
    'font-profile-plex',
    'font-profile-geist',
    'font-profile-manrope',
    'font-profile-sora',
  ],
  theme: {
    extend: {
      colors: {
        app: {
          bg: 'rgb(var(--app-bg) / <alpha-value>)',
          surface: 'rgb(var(--app-surface) / <alpha-value>)',
          subtle: 'rgb(var(--app-surface-2) / <alpha-value>)',
          elevated: 'rgb(var(--app-elevated) / <alpha-value>)',
          border: 'rgb(var(--app-border) / <alpha-value>)',
          text: 'rgb(var(--app-text) / <alpha-value>)',
          muted: 'rgb(var(--app-muted) / <alpha-value>)',
          subtleText: 'rgb(var(--app-subtle) / <alpha-value>)',
        },
        bg: {
          base: 'rgb(var(--bg-base) / <alpha-value>)',
          card: 'rgb(var(--bg-card) / <alpha-value>)',
          subtle: 'rgb(var(--bg-subtle) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'rgb(var(--fg-default) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--fg-subtle) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          muted: 'rgb(var(--accent-muted) / <alpha-value>)',
          soft: 'rgb(var(--accent) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        pause: 'rgb(var(--pause) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        soft: 'var(--shadow-sm)',
        panel: 'var(--shadow-md)',
        float: 'var(--shadow-lg)',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
